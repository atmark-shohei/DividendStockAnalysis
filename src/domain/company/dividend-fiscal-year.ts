/**
 * Yahoo から取れる権利落ちベースの配当（`DividendPayment[]`）を、決算年度ごとの
 * `DividendRecord[]` に集計する。
 *
 * 仕様: `docs/02_design/logic/market-data-source.md` §3.2・§3.4・§4.2
 *
 * **純粋関数。ネットワークを知らない。** 決算月は別のデータ源（IRバンク）から来るため、
 * 取得ポート（`market-data-source.ts`）から分離してある（§4.2 の理由1）。
 *
 * ⚠️ **円 → 銭の変換もここで行う。** 個々の支払いではなく**年度合計を丸める**
 * （§3.4「合算してから丸める」）ため、`DividendPayment.amountYenText`（未変換の文字列）
 * を受け取り、年度ごとに集めてから変換する。
 */

import { type ImportDiagnostic } from './financial-source';
import { type DividendRecord } from './dividend-record';
import { type DividendPayment } from './market-data-source';
import { type Result, err, ok } from '../shared/result';

/** ドメインは throw しない。決算月が使えない形なら集計せずエラーを返す（`.claude/CLAUDE.md`） */
export type DividendFiscalYearError = { readonly kind: 'invalid-fiscal-year-end-month' };

export interface FiscalYearDividends {
  readonly records: readonly DividendRecord[];
  readonly diagnostics: readonly ImportDiagnostic[];
}

/**
 * 診断のブロック名・列名（設計書 §8-7 / ユーザー確定事項）。
 *
 * IRバンクの `一株配当`（1回ごとの単価）とは意味が違う（こちらは年度合計）ので、
 * 混同しないよう別の列名にする。`resolveField`（`import-review.ts`）は
 * `block==='配当' && column==='一株配当'` しか `dividendYen` に解決しないため、
 * この診断は画面のセルには対応せず、行外の警告として出る（意図通り）。
 */
const DIAGNOSTIC_BLOCK = '配当';
const DIAGNOSTIC_COLUMN = '年間配当';

/** 円の 1/1,000,000（マイクロ円）単位の整数への変換結果 */
interface MicroYenConversion {
  readonly microYen: number;
  readonly rounded: boolean;
}

/** マイクロ円のスケール桁数。実測の配当額は小数第6位まで（§3.4 例: `0.745833`） */
const MICRO_YEN_DIGITS = 6;
const MICRO_YEN_PADDING = '0'.repeat(MICRO_YEN_DIGITS);
/** 1銭 = 0.01円 = 10,000 マイクロ円 */
const MICRO_YEN_PER_SEN = 10_000;

/**
 * 数値リテラルの文字列をマイクロ円へ。**小数点を文字列のままずらす**
 * （`parseFloat` を経由しない。`parse-fy-data.ts` の `senFromText` と同じ手法を
 * 銭ではなくマイクロ円スケールに広げたもの）。
 */
function microYenFromText(text: string): MicroYenConversion | null {
  const negative = text.startsWith('-');
  const body = negative ? text.slice(1) : text;
  const dot = body.indexOf('.');
  const integerPart = dot === -1 ? body : body.slice(0, dot);
  const fractionPart = dot === -1 ? '' : body.slice(dot + 1);

  const truncated = Number(
    integerPart + `${fractionPart}${MICRO_YEN_PADDING}`.slice(0, MICRO_YEN_DIGITS),
  );
  if (!Number.isSafeInteger(truncated)) return null;

  const dropped = fractionPart.slice(MICRO_YEN_DIGITS);
  if (dropped === '') return { microYen: negative ? -truncated : truncated, rounded: false };

  const droppedHead = dropped[0];
  const carried = droppedHead !== undefined && Number(droppedHead) >= 5 ? truncated + 1 : truncated;
  if (!Number.isSafeInteger(carried)) return null;
  return { microYen: negative ? -carried : carried, rounded: true };
}

interface SenConversion {
  readonly sen: number;
  readonly rounded: boolean;
}

/** マイクロ円の合計を銭へ。整数の除算・剰余だけで丸める（浮動小数点を経由しない） */
function senFromMicroYenSum(microYenSum: number): SenConversion | null {
  const negative = microYenSum < 0;
  const magnitude = Math.abs(microYenSum);
  const truncatedSen = Math.trunc(magnitude / MICRO_YEN_PER_SEN);
  const remainder = magnitude % MICRO_YEN_PER_SEN;
  const roundedSen = remainder * 2 >= MICRO_YEN_PER_SEN ? truncatedSen + 1 : truncatedSen;
  if (!Number.isSafeInteger(roundedSen)) return null;
  return { sen: negative ? -roundedSen : roundedSen, rounded: remainder !== 0 };
}

interface YearSum {
  readonly sen: number | null;
  readonly rounded: boolean;
  readonly unsafe: boolean;
  readonly raw: string;
}

/** 1年度ぶんの支払いを合算してから銭へ丸める（§3.4「合算してから丸める」） */
function sumYear(payments: readonly DividendPayment[]): YearSum {
  const raw = payments.map((payment) => payment.amountYenText).join(' + ');
  let microYenSum = 0;
  let roundedAtPaymentLevel = false;

  for (const payment of payments) {
    const converted = microYenFromText(payment.amountYenText);
    if (converted === null) return { sen: null, rounded: roundedAtPaymentLevel, unsafe: true, raw };
    if (converted.rounded) roundedAtPaymentLevel = true;
    microYenSum += converted.microYen;
    if (!Number.isSafeInteger(microYenSum)) {
      return { sen: null, rounded: roundedAtPaymentLevel, unsafe: true, raw };
    }
  }

  const converted = senFromMicroYenSum(microYenSum);
  if (converted === null) return { sen: null, rounded: roundedAtPaymentLevel, unsafe: true, raw };
  return {
    sen: converted.sen,
    rounded: roundedAtPaymentLevel || converted.rounded,
    unsafe: false,
    raw,
  };
}

/** `YYYY-MM-DD` から年・月を取り出す。フォーマットは infra 側が保証する（§3.1） */
function yearMonthOf(dateText: string): { readonly year: number; readonly month: number } {
  const [yearText, monthText] = dateText.split('-');
  return { year: Number(yearText), month: Number(monthText) };
}

/**
 * 権利落ち日が属する決算年度（§3.2）。
 *
 * 決算年度 `Y` の期間 = `Y-1` 年の `M+1` 月1日 〜 `Y` 年の `M` 月末日
 * （`M` = 決算月。`M = 12` なら暦年と一致する）。
 */
function fiscalYearOf(dateText: string, fiscalYearEndMonth: number): number {
  const { year, month } = yearMonthOf(dateText);
  return month <= fiscalYearEndMonth ? year : year + 1;
}

/** `year` 年 `month` 月の末日 */
function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** `asOf` がちょうど決算月の末日か（進行中の年度かどうかの境界。§3.2） */
function isFiscalYearEndDay(asOf: Date, fiscalYearEndMonth: number): boolean {
  const year = asOf.getUTCFullYear();
  const month = asOf.getUTCMonth() + 1;
  const day = asOf.getUTCDate();
  return month === fiscalYearEndMonth && day === lastDayOfMonth(year, fiscalYearEndMonth);
}

/**
 * `asOf` 時点で集計してよい最新の決算年度（§3.2「進行中の年度は集計しない」）。
 *
 * 期間末日ちょうどなら、その年度も「完了した」とみなして含める。
 */
function maxCompleteFiscalYear(asOf: Date, fiscalYearEndMonth: number): number {
  const year = asOf.getUTCFullYear();
  const month = asOf.getUTCMonth() + 1;
  const currentFiscalYear = month <= fiscalYearEndMonth ? year : year + 1;
  return isFiscalYearEndDay(asOf, fiscalYearEndMonth) ? currentFiscalYear : currentFiscalYear - 1;
}

/**
 * 権利落ちベースの配当を決算年度ごとに集計する。
 *
 * @param payments 権利落ち日の昇順である必要はない
 * @param fiscalYearEndMonth 決算月（1〜12の整数）。IRバンクの年度キーから導出したもの
 * @param asOf 取得時点。**呼び出し側が渡す。**関数内で `Date.now()` を読まない
 *   （設計書 §7.1「取得時点は引数で渡す」。テストできなくなるのを避ける）
 */
export function toFiscalYearDividends(
  payments: readonly DividendPayment[],
  fiscalYearEndMonth: number,
  asOf: Date,
): Result<FiscalYearDividends, DividendFiscalYearError> {
  if (!Number.isInteger(fiscalYearEndMonth) || fiscalYearEndMonth < 1 || fiscalYearEndMonth > 12) {
    // 推測で3月を既定にしない（設計書 §3.2）
    return err({ kind: 'invalid-fiscal-year-end-month' });
  }

  if (payments.length === 0) return ok({ records: [], diagnostics: [] });

  const maxCompleteFy = maxCompleteFiscalYear(asOf, fiscalYearEndMonth);

  const byYear = new Map<number, DividendPayment[]>();
  for (const payment of payments) {
    const fiscalYear = fiscalYearOf(payment.exDividendDate, fiscalYearEndMonth);
    if (fiscalYear > maxCompleteFy) continue; // 進行中の年度は作らない
    const existing = byYear.get(fiscalYear);
    if (existing === undefined) byYear.set(fiscalYear, [payment]);
    else existing.push(payment);
  }

  if (byYear.size === 0) return ok({ records: [], diagnostics: [] });

  const minFiscalYear = Math.min(...byYear.keys());

  const records: DividendRecord[] = [];
  const diagnostics: ImportDiagnostic[] = [];

  // カバー範囲 = 最古の権利落ち日を含む年度 〜 直近の完了year（§3.2）。
  // 内側の空白年は 0（無配）、外側はレコードを作らない
  for (let fiscalYear = minFiscalYear; fiscalYear <= maxCompleteFy; fiscalYear += 1) {
    const yearPayments = byYear.get(fiscalYear);
    if (yearPayments === undefined) {
      records.push({ fiscalYear, kind: 'actual', annualAmountSen: 0 });
      continue;
    }

    const sum = sumYear(yearPayments);
    const fiscalYearKey = String(fiscalYear);

    if (sum.unsafe) {
      diagnostics.push({
        block: DIAGNOSTIC_BLOCK,
        fiscalYearKey,
        column: DIAGNOSTIC_COLUMN,
        reason: 'unsafe-integer',
        raw: sum.raw,
      });
      records.push({ fiscalYear, kind: 'actual', annualAmountSen: null });
      continue;
    }

    if (sum.rounded) {
      diagnostics.push({
        block: DIAGNOSTIC_BLOCK,
        fiscalYearKey,
        column: DIAGNOSTIC_COLUMN,
        reason: 'rounded',
        raw: sum.raw,
      });
    }

    // 丸めた結果 0 銭になる年度は無配ではなく判定不能（§3.4）。
    // 実際に支払いが 0 円だった年度（丸め無しで sen === 0）とは区別する
    if (sum.sen === 0 && sum.rounded) {
      records.push({ fiscalYear, kind: 'actual', annualAmountSen: null });
      continue;
    }

    records.push({ fiscalYear, kind: 'actual', annualAmountSen: sum.sen });
  }

  return ok({ records, diagnostics });
}
