#!/usr/bin/env node
/**
 * EDINET docIDインデックスの過去日バックフィル。
 *
 * 仕様: `docs/02_design/logic/edinet-history-import.md` §4.4「過去日の一括バックフィル」
 *
 * **なぜ要るか。** 日次 Cron（`scheduled` ハンドラ）は「前日1日ぶん」しか
 * `documents.json` を走査しない。既に提出済みの有価証券報告書（3月決算企業なら去年の6月）は
 * 永久にインデックスへ入らず、どの銘柄も `document-not-found` になる。
 *
 * **なぜ Worker 側のバッチではなくローカルのスクリプトか。** 一度きりの作業に
 * カーソル管理・チャンク分割・失敗再開を作り込むより、日付を外から回すほうが小さい。
 * Worker の実行時間・サブリクエスト上限にも当たらない（1リクエスト＝EDINET 1回＋D1書き込み1回）。
 *
 * 使い方（PowerShell）:
 *
 *   $env:EDINET_ADMIN_TOKEN = '<wrangler secret put で設定した値>'
 *   node scripts/backfill-edinet-index.mjs `
 *     --base-url https://dividend-stock-analysis.dividend-analysis.workers.dev `
 *     --from 2025-06-01 --to 2025-06-30
 *
 * 途中で失敗した日付は最後に一覧で出す。同じ範囲を再実行しても upsert なので二重登録にならない。
 */

const USAGE = `使い方:
  node scripts/backfill-edinet-index.mjs --base-url <URL> --from <YYYY-MM-DD> --to <YYYY-MM-DD> [オプション]

必須:
  --base-url <URL>      デプロイ先のオリジン（例: https://example.workers.dev）
  --from <YYYY-MM-DD>   走査開始日（含む）
  --to <YYYY-MM-DD>     走査終了日（含む）

任意:
  --token <値>          管理用トークン。既定は環境変数 EDINET_ADMIN_TOKEN
  --delay <ミリ秒>      リクエスト間隔。既定 1000（EDINETへの礼儀。速くしすぎない）
  --include-weekends    土日も走査する。既定は平日のみ（EDINETは土日に提出が無い）
  --dry-run             叩かずに対象日付だけ出す`;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

function parseArguments(argv) {
  const options = {
    baseUrl: null,
    from: null,
    to: null,
    token: process.env['EDINET_ADMIN_TOKEN'] ?? null,
    delayMs: 1000,
    includeWeekends: false,
    dryRun: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const next = () => {
      const value = argv[index + 1];
      if (value === undefined) throw new Error(`${argument} に値がありません`);
      index += 1;
      return value;
    };

    if (argument === '--base-url') options.baseUrl = next().replace(/\/+$/, '');
    else if (argument === '--from') options.from = next();
    else if (argument === '--to') options.to = next();
    else if (argument === '--token') options.token = next();
    else if (argument === '--delay') options.delayMs = Number(next());
    else if (argument === '--include-weekends') options.includeWeekends = true;
    else if (argument === '--dry-run') options.dryRun = true;
    else throw new Error(`不明な引数: ${argument}`);
  }

  if (options.baseUrl === null) throw new Error('--base-url は必須です');
  if (options.from === null || !DATE_PATTERN.test(options.from)) {
    throw new Error('--from は YYYY-MM-DD 形式で必須です');
  }
  if (options.to === null || !DATE_PATTERN.test(options.to)) {
    throw new Error('--to は YYYY-MM-DD 形式で必須です');
  }
  if (options.from > options.to) throw new Error('--from が --to より後になっています');
  if (!Number.isFinite(options.delayMs) || options.delayMs < 0) {
    throw new Error('--delay は 0 以上の数値で指定してください');
  }
  if (!options.dryRun && (options.token === null || options.token === '')) {
    throw new Error(
      '管理用トークンがありません。--token か環境変数 EDINET_ADMIN_TOKEN で渡してください',
    );
  }
  return options;
}

/** `from`〜`to`（両端を含む）の暦日。既定では土日を除く */
function listDates(from, to, includeWeekends) {
  const dates = [];
  let current = Date.parse(`${from}T00:00:00.000Z`);
  const last = Date.parse(`${to}T00:00:00.000Z`);
  while (current <= last) {
    const date = new Date(current);
    const dayOfWeek = date.getUTCDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    if (includeWeekends || !isWeekend) dates.push(date.toISOString().slice(0, 10));
    current += MILLISECONDS_PER_DAY;
  }
  return dates;
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/**
 * 1日ぶんを取り込む。**失敗しても投げない**（残りの日付を続ける）。
 * 502（EDINET側の一時障害）だけ1回だけ再試行する。
 */
async function refreshOneDate(options, date) {
  const url = `${options.baseUrl}/api/admin/edinet/index/refresh?date=${date}`;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    let response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'X-Admin-Token': options.token },
      });
    } catch (cause) {
      if (attempt === 2) return { ok: false, detail: `通信エラー: ${String(cause)}` };
      await sleep(options.delayMs * 3);
      continue;
    }

    const text = await response.text();
    if (response.ok) {
      let entryCount = 0;
      try {
        entryCount = JSON.parse(text).entryCount ?? 0;
      } catch {
        return { ok: false, detail: `応答がJSONではない: ${text.slice(0, 120)}` };
      }
      return { ok: true, entryCount };
    }

    // 502 は EDINET 側の一時障害。それ以外（401/400/503）は再試行しても同じ
    if (response.status !== 502 || attempt === 2) {
      return { ok: false, detail: `HTTP ${response.status}: ${text.slice(0, 120)}` };
    }
    await sleep(options.delayMs * 3);
  }
  return { ok: false, detail: '再試行を使い切りました' };
}

async function main() {
  let options;
  try {
    options = parseArguments(process.argv.slice(2));
  } catch (error) {
    console.error(`${error.message}\n\n${USAGE}`);
    process.exitCode = 1;
    return;
  }

  const dates = listDates(options.from, options.to, options.includeWeekends);
  console.log(`対象: ${dates.length}日（${options.from} 〜 ${options.to}）`);

  if (options.dryRun) {
    for (const date of dates) console.log(date);
    return;
  }

  const failures = [];
  let totalEntries = 0;

  for (const [index, date] of dates.entries()) {
    const result = await refreshOneDate(options, date);
    const progress = `[${index + 1}/${dates.length}]`;
    if (result.ok) {
      totalEntries += result.entryCount;
      console.log(`${progress} ${date} 有報 ${result.entryCount}件（累計 ${totalEntries}件）`);
    } else {
      failures.push({ date, detail: result.detail });
      console.error(`${progress} ${date} 失敗: ${result.detail}`);
    }
    if (index < dates.length - 1) await sleep(options.delayMs);
  }

  console.log(
    `\n完了: ${dates.length - failures.length}/${dates.length}日, 有報 累計 ${totalEntries}件`,
  );
  if (failures.length > 0) {
    console.error(`\n失敗した日付（同じ引数で再実行すれば埋まります）:`);
    for (const failure of failures) console.error(`  ${failure.date}  ${failure.detail}`);
    process.exitCode = 1;
  }
}

await main();
