/**
 * Yahoo Finance の chart エンドポイントのレスポンス（テキスト）を `MarketData` へ
 * 正規化する。
 *
 * 仕様: `docs/02_design/logic/market-data-source.md` §3・§4.1・§7.2
 *
 * **純粋関数。ネットワークにも触らない。** 取得は `chart-client.ts` の責務
 * （ADR-0007 と同じ理由。取得層とパース層を分ける）。
 *
 * ⚠️ **配当額だけは `JSON.parse` を経由しない。** Yahoo の JSON は配当額を常に
 * `number`（double）で返すため、`JSON.parse` すると精度を失う（`.claude/rules/backend.md`
 * 「浮動小数点で金額計算をしない」）。レスポンス本文（テキスト）から `"amount":` に続く
 * 数値リテラルを**文字列のまま**正規表現で抜き出す（ユーザー確定事項・案B。
 * `market-data-source.ts` の `DividendPayment.amountYenText` を参照）。
 * それ以外の値（日付・株価・分割比率など）は精度上の懸念が無いので通常どおり
 * `JSON.parse` の結果を使う。
 */

import { MAX_PRICE_SEN } from '../../domain/company/dividend-record';
import { type ImportDiagnostic } from '../../domain/company/financial-source';
import {
  type DividendPayment,
  type MarketData,
  type MarketDataError,
  type SplitEvent,
} from '../../domain/company/market-data-source';
import { type Result, err, ok } from '../../domain/shared/result';

/**
 * 診断の `block`/`column`/`fiscalYearKey` の固定値（設計書 §8-7 決定事項）。
 *
 * `dividend-fiscal-year.ts` の `DIAGNOSTIC_BLOCK`（`'配当'`）と `block` は揃えるが、
 * `column` はあえて別名（`'配当明細'`）にする。年度集計後の `'年間配当'`
 * （`dividend-fiscal-year.ts`）と区別するため（こちらは集計前の1エントリ単位）。
 * `resolveField`（`import-review.ts`）はこの組み合わせを解決しないため、
 * 行外の警告として出る（意図通り。§8-7）。
 */
const DIVIDEND_DIAGNOSTIC_BLOCK = '配当';
const DIVIDEND_DIAGNOSTIC_COLUMN = '配当明細';
const PRICE_DIAGNOSTIC_BLOCK = '株価';
/** 株価には配当のような複数列が無いため `block` と同じ固定文字列にする（§8-7） */
const PRICE_DIAGNOSTIC_COLUMN = '株価';
/**
 * `fiscalYearKey` に決算年度が無い場合の固定値。株価は決算年度に紐付かないため常にこれを使う。
 * 配当は権利落ち日が読めていればそれを使い、読めなければこれを使う
 * （`financial-source.ts` の `ImportDiagnostic.fiscalYearKey` コメント参照）。
 */
const UNKNOWN_FISCAL_YEAR_KEY = 'unknown';

function isRecordObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function describeCause(cause: unknown): string {
  if (cause instanceof Error) return cause.name;
  return typeof cause;
}

function isoDateFromEpochSeconds(seconds: number): string {
  return new Date(seconds * 1000).toISOString().slice(0, 10);
}

/**
 * `"key":{` から始まる、波括弧の対応が取れた区間をテキストのまま取り出す。
 *
 * `JSON.parse` を経由せずに `events.dividends` の生テキストへ辿り着くための
 * 最小限のスキャナ。ネストした `{}` を数えるだけで、文字列中の `{`/`}`
 * （このレスポンスの値には現れない）までは考慮しない。
 *
 * ⚠️ **この前提が崩れた場合の挙動は未検証（優先度低・許容リスク）。** 将来 Yahoo が
 * `events` 配下の文字列フィールドに `{`/`}` を含む値を返すようになると、この関数は
 * 誤った範囲を切り出す。結果として `extractDividendPayments`/`extractSplits` の
 * 正規表現マッチが失敗するか（この場合は空配列になりエラーにはならない）、または
 * 誤った値を拾う（この場合は診断で捕捉されないまま不正な値が混入しうる）。
 * クオート内の `{`/`}` を無視する簡易エスケープ処理は、実データで問題が確認できていない
 * ため本修正のスコープに含めない（レビュー改善案は挙げたが必須ではないと判断した）。
 */
function extractBalancedObject(text: string, key: string): string | null {
  const marker = `"${key}":{`;
  const start = text.indexOf(marker);
  if (start === -1) return null;
  const openIndex = start + marker.length - 1;

  let depth = 0;
  for (let index = openIndex; index < text.length; index += 1) {
    const char = text[index];
    if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(openIndex, index + 1);
    }
  }
  return null;
}

/** `events.dividends` の1エントリ（ネストした `{}` を持たない） */
const DIVIDEND_ENTRY = /"\d+":(\{[^{}]*\})/g;
const AMOUNT_LITERAL = /"amount":(-?\d+(?:\.\d+)?)/;
const DATE_LITERAL = /"date":(-?\d+)/;

interface DividendExtraction {
  readonly payments: readonly DividendPayment[];
  readonly diagnostics: readonly ImportDiagnostic[];
}

/**
 * `events.dividends` を**テキストのまま**読む。
 *
 * - **キーではなく `date` フィールドを読む**（§3.1。キーとの1か月ずれを避ける）
 * - 金額は文字列のまま持ち回る（変換は集計時。§3.4 の囲み）
 * - `events` 自体が無い応答は空配列（エラーにしない。§7.2）
 * - `amount`/`date` が読めないエントリは捨てるが、`ImportDiagnostic` を1件残す
 *   （`.claude/rules/backend.md` 「検証に落ちたデータは捨てずに記録する」。§8-7 決定事項）
 */
function extractDividendPayments(eventsText: string | null): DividendExtraction {
  if (eventsText === null) return { payments: [], diagnostics: [] };
  const dividendsText = extractBalancedObject(eventsText, 'dividends');
  if (dividendsText === null) return { payments: [], diagnostics: [] };

  const payments: DividendPayment[] = [];
  const diagnostics: ImportDiagnostic[] = [];
  for (const match of dividendsText.matchAll(DIVIDEND_ENTRY)) {
    const entryText = match[1];
    if (entryText === undefined) continue;
    const amountMatch = AMOUNT_LITERAL.exec(entryText);
    const dateMatch = DATE_LITERAL.exec(entryText);
    if (amountMatch?.[1] === undefined || dateMatch?.[1] === undefined) {
      diagnostics.push({
        block: DIVIDEND_DIAGNOSTIC_BLOCK,
        // 決算年度が確定する前の段階（集計は dividend-fiscal-year.ts の責務。§4.2）。
        // date が読めていればその権利落ち日、両方読めなければ 'unknown' とする
        fiscalYearKey:
          dateMatch?.[1] !== undefined
            ? isoDateFromEpochSeconds(Number(dateMatch[1]))
            : UNKNOWN_FISCAL_YEAR_KEY,
        column: DIVIDEND_DIAGNOSTIC_COLUMN,
        reason: 'unparsable-value',
        raw: entryText,
      });
      continue;
    }

    payments.push({
      exDividendDate: isoDateFromEpochSeconds(Number(dateMatch[1])),
      amountYenText: amountMatch[1],
    });
  }
  return { payments, diagnostics };
}

/** `events.splits` は `numerator`/`denominator` をそのまま使う（`splitRatio` はパースしない。§3.5） */
function extractSplits(raw: unknown): readonly SplitEvent[] {
  if (!isRecordObject(raw)) return [];

  const splits: SplitEvent[] = [];
  for (const value of Object.values(raw)) {
    if (!isRecordObject(value)) continue;
    const date = value['date'];
    const numerator = value['numerator'];
    const denominator = value['denominator'];
    if (
      typeof date !== 'number' ||
      typeof numerator !== 'number' ||
      typeof denominator !== 'number'
    ) {
      continue;
    }
    splits.push({ date: isoDateFromEpochSeconds(date), numerator, denominator });
  }
  return splits;
}

/**
 * @param text `response.text()` の結果。**`response.json()` を使わない**
 *   （配当額の精度を保つため。上記コメント参照）
 * @param code 要求した銘柄コード。応答にエラーが無い前提で `MarketData.code` に使う。
 *   `meta.symbol` との一致検査はしない（設計書 §8-13。決定済み）
 */
export function parseChart(text: string, code: string): Result<MarketData, MarketDataError> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (cause) {
    return err({ kind: 'malformed-response', detail: describeCause(cause) });
  }

  if (!isRecordObject(raw)) {
    return err({ kind: 'unexpected-shape', detail: 'ルートがオブジェクトでない' });
  }
  const chart = raw['chart'];
  if (!isRecordObject(chart)) {
    return err({ kind: 'unexpected-shape', detail: 'chart がオブジェクトでない' });
  }

  const chartError = chart['error'];
  if (chartError !== null && chartError !== undefined) {
    return err({ kind: 'source-not-found', code });
  }

  const results = chart['result'];
  if (!Array.isArray(results) || results.length === 0) {
    return err({ kind: 'unexpected-shape', detail: 'chart.result が空' });
  }
  const result: unknown = results[0];
  if (!isRecordObject(result)) {
    return err({ kind: 'unexpected-shape', detail: 'chart.result[0] がオブジェクトでない' });
  }

  const meta = result['meta'];
  if (!isRecordObject(meta)) {
    return err({ kind: 'unexpected-shape', detail: 'meta がオブジェクトでない' });
  }

  const longName = meta['longName'];
  const shortName = meta['shortName'];
  const name =
    typeof longName === 'string' && longName !== ''
      ? longName
      : typeof shortName === 'string' && shortName !== ''
        ? shortName
        : null;

  const regularMarketPrice = meta['regularMarketPrice'];
  const regularMarketTime = meta['regularMarketTime'];

  let priceSen: number | null = null;
  let priceAsOf: string | null = null;
  const priceDiagnostics: ImportDiagnostic[] = [];
  if (typeof regularMarketPrice === 'number' && typeof regularMarketTime === 'number') {
    // 円→銭は Math.round(price * 100)。0以下・業務上限超は取り込まない（§3.3）
    const candidate = Math.round(regularMarketPrice * 100);
    if (candidate > 0 && candidate <= MAX_PRICE_SEN) {
      priceSen = candidate;
      priceAsOf = new Date(regularMarketTime * 1000).toISOString();
    } else if (candidate <= 0) {
      priceDiagnostics.push({
        block: PRICE_DIAGNOSTIC_BLOCK,
        fiscalYearKey: UNKNOWN_FISCAL_YEAR_KEY,
        column: PRICE_DIAGNOSTIC_COLUMN,
        reason: 'unparsable-value',
        raw: String(regularMarketPrice),
      });
    } else {
      // candidate > MAX_PRICE_SEN（業務上限超）
      priceDiagnostics.push({
        block: PRICE_DIAGNOSTIC_BLOCK,
        fiscalYearKey: UNKNOWN_FISCAL_YEAR_KEY,
        column: PRICE_DIAGNOSTIC_COLUMN,
        reason: 'unsafe-integer',
        raw: String(regularMarketPrice),
      });
    }
  } else if (regularMarketPrice !== undefined || regularMarketTime !== undefined) {
    // ペアで揃わない場合のみ診断を積む。両方とも無い（該当データが存在しない銘柄）は
    // 「取れなかった」のではなく「そもそも無い」ため診断を積まない（配当の events 欠如と同じ扱い）
    const presentValue = regularMarketPrice !== undefined ? regularMarketPrice : regularMarketTime;
    priceDiagnostics.push({
      block: PRICE_DIAGNOSTIC_BLOCK,
      fiscalYearKey: UNKNOWN_FISCAL_YEAR_KEY,
      column: PRICE_DIAGNOSTIC_COLUMN,
      reason: 'unparsable-value',
      raw: String(presentValue),
    });
  }

  const events = result['events'];
  const eventsText = extractBalancedObject(text, 'events');
  const { payments: dividendPayments, diagnostics: dividendDiagnostics } =
    extractDividendPayments(eventsText);
  const splits = isRecordObject(events) ? extractSplits(events['splits']) : [];

  return ok({
    code,
    name,
    priceSen,
    priceAsOf,
    dividendPayments,
    splits,
    diagnostics: [...priceDiagnostics, ...dividendDiagnostics],
  });
}
