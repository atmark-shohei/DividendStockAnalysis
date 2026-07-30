/**
 * IRバンクの銘柄別 JSON（`fy-data-all.json`）を取り込み用の形へ正規化する。
 *
 * 仕様: `docs/02_design/logic/irbank-json-import.md`
 * 決定: `docs/adr/0007-irbank-json-direct-fetch.md`
 *
 * **純粋関数。ネットワークにも DB にも触らない。** 取得は別ファイルの責務。
 *
 * ⚠️ **銘柄名はこの JSON に含まれない**（`meta` は `code` / `type` / `item` だけ）。
 * 名前はユーザーが入力する。
 *
 * ⚠️ 金額を `Sen`（検証済みを表す branded type）にしないのは、これが
 * **未検証の入力**だからである（`domain/company/dividend-record.ts` と同じ理由）。
 */

import { type FinancialRecord } from '../../domain/company/company';
import { type DividendRecord } from '../../domain/company/dividend-record';
import { deriveOperatingMarginPercent } from '../../domain/company/operating-margin';
import {
  type FinancialSourceError,
  type ImportDiagnostic,
  type ImportedFinancials,
} from '../../domain/company/financial-source';
import { type Result, err, ok } from '../../domain/shared/result';

/**
 * ブロック名・列名。**`src/domain/company/import-review.ts` が同じ値を
 * 独立に持っている**（domain は infra を import できないため。`.claude/CLAUDE.md`
 * 依存ルール）。`export` しているのは、両者が食い違っていないことを
 * `tests/domain/company/import-review-constants.test.ts` で機械的に検査するため。
 */
export const BLOCK_PERFORMANCE = '業績';
export const BLOCK_BALANCE = '財務';
export const BLOCK_DIVIDEND = '配当';

export const COLUMN_YEAR = '年度';
export const COLUMN_REVENUE = '売上高';
const COLUMN_OPERATING_INCOME = '営業利益';
export const COLUMN_EPS = 'EPS';
export const COLUMN_ROE = 'ROE';
const COLUMN_BPS = 'BPS';
export const COLUMN_DIVIDEND_PER_SHARE = '一株配当';

/** 予想行にだけ付く注記。この値以外は素性が分からないので採用しない（§3.3） */
const NOTE_KEY = '備考';
const NOTE_FORECAST = '予想';

/** 欠損を表す値。`null` ではなくこの文字列で来る（§3.1） */
const MISSING = '-';

/** 数値文字列。同じ列でも年度によって `number` と文字列が混在する（§3.1） */
const NUMERIC_TEXT = /^-?\d+(\.\d+)?$/;

/** 決算期のキー。`2026/03` の先頭4桁を決算年度にする（§3.2） */
const FISCAL_YEAR_KEY = /^(\d{4})\/(\d{2})$/;

const MIN_FISCAL_YEAR = 1900;
const MAX_FISCAL_YEAR = 2200;

/**
 * `Math.round` の結果が「本当の丸め」か「double の誤差」かを分ける閾値。
 *
 * `150.01 * 100` は `15000.999999999998` になるが、これは丸めではない。
 * 一方 `1.005 * 100` は `100.49999…` で、実際に第3位を落としている。
 */
const FLOAT_NOISE = 1e-6;

/**
 * 株式分割の反映漏れを疑う前年比の閾値（§5.3）。**超えたときだけ**記録する
 * （ちょうど 80% は記録しない）。
 */
const SUSPICIOUS_JUMP_RATIO = 0.8;

/**
 * パース段階で起こりうる失敗だけを取り出したもの（§5.1）。
 * 通信の失敗（`source-unreachable` など）はここでは起きない。
 */
export type ParseFyDataError = Extract<
  FinancialSourceError,
  { kind: 'unexpected-shape' | 'code-mismatch' | 'no-usable-year' }
>;

/** 1年度ぶんの行。列名で引けるようにしたもの */
interface BlockRow {
  readonly fiscalYearKey: string;
  readonly isForecast: boolean;
  readonly values: ReadonlyMap<string, unknown>;
}

type Block = ReadonlyMap<number, BlockRow>;

function isRecordObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * セルの生値を「数値 / 数値文字列 / 欠損 / 読めない」に分ける。
 *
 * **全列で3種すべてを受け入れる**（§3.1）。特定の列だけ `typeof === 'number'` を
 * 前提にすると、別の銘柄で必ず落ちる。
 */
type NumericCell =
  | { readonly kind: 'number'; readonly value: number }
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'missing' }
  | { readonly kind: 'invalid'; readonly raw: string };

function readNumeric(raw: unknown): NumericCell {
  if (typeof raw === 'number') {
    return Number.isFinite(raw)
      ? { kind: 'number', value: raw }
      : { kind: 'invalid', raw: String(raw) };
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed === '' || trimmed === MISSING) return { kind: 'missing' };
    if (NUMERIC_TEXT.test(trimmed)) return { kind: 'text', text: trimmed };
    return { kind: 'invalid', raw: trimmed };
  }
  if (raw === undefined || raw === null) return { kind: 'missing' };
  return { kind: 'invalid', raw: typeof raw };
}

interface SenConversion {
  readonly sen: number;
  readonly rounded: boolean;
}

/**
 * 数値文字列を銭へ。**小数点を文字列のままずらす**（`parseFloat` を経由しない）。
 *
 * 浮動小数点を挟むと金額がずれる（`.claude/skills/import-financials/SKILL.md`）。
 * 小数第3位以下は四捨五入し、丸めたことを呼び出し側へ返す。
 */
function senFromText(text: string): SenConversion | null {
  const negative = text.startsWith('-');
  const body = negative ? text.slice(1) : text;
  const dot = body.indexOf('.');
  const integerPart = dot === -1 ? body : body.slice(0, dot);
  const fractionPart = dot === -1 ? '' : body.slice(dot + 1);

  const truncated = Number(integerPart + `${fractionPart}00`.slice(0, 2));
  if (!Number.isSafeInteger(truncated)) return null;

  const dropped = fractionPart.slice(2);
  if (dropped === '') return { sen: negative ? -truncated : truncated, rounded: false };

  const carried = Number(dropped[0]) >= 5 ? truncated + 1 : truncated;
  if (!Number.isSafeInteger(carried)) return null;
  return { sen: negative ? -carried : carried, rounded: true };
}

/**
 * `number` で来た値を銭へ。
 *
 * `JSON.parse` が既に double にしているので文字列へ戻す手段が無い。実測した
 * 小数桁は EPS・BPS が2桁、一株配当が1桁で、この範囲では `Math.round` の結果は
 * 厳密に正しい（§3.4）。
 */
function senFromNumber(value: number): SenConversion | null {
  const scaled = value * 100;
  const sen = Math.round(scaled);
  if (!Number.isSafeInteger(sen)) return null;
  return { sen, rounded: Math.abs(scaled - sen) > FLOAT_NOISE };
}

/** 診断を貯めながら読むための入れ物 */
interface Reader {
  readonly diagnostics: ImportDiagnostic[];
}

function record(reader: Reader, entry: ImportDiagnostic): void {
  reader.diagnostics.push(entry);
}

/** 金額列を銭で読む。欠損は `null`。**0 と混同しない** */
function senAt(reader: Reader, block: string, row: BlockRow, column: string): number | null {
  const cell = readNumeric(row.values.get(column));
  if (cell.kind === 'missing') return null;

  const context = { block, fiscalYearKey: row.fiscalYearKey, column };
  if (cell.kind === 'invalid') {
    record(reader, { ...context, reason: 'unparsable-value', raw: cell.raw });
    return null;
  }

  const raw = cell.kind === 'text' ? cell.text : String(cell.value);
  const converted = cell.kind === 'text' ? senFromText(cell.text) : senFromNumber(cell.value);
  if (converted === null) {
    // 銀行の総資産のように、銭にすると MAX_SAFE_INTEGER を超える金額がある（§3.4）
    record(reader, { ...context, reason: 'unsafe-integer', raw });
    return null;
  }
  if (converted.rounded) record(reader, { ...context, reason: 'rounded', raw });
  return converted.sen;
}

/** 比率列（%・倍）。金額ではないので実数のままでよい */
function ratioAt(reader: Reader, block: string, row: BlockRow, column: string): number | null {
  const cell = readNumeric(row.values.get(column));
  if (cell.kind === 'missing') return null;
  if (cell.kind === 'invalid') {
    record(reader, {
      block,
      fiscalYearKey: row.fiscalYearKey,
      column,
      reason: 'unparsable-value',
      raw: cell.raw,
    });
    return null;
  }
  const value = cell.kind === 'text' ? Number(cell.text) : cell.value;
  return Number.isFinite(value) ? value : null;
}

/**
 * 前年からの変化が大きすぎる値を記録する（§5.3 の桁チェック）。
 *
 * 株式分割が反映されていない年が混ざると、EPS・一株配当が桁ごとずれる。
 * 正しい急変（記念配当・業績の急回復）と機械的に区別できないので
 * **除外はしない。値はそのまま採用し、人が気づけるように記録だけ残す。**
 *
 * 前年が `null`（データなし）や 0 のときは変化率を定義できないので何も出さない。
 * 比較不能・ゼロ除算を「異常」として誤検出しない。
 */
function recordSuspiciousJump(
  reader: Reader,
  block: string,
  row: BlockRow,
  column: string,
  previousSen: number | null,
  currentSen: number | null,
): void {
  if (previousSen === null || currentSen === null || previousSen === 0) return;
  // 金額そのものではなく比率なので実数でよい（営業利益率と同じ扱い）
  const change = Math.abs(currentSen - previousSen) / Math.abs(previousSen);
  if (change <= SUSPICIOUS_JUMP_RATIO) return;
  record(reader, {
    block,
    fiscalYearKey: row.fiscalYearKey,
    column,
    reason: 'suspicious-jump',
    raw: `${String(previousSen)} -> ${String(currentSen)}`,
  });
}

/**
 * 1ブロックを「決算年度 → 行」に正規化する。
 *
 * **予想年度だけ配列ではなくオブジェクトで来る**（§3.3）。`Array.isArray` で
 * 分岐しないと落ちる。
 */
function normalizeBlock(
  reader: Reader,
  blockName: string,
  raw: unknown,
): Block | { readonly error: string } {
  if (!isRecordObject(raw)) return { error: `${blockName} がオブジェクトでない` };

  const meta = raw['meta'];
  if (!isRecordObject(meta)) return { error: `${blockName}.meta がオブジェクトでない` };
  const metaItem = meta['item'];
  if (!isRecordObject(metaItem)) return { error: `${blockName}.meta.item がオブジェクトでない` };
  const columns = metaItem[COLUMN_YEAR];
  if (!Array.isArray(columns) || columns.some((column) => typeof column !== 'string')) {
    return { error: `${blockName}.meta.item.${COLUMN_YEAR} が列名の配列でない` };
  }
  const item = raw['item'];
  if (!isRecordObject(item)) return { error: `${blockName}.item がオブジェクトでない` };

  const rows = new Map<number, BlockRow>();
  const duplicated = new Set<number>();

  for (const [fiscalYearKey, rowRaw] of Object.entries(item)) {
    const matched = FISCAL_YEAR_KEY.exec(fiscalYearKey);
    const fiscalYear = matched === null ? Number.NaN : Number(matched[1]);
    if (
      !Number.isInteger(fiscalYear) ||
      fiscalYear < MIN_FISCAL_YEAR ||
      fiscalYear > MAX_FISCAL_YEAR
    ) {
      record(reader, {
        block: blockName,
        fiscalYearKey,
        column: COLUMN_YEAR,
        reason: 'year-out-of-range',
        raw: fiscalYearKey,
      });
      continue;
    }

    const isArray = Array.isArray(rowRaw);
    if (!isArray && !isRecordObject(rowRaw)) {
      record(reader, {
        block: blockName,
        fiscalYearKey,
        column: COLUMN_YEAR,
        reason: 'unparsable-value',
        raw: typeof rowRaw,
      });
      continue;
    }

    let isForecast = false;
    if (!isArray) {
      const note = rowRaw[NOTE_KEY];
      if (note === NOTE_FORECAST) {
        isForecast = true;
      } else if (note !== undefined) {
        // 素性の分からない年を平均や CAGR に混ぜると投資判断が変わる（§3.3）
        record(reader, {
          block: blockName,
          fiscalYearKey,
          column: NOTE_KEY,
          reason: 'unknown-note',
          raw: typeof note === 'string' ? note : typeof note,
        });
        continue;
      }
    }

    const values = new Map<string, unknown>();
    columns.forEach((column, index) => {
      values.set(String(column), isArray ? rowRaw[index] : rowRaw[String(index)]);
    });

    if (rows.has(fiscalYear)) {
      // どちらが正か機械的に決められないので、後勝ちにせず両方落とす（§3.2）
      duplicated.add(fiscalYear);
      record(reader, {
        block: blockName,
        fiscalYearKey,
        column: COLUMN_YEAR,
        reason: 'duplicate-year',
        raw: fiscalYearKey,
      });
      continue;
    }
    rows.set(fiscalYear, { fiscalYearKey, isForecast, values });
  }

  for (const fiscalYear of duplicated) rows.delete(fiscalYear);
  return rows;
}

function metaCodeOf(raw: Record<string, unknown>): string | null {
  for (const blockName of [BLOCK_PERFORMANCE, BLOCK_DIVIDEND, BLOCK_BALANCE]) {
    const block = raw[blockName];
    if (!isRecordObject(block)) continue;
    const meta = block['meta'];
    if (!isRecordObject(meta)) continue;
    const code = meta['code'];
    if (typeof code === 'string' && code !== '') return code;
  }
  return null;
}

/**
 * IRバンクの `fy-data-all.json` を取り込み用の形へ正規化する。
 *
 * @param raw `JSON.parse` 済みの値。形の検査はここで行う
 * @param expectedCode 要求した銘柄コード。`meta.code` と一致するか検査する
 */
export function parseFyData(
  raw: unknown,
  expectedCode: string,
): Result<ImportedFinancials, ParseFyDataError> {
  if (!isRecordObject(raw)) {
    return err({ kind: 'unexpected-shape', detail: 'ルートがオブジェクトでない' });
  }

  const actualCode = metaCodeOf(raw);
  if (actualCode === null) {
    return err({ kind: 'unexpected-shape', detail: 'meta.code が見つからない' });
  }
  if (actualCode !== expectedCode) {
    return err({ kind: 'code-mismatch', expected: expectedCode, actual: actualCode });
  }

  const reader: Reader = { diagnostics: [] };

  const performance = normalizeBlock(reader, BLOCK_PERFORMANCE, raw[BLOCK_PERFORMANCE]);
  if ('error' in performance) return err({ kind: 'unexpected-shape', detail: performance.error });
  const dividend = normalizeBlock(reader, BLOCK_DIVIDEND, raw[BLOCK_DIVIDEND]);
  if ('error' in dividend) return err({ kind: 'unexpected-shape', detail: dividend.error });

  // 財務は BPS（⑨ PBR）にしか使わない。欠けていても取り込みは成立させる
  const balanceResult = normalizeBlock(reader, BLOCK_BALANCE, raw[BLOCK_BALANCE]);
  const balance = 'error' in balanceResult ? null : balanceResult;

  const fiscalYears = [...new Set([...performance.keys(), ...dividend.keys()])].sort(
    (a, b) => a - b,
  );

  const records: FinancialRecord[] = [];
  const dividends: DividendRecord[] = [];
  /** 前年比の桁チェック用。1株配当は `dividends` にしか無い（ADR-0009） */
  const dividendSenByYear = new Map<number, number | null>();

  for (const fiscalYear of fiscalYears) {
    const performanceRow = performance.get(fiscalYear);
    const dividendRow = dividend.get(fiscalYear);

    const dividendPerShareSen =
      dividendRow === undefined
        ? null
        : senAt(reader, BLOCK_DIVIDEND, dividendRow, COLUMN_DIVIDEND_PER_SHARE);

    const revenueSen =
      performanceRow === undefined
        ? null
        : senAt(reader, BLOCK_PERFORMANCE, performanceRow, COLUMN_REVENUE);
    const operatingIncomeSen =
      performanceRow === undefined
        ? null
        : senAt(reader, BLOCK_PERFORMANCE, performanceRow, COLUMN_OPERATING_INCOME);

    records.push({
      fiscalYear,
      isForecast: (performanceRow?.isForecast ?? false) || (dividendRow?.isForecast ?? false),
      epsSen:
        performanceRow === undefined
          ? null
          : senAt(reader, BLOCK_PERFORMANCE, performanceRow, COLUMN_EPS),
      roePercent:
        performanceRow === undefined
          ? null
          : ratioAt(reader, BLOCK_PERFORMANCE, performanceRow, COLUMN_ROE),
      revenueSen,
      operatingMarginPercent: deriveOperatingMarginPercent(operatingIncomeSen, revenueSen),
    });

    if (dividendRow !== undefined) {
      dividendSenByYear.set(fiscalYear, dividendPerShareSen);
      dividends.push({
        fiscalYear,
        // IRバンクは修正を別行にしないので `revised` は生成されない（§3.3）
        kind: dividendRow.isForecast ? 'forecast' : 'actual',
        annualAmountSen: dividendPerShareSen,
      });
    }
  }

  // 隣り合う年度どうしで急変を見る（§5.3）。**除外はしない。記録だけ残す**
  //
  // ⚠️ `records` は業績と配当の年度の**和集合**で、間の年度が両方の
  // ブロックに無ければ配列上は隣り合っていても暦年としては隣り合わない
  // （例: 決算期変更で1年が丸ごと欠ける。§3.2）。「前年比」と謳う以上、
  // **暦年で1年differenceのときだけ**比較する。2年以上離れた年度を
  // 1年分の変化率として扱うと、複数年の複利成長を株式分割と誤検出する
  // （逆に、複数年にまたがった本物の分割の比率が薄まって見逃されることもある）。
  for (let index = 1; index < records.length; index += 1) {
    const previous = records[index - 1];
    const current = records[index];
    if (previous === undefined || current === undefined) continue;
    if (current.fiscalYear - previous.fiscalYear !== 1) continue;

    const performanceRow = performance.get(current.fiscalYear);
    if (performanceRow !== undefined) {
      recordSuspiciousJump(
        reader,
        BLOCK_PERFORMANCE,
        performanceRow,
        COLUMN_EPS,
        previous.epsSen,
        current.epsSen,
      );
    }
    const dividendRow = dividend.get(current.fiscalYear);
    if (dividendRow !== undefined) {
      recordSuspiciousJump(
        reader,
        BLOCK_DIVIDEND,
        dividendRow,
        COLUMN_DIVIDEND_PER_SHARE,
        dividendSenByYear.get(previous.fiscalYear) ?? null,
        dividendSenByYear.get(current.fiscalYear) ?? null,
      );
    }
  }

  if (records.length === 0) return err({ kind: 'no-usable-year' });

  // ⑨ の PER は予想EPSを優先する（§3.5）。無ければ実績EPSで代用
  const latestForecastRecord = [...records]
    .reverse()
    .find((entry) => entry.isForecast && entry.epsSen !== null);
  const latestActualRecord = [...records]
    .reverse()
    .find((entry) => !entry.isForecast && entry.epsSen !== null);

  let latestActualBpsSen: number | null = null;
  if (balance !== null) {
    for (const fiscalYear of [...balance.keys()].sort((a, b) => b - a)) {
      const row = balance.get(fiscalYear);
      if (row === undefined || row.isForecast) continue;
      const bps = senAt(reader, BLOCK_BALANCE, row, COLUMN_BPS);
      if (bps !== null) {
        latestActualBpsSen = bps;
        break;
      }
    }
  }

  return ok({
    code: actualCode,
    records,
    dividends,
    latestForecastEpsSen: latestForecastRecord?.epsSen ?? null,
    latestActualEpsSen: latestActualRecord?.epsSen ?? null,
    latestActualBpsSen,
    diagnostics: reader.diagnostics,
  });
}
