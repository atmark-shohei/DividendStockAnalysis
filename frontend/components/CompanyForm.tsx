import { useEffect, useRef, useState } from 'react';

import { type PbrSource, type PerSource } from '@/domain/company/company';
import { deriveMarketMultiples } from '@/domain/company/market-multiples';

import type {
  AnalyzeCompanyRequest,
  EdinetImportResponse,
  IrBankImportResponse,
  MarketDataImportResponse,
} from '../api';
import * as api from '../api';
import {
  fiscalPeriodLabel,
  formatPriceAsOf,
  formatSen,
  multipleSourceText,
  ratioToEditableText,
  reasonText,
  senToEditableText,
} from '../format';
import { BalanceSheetFields } from './BalanceSheetFields';

/**
 * 銘柄データの入力フォーム。
 *
 * `.claude/rules/frontend.md`:
 * - 数値入力は範囲検証する
 * - 全角数字は半角に正規化する（日本語環境では日常的に混入する）
 * - 銘柄コードは形式検証してから API に渡す
 */

const FULLWIDTH_OFFSET = 0xfee0;

/** 全角英数記号を半角へ。IME のマイナス記号（U+2212）も直す */
function toHalfWidth(raw: string): string {
  return raw
    .replace(/[！-～]/g, (char) => String.fromCharCode(char.charCodeAt(0) - FULLWIDTH_OFFSET))
    .replace(/−/g, '-')
    .replace(/　/g, ' ')
    .trim();
}

/** 円の入力を銭へ。空欄は `null`（0 ではない）。読めなければ `undefined` */
function yenToSen(raw: string): number | null | undefined {
  const normalized = toHalfWidth(raw).replace(/,/g, '');
  if (normalized === '') return null;
  if (!/^-?\d+(\.\d{1,2})?$/.test(normalized)) return undefined;
  const sen = Math.round(Number(normalized) * 100);
  return Number.isSafeInteger(sen) ? sen : undefined;
}

/** %・倍の入力。空欄は `null` */
function toRatio(raw: string): number | null | undefined {
  const normalized = toHalfWidth(raw);
  if (normalized === '') return null;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : undefined;
}

interface YearRow {
  readonly fiscalYear: string;
  readonly isForecast: boolean;
  readonly epsYen: string;
  readonly roePercent: string;
  readonly revenueYen: string;
  readonly operatingMarginPercent: string;
  readonly dividendYen: string;
}

function emptyRow(fiscalYear: number, isForecast = false): YearRow {
  return {
    fiscalYear: String(fiscalYear),
    isForecast,
    epsYen: '',
    roePercent: '',
    revenueYen: '',
    operatingMarginPercent: '',
    dividendYen: '',
  };
}

const THIS_YEAR = new Date().getFullYear();
/** ①⑦ が5年前を見るので6行、④ は6年分が要る。既定でその年数を出す */
const DEFAULT_ROWS = 6;

type ImportedRecord = IrBankImportResponse['records'][number];
/** 1株配当は `records` ではなくこちらから来る（ADR-0009） */
type IrBankDividendView = IrBankImportResponse['dividends'][number];
/** 診断をどのセルの話かに解決したもの。**判定は domain 側**（`import-review.ts` §3.2） */
type CellWarning = IrBankImportResponse['cellWarnings'][number];
type YearRowField = NonNullable<CellWarning['field']>;
/**
 * ⑥ 用に取り込んだ金額と、それがどの決算年度の値かの組
 * （`docs/02_design/logic/balance-sheet-derivation.md` §2.3）。
 * domain から直接 import せず応答型から導出する（`ImportedRecord` と同じ方針）。
 */
type ImportedAmountView = NonNullable<IrBankImportResponse['totalLiabilities']>;

/** Yahoo由来の年度別配当。業績データを伴わない（`docs/02_design/ui/pages/market-data-import.md` §5.2） */
type MarketDataDividendYear = MarketDataImportResponse['dividendRecords'][number];
type MarketDataSplitView = MarketDataImportResponse['splits'][number];
/**
 * 市場データ取り込みの取得診断。IRバンクの `CellWarning` と違い、画面のセルへは解決しない
 * （`field`・`valueKept` を持たない）。`rowlessWarningText` と同じ「1件ずつ列挙」の
 * 体裁で表の外に出す（同設計書 §5.5）。
 */
type MarketDataDiagnostic = MarketDataImportResponse['diagnostics'][number];

/**
 * EDINET由来の年度別データ（④EPS・⑦売上高の古い年度、⑤ROE）。営業利益率は持たない
 * （`docs/02_design/logic/edinet-history-import.md` §4.6）。ROE は EDINET の公表列ではなく、
 * 純利益÷期末自己資本で自算した値（同 §4.1.1）。domain から直接 import せず
 * BE確定DTO（`src/handler/dto/edinet-import.ts`）から導出する（`ImportedRecord` と同じ方針）。
 *
 * `sourceDocId` は貸借対照表側のみ画面表示する決定（Manager決定。fe-review 推測仕様#2）
 * のため、年度別データ側では未使用のまま保持する（型は持つが表示には使わない）。
 */
type ImportedEdinetYear = EdinetImportResponse['years'][number];

/**
 * EDINET取り込みの取得診断（BE確定DTO。2026-08-09）。IRバンクの `CellWarning` と違い
 * 画面のセルへは解決しない（`valueKept` を持たず、値を採用したかの分岐が無い）ため、
 * `MarketDataDiagnostic` と同じ「表の外に1件ずつ列挙」の体裁で出す
 * （`docs/02_design/logic/import-review.md` §5.3「件数だけに潰さない」）。
 */
type EdinetImportDiagnostic = EdinetImportResponse['diagnostics'][number];

/** 行そのものが落ちたことを示す列名（`src/infra/irbank/parse-fy-data.ts` と同じ値） */
const ROW_LEVEL_COLUMNS = new Set(['年度', '備考']);

/** 理由ごとの固定文言（`docs/02_design/logic/import-review.md` §5.2） */
function warningReasonText(reason: CellWarning['reason']): string {
  switch (reason) {
    case 'unparsable-value':
      return '数値として読めない値でした';
    case 'unsafe-integer':
      return '桁が大きすぎて取り込めない金額でした';
    case 'rounded':
      return '小数第3位以下を丸めました';
    case 'suspicious-jump':
      return '前年からの変化が大きすぎます（株式分割の反映漏れの疑い）';
    case 'year-out-of-range':
      return '決算年度として読めないキーでした';
    case 'duplicate-year':
      return '同じ決算年度が重複していました。どちらの値も採用していません';
    case 'unknown-note':
      return '予想と実績のどちらとも判断できない注記が付いていました';
    case 'inconsistent-value':
      return '他の値と突き合わせると成立しない値でした';
  }
}

/** 元のキーも併記する。3月期以外は年度だけでは原典と突き合わせられない（同 §3.4） */
function yearLabel(warning: CellWarning): string {
  if (warning.fiscalYear === null) return `決算期 ${warning.fiscalYearKey}`;
  return `${String(warning.fiscalYear)}年度（${warning.fiscalYearKey}）`;
}

/**
 * セル警告の文言。**⚠記号と文言を必ず添える。色だけで表現しない**
 * （`.claude/rules/frontend.md`。同 §5.2）。値を採用したかどうかが、
 * 文言を変える唯一の分岐（同 §3.2）。
 */
export function cellWarningText(warning: CellWarning): string {
  const handling = warning.valueKept
    ? '値は採用しています。原典と見比べて確認してください'
    : 'この欄は空欄にしました。必要なら手入力してください';
  return `⚠ ${warningReasonText(warning.reason)}。${handling}`;
}

/** 表の外に出す警告。行ごと落ちたもの・画面に欄が無い列（同 §5.3） */
export function rowlessWarnings(warnings: readonly CellWarning[]): readonly CellWarning[] {
  return warnings.filter((warning) => warning.field === null);
}

/** 行に紐づかない警告の文言。**件数に潰さず、年度と理由を1件ずつ出す**（同 §5.3） */
export function rowlessWarningText(warning: CellWarning): string {
  const reason = warningReasonText(warning.reason);
  if (ROW_LEVEL_COLUMNS.has(warning.column)) {
    return `⚠ ${yearLabel(warning)}の行は取り込めませんでした: ${reason}。必要なら「年度を追加」で手入力してください`;
  }
  // 画面に欄が無い列。営業利益率が空欄なのは元の営業利益が読めなかったからだと伝える（同 §3.2）
  const handling = warning.valueKept ? '値は採用しています' : '取り込めていません';
  return `⚠ ${yearLabel(warning)}の${warning.column}は${handling}: ${reason}`;
}

/** そのセルに出す警告。`aria-invalid` を付けるかもこれで決める（同 §5.2） */
export function warningsForCell(
  warnings: readonly CellWarning[],
  fiscalYear: string,
  field: YearRowField,
): readonly CellWarning[] {
  return warnings.filter(
    (warning) => warning.field === field && String(warning.fiscalYear) === fiscalYear,
  );
}

/**
 * 編集されたセルの警告を落とす。ユーザーが値を直した時点でその警告は用済みになる
 * （同 §5.6）。**再検証はしない**（手入力値の妥当性は取り込みの責務ではない）。
 *
 * `fiscalYear` 欄自体を編集したときは、行の対応年度が変わるので**その行の
 * 警告を全部落とす**（`field` の一致では拾えないため。code-reviewer 指摘、2026-07-30）。
 */
export function dropEditedWarnings(
  warnings: readonly CellWarning[],
  fiscalYear: string,
  patch: Partial<YearRow>,
): readonly CellWarning[] {
  if ('fiscalYear' in patch) {
    return warnings.filter(
      (warning) => warning.field === null || String(warning.fiscalYear) !== fiscalYear,
    );
  }
  const editedFields = new Set(Object.keys(patch));
  return warnings.filter(
    (warning) =>
      warning.field === null ||
      String(warning.fiscalYear) !== fiscalYear ||
      !editedFields.has(warning.field),
  );
}

/**
 * 保存前の確認が要るか（同 §5.6）。`valueKept: true` の警告
 * （`suspicious-jump` / `rounded`）は値を採用したまま残っているので、
 * 人が見たかどうかを1回だけ確かめる。
 *
 * **値が落ちた警告は対象にしない。** その欄は空欄になっているだけで、
 * 確認しても採用される値が無い。
 */
export function hasUnconfirmedWarnings(warnings: readonly CellWarning[]): boolean {
  return warnings.some((warning) => warning.valueKept);
}

/**
 * 確認の文言。**⚠記号と件数を添える。色だけで表現しない**
 * （`.claude/rules/frontend.md`）。ここは「どこが怪しいか」を伝える場では
 * ないので件数でよい（該当セルは表の中で既に指している。同 §5.2）。
 */
export function confirmWarningsText(warnings: readonly CellWarning[]): string {
  const count = warnings.filter((warning) => warning.valueKept).length;
  return `⚠ 値を採用したまま警告が残っている項目が ${String(count)} 件あります。原典と見比べて確認しましたか？`;
}

/**
 * 確認を挟むか（同 §5.6）。**ペイロードは運ばない。**
 *
 * 以前はペイロードのスナップショットを確認待ちの間だけ保持していたが、確認バナー表示中に
 * ユーザーがセルを直すと古い値が保存されるバグがあった（code-reviewer 指摘、2026-07-30）。
 * 送信するかどうかの判定だけを純粋関数にし、ペイロードは送信の瞬間に
 * `handleSubmit` が毎回組み立て直す。
 */
export function shouldShowConfirmation(
  warnings: readonly CellWarning[],
  awaitingConfirmation: boolean,
): boolean {
  return hasUnconfirmedWarnings(warnings) && !awaitingConfirmation;
}

export function toYearRow(record: ImportedRecord, dividendAnnualAmountSen: number | null): YearRow {
  return {
    fiscalYear: String(record.fiscalYear),
    isForecast: record.isForecast,
    epsYen: senToEditableText(record.epsSen),
    roePercent: ratioToEditableText(record.roePercent),
    revenueYen: senToEditableText(record.revenueSen),
    operatingMarginPercent: ratioToEditableText(record.operatingMarginPercent),
    dividendYen: senToEditableText(dividendAnnualAmountSen),
  };
}

/** 値の入力欄。年度・区分は行を突き合わせる鍵なのでマージの対象にしない */
const VALUE_FIELDS = [
  'epsYen',
  'roePercent',
  'revenueYen',
  'operatingMarginPercent',
  'dividendYen',
] as const;

function fiscalYearOf(row: YearRow): number {
  return Number(toHalfWidth(row.fiscalYear));
}

/** 並びは「予想行 → 実績年度の降順」（同設計書 §5.5） */
function byForecastThenYearDesc(a: YearRow, b: YearRow): number {
  if (a.isForecast !== b.isForecast) return a.isForecast ? -1 : 1;
  return fiscalYearOf(b) - fiscalYearOf(a);
}

export interface MergeRowsWithImportResult {
  readonly rows: readonly YearRow[];
  /** 手入力を取り込み値で置き換えたセル数。呼び出し側が通知に使う（同設計書 §5.5） */
  readonly overwrittenCount: number;
}

/**
 * 取り込み結果を既存の行にマージする。**取り込みは手入力を破壊しない**
 * （`docs/02_design/logic/import-review.md` §5.5）。
 *
 * ①②④⑦ は取り込みで構造的に埋まらない
 * （`docs/02_design/logic/irbank-json-import.md` §6.2）ので、この機能は手入力との
 * 併用が前提になる。したがって「取り込みに無い」を「空である」と解釈してはいけない。
 * 行の同一性は年度だけで決める（同じ年度の行を2つ作らないため）。
 * React の state を知らない純粋関数にしてある（`fillBlankMultiples` と同じ方針）。
 */
export function mergeRowsWithImport(
  existingRows: readonly YearRow[],
  records: readonly ImportedRecord[],
  dividends: readonly IrBankDividendView[],
): MergeRowsWithImportResult {
  const dividendByYear = new Map(dividends.map((d) => [d.fiscalYear, d.annualAmountSen]));
  const importedByYear = new Map(
    records.map((record) => [
      record.fiscalYear,
      toYearRow(record, dividendByYear.get(record.fiscalYear) ?? null),
    ]),
  );
  let overwrittenCount = 0;

  const mergedRows = existingRows.map((existing) => {
    const imported = importedByYear.get(fiscalYearOf(existing));
    if (imported === undefined) return existing;

    const merged = { ...existing, isForecast: imported.isForecast };
    for (const field of VALUE_FIELDS) {
      const value = imported[field];
      if (value === '') continue;
      if (merged[field] !== '' && merged[field] !== value) overwrittenCount += 1;
      merged[field] = value;
    }
    return merged;
  });

  const existingYears = new Set(existingRows.map(fiscalYearOf));
  const addedRows = [...importedByYear]
    .filter(([fiscalYear]) => !existingYears.has(fiscalYear))
    .map(([, row]) => row);

  return {
    rows: [...mergedRows, ...addedRows].sort(byForecastThenYearDesc),
    overwrittenCount,
  };
}

export interface MergeRowsWithEdinetResult {
  readonly rows: readonly YearRow[];
  /** 空欄を取り込み値で埋めたセル数。呼び出し側が通知に使う */
  readonly filledCount: number;
}

/**
 * EDINET取り込み結果（④EPS・⑦売上高の古い年度、⑤ROE）を既存行にマージする。
 *
 * **`mergeRowsWithImport`（IRバンク）とは異なる方針にしてある。** IRバンクの規則1
 * （取り込みが値を持てば無条件で上書きする。同 §5.5）をそのまま流用すると、設計書
 * §4.6「同じ年度が重なったら EDINET を優先して上書きする」を字面どおりフォーム内でも
 * 実装することになる。しかし §4.6 が指すのは **DB層（`financial_records`）のマージ**
 * であり、保存前のフォーム編集中に手入力を無条件で消してよい根拠にはならない
 * （fe-plan.md §2 の整合確認）。フォーム内マージは安全側に倒し、**空欄のときだけ埋める**
 * （`resolveImportedAmount`/`resolveImportedPriceYen` と同じ思想）。Manager決定
 * （2026-08-08。fe-plan.md §5.3 の暫定案をそのまま採用）。
 *
 * EDINETは営業利益率を返さない（設計書 §4.6）ので、その列には触れない
 * （既存の IRバンク由来・手入力値をそのまま残す）。⑤ROEは自算して返すため、
 * EPS・売上高と同じ「空欄のときだけ埋める」規則をそのまま適用する（同 §4.1.1・§4.6）。
 * 行の同一性は年度だけで決める
 * （`mergeRowsWithImport` と同じ）。React の state を知らない純粋関数。
 */
export function mergeRowsWithEdinetImport(
  existingRows: readonly YearRow[],
  years: readonly ImportedEdinetYear[],
): MergeRowsWithEdinetResult {
  const importedByYear = new Map(years.map((year) => [year.fiscalYear, year]));
  let filledCount = 0;

  const mergedRows = existingRows.map((existing) => {
    const imported = importedByYear.get(fiscalYearOf(existing));
    if (imported === undefined) return existing;

    let merged = existing;
    if (merged.epsYen === '' && imported.epsSen !== null) {
      merged = { ...merged, epsYen: senToEditableText(imported.epsSen) };
      filledCount += 1;
    }
    if (merged.revenueYen === '' && imported.revenueSen !== null) {
      merged = { ...merged, revenueYen: senToEditableText(imported.revenueSen) };
      filledCount += 1;
    }
    if (merged.roePercent === '' && imported.roePercent !== null) {
      merged = { ...merged, roePercent: ratioToEditableText(imported.roePercent) };
      filledCount += 1;
    }
    return merged;
  });

  // 取り込みにあって既存に無い年度は行を追加する（`mergeRowsWithImport` と同じ規則）。
  // EDINETは予想値を返さない（設計書 §1.2）ので追加行は必ず実績
  const existingYears = new Set(existingRows.map(fiscalYearOf));
  const addedRows = years
    .filter((year) => !existingYears.has(year.fiscalYear))
    .map((year) => {
      let added = emptyRow(year.fiscalYear, false);
      if (year.epsSen !== null) {
        added = { ...added, epsYen: senToEditableText(year.epsSen) };
        filledCount += 1;
      }
      if (year.revenueSen !== null) {
        added = { ...added, revenueYen: senToEditableText(year.revenueSen) };
        filledCount += 1;
      }
      if (year.roePercent !== null) {
        added = { ...added, roePercent: ratioToEditableText(year.roePercent) };
        filledCount += 1;
      }
      return added;
    });

  return {
    rows: [...mergedRows, ...addedRows].sort(byForecastThenYearDesc),
    filledCount,
  };
}

/**
 * EDINET取り込みが検出した遡及修正の通知文言（設計書 §4.3・§2.6）。
 *
 * ④EPS・⑦売上高は独立に判定不能へ倒れる（同 §4.3「EPS・売上高は独立に判定する」）ので、
 * どちらが影響を受けたかを明示する（`.claude/rules/frontend.md`「色だけで表現しない」。
 * ⚠記号+文言で伝える）。文言は `format.ts` の `reasonText('restated-history')` を再利用し、
 * 画面文言の定義箇所を1つに保つ（二重定義しない）。
 *
 * 両方 false（遡及修正なし）は通知不要として `null` を返す
 * （`importedAmountNoteText` と同じ「`null` で表示の有無を判定する」方針）。
 */
export function edinetRestatedNoticeText(eps: boolean, revenue: boolean): string | null {
  if (!eps && !revenue) return null;
  return `⚠ ${restatedTargetLabels(eps, revenue).join('・')}: ${reasonText('restated-history')}`;
}

/**
 * 遡及修正の影響を受ける指標。④EPS・⑦売上高は独立に判定する（設計書 §4.3）ので、
 * **まとめて扱う経路を作らない**（解除もそれぞれ独立に行う。Manager決定 2026-08-09）。
 */
export type EdinetRestatedTarget = 'eps' | 'revenue';

/** 画面に出す指標名。文言の定義箇所を1つに保つ（`warningReasonText` と同じ方針） */
const RESTATED_TARGET_LABEL: Record<EdinetRestatedTarget, string> = {
  eps: '④EPS CAGR',
  revenue: '⑦売上高CAGR',
};

export function restatedTargetLabel(target: EdinetRestatedTarget): string {
  return RESTATED_TARGET_LABEL[target];
}

function restatedTargetLabels(eps: boolean, revenue: boolean): readonly string[] {
  return [
    eps ? RESTATED_TARGET_LABEL.eps : null,
    revenue ? RESTATED_TARGET_LABEL.revenue : null,
  ].filter((label): label is string => label !== null);
}

/**
 * ④⑦それぞれについての真偽値の組。**同じ形だが意味の異なる2つの用途がある**ため、
 * 用途ごとにブランドを付けた派生型（`EdinetDetectedRestated` /
 * `EdinetRestatedRelease`）で区別する。TypeScript は構造的型付けなので、
 * 別名の型に分けただけでは相互に代入できてしまい取り違えを防げない（fe-review CR-1）。
 */
export interface EdinetRestatedFlags {
  readonly eps: boolean;
  readonly revenue: boolean;
}

/**
 * EDINET取り込みが検出した遡及修正という**事実**（重複4期が一致しなかった。設計書 §4.3）。
 * `null` は取り込み未実施。
 *
 * `__brand` は**実行時には存在しない**（型だけの目印。`src/domain/shared/sen.ts` と同じ流儀）。
 * 生成は必ず `createDetectedRestated` を通す。
 */
export type EdinetDetectedRestated = EdinetRestatedFlags & {
  readonly __brand: 'EdinetDetectedRestated';
};

/**
 * 人が「原典を確認した」として判定不能を解除したという**判断**
 * （Manager決定 2026-08-09・案C）。
 *
 * `__brand` は実行時には存在しない。生成は必ず `createRestatedRelease` を通す。
 */
export type EdinetRestatedRelease = EdinetRestatedFlags & {
  readonly __brand: 'EdinetRestatedRelease';
};

/**
 * 検出結果の生成。**キャストはこの中だけ**（`.claude/CLAUDE.md`）。
 * 真偽値2つに不正値は無いので `Result` は返さない（`createSen` と違い守る不変条件が無い）。
 */
export function createDetectedRestated(eps: boolean, revenue: boolean): EdinetDetectedRestated {
  return { eps, revenue } as EdinetDetectedRestated;
}

/** 解除操作の生成。**キャストはこの中だけ** */
export function createRestatedRelease(eps: boolean, revenue: boolean): EdinetRestatedRelease {
  return { eps, revenue } as EdinetRestatedRelease;
}

/** 解除操作の初期値（何も解除していない） */
export const NO_RESTATED_RELEASE: EdinetRestatedRelease = createRestatedRelease(false, false);

/**
 * 解除の状態遷移。**検出結果（`detected`）は書き換えない。**
 * 「EDINETの重複4期が一致しなかった」という事実と「人が確認して解除した」という
 * 判断は別物であり、事実を上書きすると解除を取り消せなくなる（`docs/glossary.md`）。
 * 引数・戻り値を `EdinetRestatedRelease` に限ることで、検出結果を誤って渡す改修を
 * 型で弾く（fe-review CR-1）。
 */
export function toggleRestatedRelease(
  released: EdinetRestatedRelease,
  target: EdinetRestatedTarget,
  release: boolean,
): EdinetRestatedRelease {
  // スプレッド + 計算プロパティではブランド付きの型に合わせるためのキャストが
  // ファクトリ外に漏れる。生成はファクトリへ寄せる（返す値は従来と同じ）
  return createRestatedRelease(
    target === 'eps' ? release : released.eps,
    target === 'revenue' ? release : released.revenue,
  );
}

/**
 * 画面と送信ペイロードが見る、解除を反映した後の状態。
 *
 * - `pending` … 検出済みかつ未解除。⚠警告を出し、**保存時もこの値を送る**
 * - `released` … 検出済みかつ解除済み。解除した旨の告知と「戻す」ボタンを出す
 *
 * `detected` が `null`（取り込み未実施）と `{eps:false,revenue:false}`（取り込み済み・
 * 検出なし）はどちらも両方 `false` になるが、**どちらの場合も解除UIを出さない**
 * （解除する対象が無い）。両者を混同して「解除しました」と言わないための唯一の判定箇所。
 *
 * **ブランドを付けない。** これは検出でも解除操作でもなく、両者から導出した
 * 表示・送信用の状態であり、どちらの入力としても使わない。
 */
export interface EdinetRestatedView {
  readonly pending: EdinetRestatedFlags;
  readonly released: EdinetRestatedFlags;
}

export function resolveRestatedView(
  detected: EdinetDetectedRestated | null,
  released: EdinetRestatedRelease,
): EdinetRestatedView {
  const detectedEps = detected?.eps ?? false;
  const detectedRevenue = detected?.revenue ?? false;
  return {
    pending: {
      eps: detectedEps && !released.eps,
      revenue: detectedRevenue && !released.revenue,
    },
    released: {
      eps: detectedEps && released.eps,
      revenue: detectedRevenue && released.revenue,
    },
  };
}

/**
 * 判定不能を解除したことの告知（設計書 §4.3・案C）。**警告ではないので ⚠ を付けない。**
 * 「⚠が消えるだけ」にすると、解除できたのか取り込みがやり直されたのかを人が区別できない。
 *
 * **「④が算出されます」と断言しない。** 解除しても6期そろっていなければ
 * `insufficient-history` で判定不能のまま（同 §4.3 のコード断片。`insufficient-history` の
 * 判定が先）。**数値（0点など）も出さない**（`edinetAmountNoteText` の `unavailable` と
 * 同じ方針。`.claude/rules/frontend.md`）。
 */
export function edinetRestatedReleasedText(eps: boolean, revenue: boolean): string | null {
  if (!eps && !revenue) return null;
  return `${restatedTargetLabels(eps, revenue).join('・')}: 原典を確認済みとして扱い、判定不能を解除しました（6期分の値がそろっていない場合は判定不能のままです）`;
}

/** 解除ボタンのラベル。対象を文字で書く（色・記号だけで表現しない） */
export function restatedReleaseButtonText(target: EdinetRestatedTarget): string {
  return `${restatedTargetLabel(target)} の判定不能を解除する`;
}

/** 「戻す」ボタンのラベル。誤解除を取り返せるようにする（Manager決定 2026-08-09） */
export function restatedRestoreButtonText(target: EdinetRestatedTarget): string {
  return `${restatedTargetLabel(target)} の解除を戻す`;
}

/**
 * `resolveImportedEdinetAmount` の結果。⑥用の流動資産・投資有価証券に使う。
 *
 * `resolveImportedAmount`（IRバンク）と役割は同じ（空欄のときだけ埋める）が、
 * EDINETの `EdinetBalanceSheetSnapshot` は決算年度を持たず（「前期末時点」固定の
 * スナップショット。設計書 §5）代わりに `sourceDocId`（監査目的。Manager決定）を持つため、
 * 注記に出す出所情報が異なる。**3状態のみ**（IRバンク版にある編集後の `edited` 状態は
 * 対象外。Manager指示のスコープに合わせた）。
 */
export type ResolveEdinetAmountResult =
  | { readonly yen: string; readonly noteKind: 'unavailable' }
  | {
      readonly yen: string;
      readonly noteKind: 'filled' | 'kept-existing';
      readonly sourceDocId: string;
    };

/**
 * 取り込んだ ⑥ 用の金額（流動資産・投資有価証券）を入力欄へ反映するかどうかの判定。
 * **空欄のときだけ埋める。手入力は破壊しない**（`resolveImportedAmount` と同じ規則）。
 *
 * `valueSen === null`（IFRS採用企業で投資有価証券タグが無い等。設計書 §2.7）のとき、
 * **入力欄に `'0'` を書き込まない。** 無借金相当（`valueSen: 0`）は値なので `'0'` を入れる。
 */
export function resolveImportedEdinetAmount(
  currentYen: string,
  valueSen: number | null,
  sourceDocId: string,
): ResolveEdinetAmountResult {
  if (valueSen === null) return { yen: currentYen, noteKind: 'unavailable' };
  if (currentYen !== '') return { yen: currentYen, noteKind: 'kept-existing', sourceDocId };
  return { yen: senToEditableText(valueSen), noteKind: 'filled', sourceDocId };
}

/**
 * どちらの欄の注記を組み立てているか（`YearRowField` と同じ命名思想）。
 * `unavailable` の理由が項目ごとに異なるため導入した（設計書 §2.7）。
 */
export type EdinetAmountField = 'currentAssets' | 'investmentSecurities';

/**
 * ⑥ の入力欄の直下に出す注記（EDINET版）。`sourceDocId` を監査目的で小さく併記する
 * （Manager決定。fe-plan.md §3確認事項2「表示する」を採用）。
 * **`unavailable` に数値を出さない**（データが無いのに `0` を見せない。
 * `.claude/rules/frontend.md`）。
 *
 * `unavailable` の理由は項目ごとに異なる（設計書 §2.7。IFRS採用企業で構造的に
 * 取得できないのは投資有価証券タグのみ。流動資産は `CurrentAssetsIFRS` で取得できる）。
 * 流動資産側に投資有価証券の理由を誤って出していた問題（fe-review CR-2）への対応。
 */
export function edinetAmountNoteText(
  result: ResolveEdinetAmountResult | null,
  field: EdinetAmountField,
): string {
  if (result === null) return '';
  switch (result.noteKind) {
    case 'unavailable':
      return field === 'investmentSecurities'
        ? 'EDINETからは取得できませんでした（IFRS採用企業では投資有価証券が取得できません。原典を確認し手入力してください）'
        : 'EDINETからは取得できませんでした。原典を確認し手入力してください';
    case 'kept-existing':
      return `入力済みのため入れ替えていません（EDINET取り込み値の出所: docID ${result.sourceDocId}）`;
    case 'filled':
      return `EDINET取り込み: 値を入れました（出所: docID ${result.sourceDocId}）`;
  }
}

/**
 * 診断が指す項目の画面名。④⑦は指標名、⑥は入力欄名（`BalanceSheetFields` のラベルと揃える）。
 *
 * `netIncome` / `equity` の文言は Manager決定（2026-08-10、BE実装時に確認済み）。
 * ROE 自算の入力2項目（純利益・自己資本）は「⑤ROEが読めなかった」では原因に辿り着けないため、
 * 項目単位のラベルにする（`edinet-history-import.md` §4.1.1 の型コメントと同じ理由）。
 * 登録フォームへの反映（`roePercent` の表示）は T-028 で実装済み。
 */
const EDINET_DIAGNOSTIC_FIELD_LABEL: Record<EdinetImportDiagnostic['field'], string> = {
  eps: '④EPS',
  revenue: '⑦売上高',
  currentAssets: '⑥流動資産',
  investmentSecurities: '⑥投資有価証券',
  netIncome: '⑤純利益',
  equity: '⑤自己資本',
};

/**
 * 診断の理由。**`reason` の生の英字を画面に出さない。**
 * `CellWarning['reason']` と重なる種別は `warningReasonText` に委譲し、
 * 文言の定義箇所を1つに保つ（`format.ts` の `reasonText` と同じ方針）。
 */
function edinetDiagnosticReasonText(reason: EdinetImportDiagnostic['reason']): string {
  if (reason === 'unit-mismatch') return '想定していない単位で記載されていました';
  return warningReasonText(reason);
}

/**
 * EDINET取り込みの診断1件の文言。**捨てない・件数に潰さない**
 * （`.claude/rules/backend.md`・`docs/02_design/logic/import-review.md` §5.3）。
 * `marketDiagnosticText` と同じ体裁で表の外に列挙する。
 *
 * `fiscalYear` が `null`（貸借対照表項目。「前期末時点」のスナップショットで決算年度を
 * 持たない。設計書 §5）のときは**年度を書かない**。
 * `elementId`（XBRL要素ID）と `sourceDocId` は原因調査用なので、`edinetAmountNoteText` の
 * docID と同じく括弧内へ小さく併記する（Manager決定 2026-08-09）。
 *
 * **値の代わりに `0` を出さない。** 診断は「値が取れなかった」ことの記録であり、
 * 出せるのは原典の生値（`raw`）だけ（`.claude/rules/frontend.md`）。
 */
/**
 * 診断の枠（`<ul>`）を出すか。**0件のときは枠ごと出さない**（設計書 §7.2）。
 * 中身の無い枠だけが残ると「診断があるのに読めない」ように見え、取り込みが
 * 失敗したのかどうかを人が判断できなくなる。`marketDiagnostics` と同じ体裁。
 *
 * 判定を JSX から純粋関数へ出しているのは、テストで固定するため
 * （`shouldShowConfirmation` と同じ方針。fe-review CR-2）。
 */
export function shouldShowEdinetDiagnostics(
  diagnostics: readonly EdinetImportDiagnostic[],
): boolean {
  return diagnostics.length > 0;
}

export function edinetDiagnosticText(diagnostic: EdinetImportDiagnostic): string {
  const year = diagnostic.fiscalYear === null ? '' : `${String(diagnostic.fiscalYear)}年度の`;
  const label = EDINET_DIAGNOSTIC_FIELD_LABEL[diagnostic.field];
  // 空文字をそのまま出すと「元の値: 」で切れて読めない。原典が空だったことを言葉で書く
  const raw = diagnostic.raw === '' ? '元の値: 空欄' : `元の値: ${diagnostic.raw}`;
  return `⚠ ${year}${label}はEDINETから取り込めませんでした: ${edinetDiagnosticReasonText(diagnostic.reason)}（${raw} / 出所: docID ${diagnostic.sourceDocId} / XBRL要素ID: ${diagnostic.elementId}）`;
}

export interface MergeDividendYearsResult {
  readonly rows: readonly YearRow[];
  /** 手入力を取り込み値で置き換えたセル数。呼び出し側が通知に使う */
  readonly overwrittenCount: number;
}

/**
 * Yahoo由来の年度別配当（業績データを伴わない）を既存行にマージする。
 * `docs/02_design/ui/pages/market-data-import.md` §5.2 / §7。
 *
 * `mergeRowsWithImport` と違い、対応する `records`（業績）が無い年度でも
 * 配当だけの行を新規追加する（Yahooの配当がIRバンクの業績データより古い年度まで
 * 遡るため。`market-data-source.md` §2.2）。「手入力を破壊しない・行の同一性は
 * 年度だけで決める」という設計方針は `mergeRowsWithImport` と同じ。
 *
 * `annualAmountSen: null`（判定不能。丸めた結果0銭になった場合、または銭換算が
 * 安全整数を超えた場合。`src/domain/company/dividend-fiscal-year.ts` の
 * `toFiscalYearDividends`。同設計書 §3.4）は `senToEditableText` で空文字になり、
 * 既存の手入力を上書きしない
 * （`mergeRowsWithImport` が空文字の取り込み値をスキップするのと同じ扱い）。
 * `annualAmountSen: 0`（無配）は `'0'` として通常どおり反映する。
 * **`null` と `0` を混同しない**（`.claude/rules/frontend.md`）。
 */
export function mergeDividendYears(
  existingRows: readonly YearRow[],
  dividendYears: readonly MarketDataDividendYear[],
): MergeDividendYearsResult {
  const dividendByYear = new Map(
    dividendYears.map((entry) => [entry.fiscalYear, entry.annualAmountSen]),
  );
  let overwrittenCount = 0;

  const mergedRows = existingRows.map((existing) => {
    const amountSen = dividendByYear.get(fiscalYearOf(existing));
    if (amountSen === undefined) return existing;

    const value = senToEditableText(amountSen);
    // 判定不能（空文字）は手入力を消さない（`mergeRowsWithImport` と同じ方針）
    if (value === '') return existing;
    if (existing.dividendYen !== '' && existing.dividendYen !== value) overwrittenCount += 1;
    return { ...existing, dividendYen: value };
  });

  const existingYears = new Set(existingRows.map(fiscalYearOf));
  const addedRows = [...dividendByYear]
    .filter(([fiscalYear]) => !existingYears.has(fiscalYear))
    .map(([fiscalYear, amountSen]) => ({
      ...emptyRow(fiscalYear),
      dividendYen: senToEditableText(amountSen),
    }));

  return {
    rows: [...mergedRows, ...addedRows].sort(byForecastThenYearDesc),
    overwrittenCount,
  };
}

/**
 * 株式分割・併合イベントの表示文言。**参考情報であり自動反映されない**
 * （同設計書 §5.3）。`splitRatio` の文字列はパースせず、数値の比較だけで向きを決める
 * （`market-data-source.md` §3.5。文字列は分割・併合で向きが逆になり取り違える）。
 */
export function splitEventText(split: MarketDataSplitView): string {
  const ratio = split.numerator / split.denominator;
  const kind = ratio > 1 ? '分割' : ratio < 1 ? '併合' : '変化なし';
  return `${split.date}: ${String(split.numerator)}株 / ${String(split.denominator)}株（${kind}）`;
}

/**
 * 市場データ取り込みの診断1件の文言。**捨てない・件数に潰さない**
 * （`.claude/rules/backend.md`・同設計書 §5.5）。`rowlessWarningText` と同じ体裁で
 * 表の外に列挙する。`ImportDiagnostic['reason']` は `CellWarning['reason']` と同じ型なので
 * 既存の `warningReasonText` をそのまま再利用する。
 */
export function marketDiagnosticText(diagnostic: MarketDataDiagnostic): string {
  return `⚠ ${diagnostic.block}（${diagnostic.fiscalYearKey}・${diagnostic.column}）: ${warningReasonText(diagnostic.reason)}（元の値: ${diagnostic.raw}）`;
}

/**
 * 取り込んだ株価を株価欄へ反映するかどうかの判定。**空欄のときだけ埋める。手入力は
 * 破壊しない**（`docs/02_design/ui/pages/market-data-import.md` §5.1）。
 *
 * 呼び出し側（`handleMarketDataImport`）は `await` 完了後に `priceYenRef.current`
 * （state の最新値。同期的に読めることが保証される ref）を `currentPriceYen` として渡す
 * （fe-review-round2.md 指摘#1: 関数型 `setState` のコールバック内代入を直後に読む
 * パターンは信頼できないため、ref 経由の読み出しに変更した）。
 * React の state を知らない純粋関数にしてある（`fillBlankMultiples` と同じ方針）。
 */
export function resolveImportedPriceYen(
  currentPriceYen: string,
  importedPriceSen: number | null,
): string {
  if (importedPriceSen === null || currentPriceYen !== '') return currentPriceYen;
  return senToEditableText(importedPriceSen);
}

/**
 * `resolveImportedAmount` の結果。**判別可能ユニオンにしてある。**
 * 「取り込めなかった（`unavailable`）＝ 値が無い」を型で保証し、
 * 注記に値や年度を出す経路へ `null` が漏れないようにする（`.claude/CLAUDE.md`）。
 */
export type ResolveImportedAmountResult =
  | {
      /** 入力欄に入れる値。**取り込めなくても現在値は消さない** */
      readonly yen: string;
      readonly noteKind: 'unavailable';
      readonly imported: null;
    }
  | {
      readonly yen: string;
      readonly noteKind: 'filled' | 'kept-existing';
      /** 注記に出す年度・金額の出所 */
      readonly imported: ImportedAmountView;
    };

/**
 * 取り込んだ ⑥ 用の金額を入力欄へ反映するかどうかの判定。**空欄のときだけ埋める。
 * 手入力は破壊しない**（`resolveImportedPriceYen` と同じ規則。
 * `docs/02_design/logic/balance-sheet-derivation.md` §2.3 の「確定は人が行う」）。
 *
 * `imported` が `null`（判定不能）のとき、**入力欄に `'0'` を書き込まない。**
 * 無借金・無配（`valueSen: 0`）は値なので `'0'` を入れる（同 §5.4・§5.5）。
 * 空欄の判定は `resolveImportedPriceYen` と揃えて `=== ''` のみで行う
 * （空白だけの入力は送信時の `yenToSen` が `null` として扱う）。
 * React の state を知らない純粋関数にしてある（`fillBlankMultiples` と同じ方針）。
 */
export function resolveImportedAmount(
  currentYen: string,
  imported: ImportedAmountView | null,
): ResolveImportedAmountResult {
  if (imported === null) return { yen: currentYen, noteKind: 'unavailable', imported: null };
  if (currentYen !== '') return { yen: currentYen, noteKind: 'kept-existing', imported };
  return { yen: senToEditableText(imported.valueSen), noteKind: 'filled', imported };
}

/**
 * 取り込み後にユーザーが欄を書き換えたときの注記（4状態目）。
 * **取り込み値そのものは出所として残す**（何を上書きしたのかを人が追えるようにする）。
 */
export interface EditedImportedAmountNote {
  readonly noteKind: 'edited';
  /** 上書きされた取り込み値。年度と金額を注記に出す */
  readonly imported: ImportedAmountView;
}

/** ⑥ の入力欄の直下に出す注記の全状態（取り込み直後の3状態＋編集後） */
export type ImportedAmountNote = ResolveImportedAmountResult | EditedImportedAmountNote;

/**
 * 取り込み後に欄が編集されたかを見て、実際に出す注記へ解決する
 * （fe-review CR-1。編集しても取り込み時点の注記が残り、表示中の値とは無関係な
 * 由来を主張し続けていた）。**注記は state ではなく現在値からの派生**として扱う。
 * これで値を変える経路（`onChange` 以外に将来増えても）が増えても注記が取り残されない。
 *
 * 編集の判定は `note.yen !== currentYen`。`note.yen` は取り込み直後に欄へ入った値
 * （`filled` なら取り込み値、`kept-existing`/`unavailable` なら当時の手入力値）なので、
 * **`'0'`（無借金・無配）と `''`（空欄）は別の文字列として正しく区別される。**
 *
 * 編集後の扱いは状態で分ける（ユーザー決定、2026-08-06）:
 * - `filled` … `edited` へ切り替え、取り込み値を出所として残す（何を上書きしたか分かる）
 * - `kept-existing` / `unavailable` … 注記を消す（`null`）。どちらも「取り込み値を
 *   入れなかった」という当時の事実の説明であり、値が変わった後は説明として成立しない
 *
 * React の state を知らない純粋関数にしてある（`resolveImportedAmount` と同じ方針）。
 */
export function resolveEditedAmountNote(
  note: ResolveImportedAmountResult | null,
  currentYen: string,
): ImportedAmountNote | null {
  if (note === null) return null;
  if (note.yen === currentYen) return note;
  if (note.noteKind === 'filled') return { noteKind: 'edited', imported: note.imported };
  return null;
}

/**
 * ⑥ の入力欄の直下に出す注記（同 §2.3・§10-4 への回答）。**採用した決算年度を必ず出す。**
 * 出さないと「負債総額は3年前、配当総額は今期」の取り合わせに人が気づけない。
 *
 * `result` が `null`（まだ取り込みを実行していない、または編集で注記が消えた）は
 * 何も出さない（`multipleSourceText(null)` が空文字を返すのと同じ扱い）。
 * `kept-existing` と `edited` は金額も併記する。取り込み値が入力欄に出ていないので、
 * 年度だけ出すと「入力欄の値がその年度のもの」と誤読される。
 * **`unavailable` に数値を出さない**（データが無いのに `0` を見せない。
 * `.claude/rules/frontend.md`）。
 */
export function importedAmountNoteText(
  result: ImportedAmountNote | null,
  fiscalYearEndMonth: number | null,
): string {
  if (result === null) return '';
  switch (result.noteKind) {
    case 'unavailable':
      return 'IRバンクからは取り込めませんでした。原典を見て手入力してください';
    case 'kept-existing':
      return `入力済みのため入れ替えていません（取り込み値: ${fiscalPeriodLabel(result.imported.fiscalYear, fiscalYearEndMonth)} / ${formatSen(result.imported.valueSen)}）`;
    case 'edited':
      return `手入力に変更しました（取り込み値: ${fiscalPeriodLabel(result.imported.fiscalYear, fiscalYearEndMonth)} / ${formatSen(result.imported.valueSen)}）`;
    case 'filled':
      return `IRバンク取り込み: ${fiscalPeriodLabel(result.imported.fiscalYear, fiscalYearEndMonth)}の値を入れました`;
  }
}

export interface FillBlankMultiplesResult {
  readonly per: string;
  /** `per` を新しく埋めたときだけ非 `null`。既存値を触らなかった場合は `null` */
  readonly perSource: PerSource | null;
  readonly pbr: string;
  readonly pbrSource: PbrSource | null;
}

/**
 * PER/PBR を株価と取り込み済み EPS/BPS から算出し、**空欄のときだけ**入れ替える。
 * ユーザーが既に手入力した値は上書きしない。埋めたときだけ出所を返す
 * （2026-07-29 追加。呼び出し側が「出所を上書きしてよいか」を自分で
 * 判定しなくて済むようにするため）。
 *
 * 株価が数値として読めなければ何もしない（現在の値をそのまま返す）。
 * React の state を知らない純粋関数にしてある（テストのため。同設計書 §8-7）。
 */
export function fillBlankMultiples(input: {
  readonly priceYen: string;
  readonly per: string;
  readonly pbr: string;
  readonly latestForecastEpsSen: number | null;
  readonly latestActualEpsSen: number | null;
  readonly latestActualBpsSen: number | null;
}): FillBlankMultiplesResult {
  const priceSen = yenToSen(input.priceYen);
  if (priceSen === undefined) {
    return { per: input.per, perSource: null, pbr: input.pbr, pbrSource: null };
  }
  const derived = deriveMarketMultiples({
    priceSen,
    latestForecastEpsSen: input.latestForecastEpsSen,
    latestActualEpsSen: input.latestActualEpsSen,
    latestActualBpsSen: input.latestActualBpsSen,
  });
  const fillPer = input.per === '';
  const fillPbr = input.pbr === '';
  return {
    per: fillPer ? ratioToEditableText(derived.per) : input.per,
    perSource: fillPer ? derived.perSource : null,
    pbr: fillPbr ? ratioToEditableText(derived.pbr) : input.pbr,
    pbrSource: fillPbr ? derived.pbrSource : null,
  };
}

export function CompanyForm({
  onSubmit,
  disabled,
}: {
  readonly onSubmit: (payload: AnalyzeCompanyRequest) => void;
  readonly disabled: boolean;
}) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [priceYen, setPriceYen] = useState('');
  /**
   * `priceYen` の最新値を同期的に読むための ref（`await` を挟むハンドラ用）。
   * `setState` の関数型アップデータの中で外側の変数へ副作用として代入し直後に読む
   * パターンは、React が呼び出し直後の同期読み出しを保証しないため信頼できない
   * （fe-review-round2.md 指摘#1）。commit のたびに `useEffect` で同期させ、
   * `handleImport`/`handleMarketDataImport` は `await` 完了後にこの ref を読んでから
   * 非関数型で `setPriceYen(resolvedValue)` する。
   */
  const priceYenRef = useRef(priceYen);
  useEffect(() => {
    priceYenRef.current = priceYen;
  }, [priceYen]);
  const [per, setPer] = useState('');
  const [perSource, setPerSource] = useState<PerSource | null>(null);
  const [pbr, setPbr] = useState('');
  const [pbrSource, setPbrSource] = useState<PbrSource | null>(null);
  /**
   * `per`/`pbr` の最新値を同期的に読むための ref。`priceYenRef` と同じ理由
   * （fe-review-round3.md 指摘#2）。以前は `setPer`/`setPbr` の関数型アップデータの
   * 中で `current`（最新値）を読みつつ `setPerSource`/`setPbrSource` を副作用として
   * 呼んでおり、React のアップデータ純粋性契約に反していた。ref で最新値を読めば、
   * `fillMultiplesIfEmpty` はアップデータを使わずに判定を完結できる。
   */
  const perRef = useRef(per);
  useEffect(() => {
    perRef.current = per;
  }, [per]);
  const pbrRef = useRef(pbr);
  useEffect(() => {
    pbrRef.current = pbr;
  }, [pbr]);
  const [currentAssetsYen, setCurrentAssetsYen] = useState('');
  const [investmentSecuritiesYen, setInvestmentSecuritiesYen] = useState('');
  const [totalLiabilitiesYen, setTotalLiabilitiesYen] = useState('');
  const [previousDividendTotalYen, setPreviousDividendTotalYen] = useState('');
  /**
   * ⑥ の4欄の最新値を同期的に読むための ref。`priceYenRef` と同じ理由
   * （取り込みハンドラは `await` を挟むので closure の値は古くなりうる）。
   * 流動資産・投資有価証券は EDINET取り込み（`handleEdinetImport`）が読む。
   */
  const currentAssetsYenRef = useRef(currentAssetsYen);
  useEffect(() => {
    currentAssetsYenRef.current = currentAssetsYen;
  }, [currentAssetsYen]);
  const investmentSecuritiesYenRef = useRef(investmentSecuritiesYen);
  useEffect(() => {
    investmentSecuritiesYenRef.current = investmentSecuritiesYen;
  }, [investmentSecuritiesYen]);
  const totalLiabilitiesYenRef = useRef(totalLiabilitiesYen);
  useEffect(() => {
    totalLiabilitiesYenRef.current = totalLiabilitiesYen;
  }, [totalLiabilitiesYen]);
  const previousDividendTotalYenRef = useRef(previousDividendTotalYen);
  useEffect(() => {
    previousDividendTotalYenRef.current = previousDividendTotalYen;
  }, [previousDividendTotalYen]);
  /**
   * ⑥ の2欄の取り込み結果（採用した決算年度を欄の直下に出すために持つ。
   * `docs/02_design/logic/balance-sheet-derivation.md` §2.3）。取り込み前は `null`
   */
  const [totalLiabilitiesNote, setTotalLiabilitiesNote] =
    useState<ResolveImportedAmountResult | null>(null);
  const [previousDividendTotalNote, setPreviousDividendTotalNote] =
    useState<ResolveImportedAmountResult | null>(null);
  /**
   * ⑥ の残り2欄（流動資産・投資有価証券）の EDINET取り込み結果（出所の docID を
   * 注記に出すために持つ。監査目的。Manager決定）。取り込み前は `null`
   */
  const [currentAssetsNote, setCurrentAssetsNote] = useState<ResolveEdinetAmountResult | null>(
    null,
  );
  const [investmentSecuritiesNote, setInvestmentSecuritiesNote] =
    useState<ResolveEdinetAmountResult | null>(null);
  const [rows, setRows] = useState<readonly YearRow[]>(() => [
    emptyRow(THIS_YEAR + 1, true),
    ...Array.from({ length: DEFAULT_ROWS }, (_, index) => emptyRow(THIS_YEAR - index)),
  ]);
  /** `rows` の最新値を同期的に読むための ref。`priceYenRef` と同じ理由（同上コメント参照） */
  const rowsRef = useRef(rows);
  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);
  const [error, setError] = useState<string | null>(null);
  /**
   * 確認待ちか（同設計書 §5.6）。**フラグだけを持ち、ペイロードは持たない。**
   * 確認バナー表示中もセルは編集できるので、送信内容は押された時点の state から作る。
   */
  const [awaitingConfirmation, setAwaitingConfirmation] = useState(false);

  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importNotice, setImportNotice] = useState<string | null>(null);
  /** 取り込みで怪しかったセル。人が判断する箇所を指すために持つ（同設計書 §5.2） */
  const [cellWarnings, setCellWarnings] = useState<readonly CellWarning[]>([]);
  /** ⑨ の PER/PBR を株価から算出するために保持する。取り込み前は `null` */
  const [importedForecastEpsSen, setImportedForecastEpsSen] = useState<number | null>(null);
  const [importedEpsSen, setImportedEpsSen] = useState<number | null>(null);
  const [importedBpsSen, setImportedBpsSen] = useState<number | null>(null);
  /**
   * `importedForecastEpsSen`/`importedEpsSen`/`importedBpsSen` の最新値を同期的に
   * 読むための ref。`priceYenRef`/`rowsRef` と同じ理由（fe-review-round3.md 指摘#1）。
   * `handleImport` がこの3値を更新した直後に `handleMarketDataImport` の `await` が
   * 完了すると、`handleMarketDataImport` の closure は起動時点の古い値のまま
   * `fillMultiplesIfEmpty` を呼んでしまう。commit のたびに `useEffect` で同期させ、
   * `await` 完了後はこの ref から読む。
   */
  const importedMultiplesRef = useRef({
    forecastEpsSen: importedForecastEpsSen,
    epsSen: importedEpsSen,
    bpsSen: importedBpsSen,
  });
  useEffect(() => {
    importedMultiplesRef.current = {
      forecastEpsSen: importedForecastEpsSen,
      epsSen: importedEpsSen,
      bpsSen: importedBpsSen,
    };
  }, [importedForecastEpsSen, importedEpsSen, importedBpsSen]);
  /**
   * IRバンク取り込みが返した決算月。Yahoo 取り込みへそのまま渡す
   * （`docs/02_design/ui/pages/market-data-import.md` §3）。未実施なら `null`
   * （配当の年度集計をせず株価・分割イベントだけ入る）。
   */
  const [fiscalYearEndMonth, setFiscalYearEndMonth] = useState<number | null>(null);

  /** IRバンクとは別系統の state（`.claude/rules/frontend.md`。片方の失敗が他方を巻き込まない） */
  const [marketImporting, setMarketImporting] = useState(false);
  const [marketImportError, setMarketImportError] = useState<string | null>(null);
  const [marketImportNotice, setMarketImportNotice] = useState<string | null>(null);
  const [marketSplits, setMarketSplits] = useState<readonly MarketDataSplitView[]>([]);
  const [marketDiagnostics, setMarketDiagnostics] = useState<readonly MarketDataDiagnostic[]>([]);

  /**
   * IRバンク・Yahooとは別系統の state（`.claude/rules/frontend.md`。片方の失敗が
   * 他方を巻き込まない）。EDINETは④EPS・⑦売上高の古い年度、⑤ROE、⑥流動資産・投資有価証券を
   * 取り込む（`docs/02_design/logic/edinet-history-import.md`）。
   */
  const [edinetImporting, setEdinetImporting] = useState(false);
  const [edinetImportError, setEdinetImportError] = useState<string | null>(null);
  const [edinetImportNotice, setEdinetImportNotice] = useState<string | null>(null);
  /**
   * ④⑦用。EDINET取り込みが重複4期の突き合わせで遡及修正を検出したか（設計書 §4.3）。
   * 取り込み未実施は `null`（送信時は false 扱い。`handleSubmit` 参照）。
   */
  const [edinetHistoryRestated, setEdinetHistoryRestated] = useState<EdinetDetectedRestated | null>(
    null,
  );
  /**
   * ④⑦の判定不能を人が明示的に解除したか（Manager決定 2026-08-09・案C）。
   * **検出結果（`edinetHistoryRestated`）とは別に持つ。** 検出は「EDINETの重複4期が
   * 一致しなかった」という事実、こちらは「原典を確認した」という人の判断であり、
   * 事実を上書きすると解除を戻せなくなる。判定は `resolveRestatedView`（純粋関数）に置く。
   */
  const [edinetRestatedRelease, setEdinetRestatedRelease] =
    useState<EdinetRestatedRelease>(NO_RESTATED_RELEASE);
  /** EDINET取り込みで読めなかった値の診断（設計書 §4.2）。**捨てずに画面へ出す** */
  const [edinetDiagnostics, setEdinetDiagnostics] = useState<readonly EdinetImportDiagnostic[]>([]);

  /**
   * 判定は `fillBlankMultiples`（純粋関数）に置き、ここは state への反映だけ。
   *
   * 以前は `setPer`/`setPbr` の関数型アップデータの中で `setPerSource`/`setPbrSource`
   * を副作用として呼んでいたが、React はアップデータ関数を純粋関数として扱うことを
   * 要求しており契約違反だった（fe-review-round3.md 指摘#2。StrictMode 開発ビルドでは
   * アップデータが2回呼ばれ、副作用も2回走る）。`per`/`pbr` は `perRef`/`pbrRef`
   * （`priceYenRef` と同じ理由で `await` を挟むハンドラでも最新値を読める ref）から
   * 読み、判定をアップデータの外で一度だけ完結させてから非関数型で確定する。
   */
  const fillMultiplesIfEmpty = (
    priceRaw: string,
    forecastEpsSen: number | null,
    epsSen: number | null,
    bpsSen: number | null,
  ) => {
    const result = fillBlankMultiples({
      priceYen: priceRaw,
      per: perRef.current,
      pbr: pbrRef.current,
      latestForecastEpsSen: forecastEpsSen,
      latestActualEpsSen: epsSen,
      latestActualBpsSen: bpsSen,
    });
    setPer(result.per);
    if (result.perSource !== null) setPerSource(result.perSource);
    setPbr(result.pbr);
    if (result.pbrSource !== null) setPbrSource(result.pbrSource);
  };

  const handleImport = async () => {
    setImportError(null);
    setImportNotice(null);
    // 前回の取り込みの警告を別の銘柄に付けたまま残さない
    setCellWarnings([]);
    // ⑥ の注記も同じ理由でリセットする（前の銘柄の決算年度を残さない）
    setTotalLiabilitiesNote(null);
    setPreviousDividendTotalNote(null);
    // 警告の中身が入れ替わるので、古い警告に対する確認を新しい警告へ持ち越さない
    // （code-reviewer 指摘、2026-07-30。確認バナー表示中の再取り込みが未確認のまま素通りしていた）
    setAwaitingConfirmation(false);

    const normalizedCode = toHalfWidth(code).toUpperCase();
    if (!/^\d{3}[0-9A-Z]$/.test(normalizedCode)) {
      setImportError(
        '銘柄コードは4文字（先頭3桁は数字、末尾1桁は数字か英大文字）で入力してください',
      );
      return;
    }

    setImporting(true);
    try {
      const result = await api.importFromIrBank(normalizedCode);
      setCode(normalizedCode);
      // `rows` は待機開始時点の closure 値なので、`await` 完了時点の最新値
      // （`rowsRef.current`）を基準にマージしてから非関数型で確定する
      // （fe-review-round2.md 指摘#1。取り込み待機中の手入力を破壊しない）
      const merged = mergeRowsWithImport(rowsRef.current, result.records, result.dividends);
      setRows(merged.rows);
      setImportedForecastEpsSen(result.latestForecastEpsSen);
      setImportedEpsSen(result.latestActualEpsSen);
      setImportedBpsSen(result.latestActualBpsSen);
      // Yahoo 取り込みの配当年度集計に使う（同設計書 §3）
      setFiscalYearEndMonth(result.fiscalYearEndMonth);
      // ⑥ の2欄は空欄のときだけ埋める。手入力は破壊しない
      // （`docs/02_design/logic/balance-sheet-derivation.md` §2.3）。
      // 2欄の決算年度が食い違っても取り込みは止めない（同 §2.3。実測で常態）。
      // ここでも `await` を挟んでいるので ref から最新値を読む（同指摘#1）
      const liabilities = resolveImportedAmount(
        totalLiabilitiesYenRef.current,
        result.totalLiabilities,
      );
      setTotalLiabilitiesYen(liabilities.yen);
      setTotalLiabilitiesNote(liabilities);
      const dividendTotal = resolveImportedAmount(
        previousDividendTotalYenRef.current,
        result.previousDividendTotal,
      );
      setPreviousDividendTotalYen(dividendTotal.yen);
      setPreviousDividendTotalNote(dividendTotal);
      // `priceYen` も同じ理由で ref から読む（fe-review-round2.md 指摘#2）
      fillMultiplesIfEmpty(
        priceYenRef.current,
        result.latestForecastEpsSen,
        result.latestActualEpsSen,
        result.latestActualBpsSen,
      );
      // 手入力を置き換えたことは黙って済ませない（同設計書 §5.5）
      setImportNotice(
        merged.overwrittenCount > 0
          ? `${String(merged.overwrittenCount)}件の入力値を取り込み値で置き換えました`
          : null,
      );
      // 怪しい値は件数に潰さず、該当セルと表の外に出す（同設計書 §2.1・§5.2）
      setCellWarnings(result.cellWarnings);
    } catch (cause) {
      setImportError(cause instanceof Error ? cause.message : '取り込みに失敗しました');
    } finally {
      setImporting(false);
    }
  };

  /**
   * Yahoo Finance から株価・配当・分割イベントを取り込む。**保存はしない**
   * （`docs/02_design/ui/pages/market-data-import.md`）。
   *
   * IRバンクとは独立した state を使う。片方の取り込み失敗がもう片方の表示を
   * 巻き込まない（同設計書 §2）。
   */
  const handleMarketDataImport = async () => {
    setMarketImportError(null);
    setMarketImportNotice(null);
    setMarketDiagnostics([]);
    setMarketSplits([]);

    const normalizedCode = toHalfWidth(code).toUpperCase();
    if (!/^\d{3}[0-9A-Z]$/.test(normalizedCode)) {
      setMarketImportError(
        '銘柄コードは4文字（先頭3桁は数字、末尾1桁は数字か英大文字）で入力してください',
      );
      return;
    }

    setMarketImporting(true);
    try {
      const result = await api.importMarketData(normalizedCode, fiscalYearEndMonth);
      setCode(normalizedCode);

      // 株価は空欄のときだけ埋める。手入力を破壊しない（同設計書 §5.1）。
      // `priceYen` はボタン押下時点のクロージャ値なので、`await` 完了時点の最新値
      // （`priceYenRef.current`。同期的に読めることが保証される）を基準に判定してから
      // 非関数型で確定する（fe-review-round2.md 指摘#1）
      const resolvedPriceYen = resolveImportedPriceYen(priceYenRef.current, result.priceSen);
      setPriceYen(resolvedPriceYen);
      // 予想EPS/実績EPS/実績BPS も同じ理由で ref から読む。IRバンク取り込みと
      // ほぼ同時に実行されると、この closure は起動時点の古い値のままになりうる
      // （fe-review-round3.md 指摘#1）
      fillMultiplesIfEmpty(
        resolvedPriceYen,
        importedMultiplesRef.current.forecastEpsSen,
        importedMultiplesRef.current.epsSen,
        importedMultiplesRef.current.bpsSen,
      );

      // 銘柄名は空欄のときだけ英語名で埋める（同設計書 §5.4）。ここは書き込むだけで
      // 解決後の値を後続処理が読まないため、関数型更新のままで安全
      // （fe-review-round2.md 指摘#1が問題にしたのは「読み戻し」であり、書き込み専用の
      // 関数型更新自体は問題ない）
      setName((current) => (result.name !== null && current.trim() === '' ? result.name : current));

      // `rows` も同じ理由で ref から読んでから非関数型で確定する（同指摘#1）
      const mergedDividends = mergeDividendYears(rowsRef.current, result.dividendRecords);
      setRows(mergedDividends.rows);
      setMarketSplits(result.splits);
      // 取得診断・集計診断は捨てない（`.claude/rules/backend.md`）
      setMarketDiagnostics([...result.diagnostics, ...result.dividendDiagnostics]);

      const notices: string[] = [];
      notices.push(
        result.priceSen === null
          ? '株価は取得できませんでした'
          : `株価の観測時刻: ${formatPriceAsOf(result.priceAsOf)}`,
      );
      if (!result.dividendAggregated) {
        notices.push(
          '決算月が未取得のため、配当の年度集計は行われませんでした（先にIRバンクから取り込んでください）',
        );
      } else if (mergedDividends.overwrittenCount > 0) {
        notices.push(
          `${String(mergedDividends.overwrittenCount)}件の入力値を取り込み値で置き換えました`,
        );
      }
      setMarketImportNotice(notices.join(' / '));
    } catch (cause) {
      setMarketImportError(cause instanceof Error ? cause.message : '取り込みに失敗しました');
    } finally {
      setMarketImporting(false);
    }
  };

  /**
   * EDINET（金融庁の有価証券報告書）から④EPS・⑦売上高の古い年度、⑤ROE、⑥流動資産・
   * 投資有価証券を取り込む。**保存はしない**
   * （`docs/02_design/logic/edinet-history-import.md`）。
   *
   * IRバンク・Yahooとは独立した state を使う。片方の取り込み失敗がもう片方の表示を
   * 巻き込まない（同設計書と同じ方針）。
   */
  const handleEdinetImport = async () => {
    setEdinetImportError(null);
    setEdinetImportNotice(null);
    setEdinetHistoryRestated(null);
    // 前の銘柄・前回の取り込みに対する解除の判断を、新しい検出結果へ持ち越さない
    setEdinetRestatedRelease(NO_RESTATED_RELEASE);
    setEdinetDiagnostics([]);
    setCurrentAssetsNote(null);
    setInvestmentSecuritiesNote(null);

    const normalizedCode = toHalfWidth(code).toUpperCase();
    if (!/^\d{3}[0-9A-Z]$/.test(normalizedCode)) {
      setEdinetImportError(
        '銘柄コードは4文字（先頭3桁は数字、末尾1桁は数字か英大文字）で入力してください',
      );
      return;
    }

    setEdinetImporting(true);
    try {
      const result = await api.importFromEdinet(normalizedCode);
      setCode(normalizedCode);
      // `rows` は待機開始時点の closure 値なので、`await` 完了時点の最新値
      // （`rowsRef.current`）を基準にマージしてから非関数型で確定する
      // （`handleImport` と同じ理由。fe-review-round2.md 指摘#1）
      const merged = mergeRowsWithEdinetImport(rowsRef.current, result.years);
      setRows(merged.rows);
      setEdinetHistoryRestated(
        createDetectedRestated(result.epsHistoryRestated, result.revenueHistoryRestated),
      );
      // 読めなかった値は件数に潰さず1件ずつ出す（同設計書 §4.2・`import-review.md` §5.3）
      setEdinetDiagnostics(result.diagnostics);

      // ⑥の残り2欄は空欄のときだけ埋める。手入力は破壊しない（同設計書 §4.6）。
      // 貸借対照表そのものが取れない銘柄（IFRS採用企業等）は `balanceSheet` が
      // `null` になる。項目単位でも `null` になりうる（§2.7）ので、それぞれ独立に判定する
      const currentAssets = resolveImportedEdinetAmount(
        currentAssetsYenRef.current,
        result.balanceSheet?.currentAssetsSen ?? null,
        result.balanceSheet?.sourceDocId ?? '',
      );
      setCurrentAssetsYen(currentAssets.yen);
      setCurrentAssetsNote(currentAssets);
      const investmentSecurities = resolveImportedEdinetAmount(
        investmentSecuritiesYenRef.current,
        result.balanceSheet?.investmentSecuritiesSen ?? null,
        result.balanceSheet?.sourceDocId ?? '',
      );
      setInvestmentSecuritiesYen(investmentSecurities.yen);
      setInvestmentSecuritiesNote(investmentSecurities);

      // 手入力を置き換えていない（空欄だけを埋めた）ことが分かるよう、件数を伝える
      // （`mergeRowsWithImport` 系の通知と同じ体裁。文言だけ「置き換え」ではなく「埋めた」）
      setEdinetImportNotice(
        merged.filledCount > 0
          ? `${String(merged.filledCount)}件の空欄をEDINET取り込み値で埋めました`
          : null,
      );
    } catch (cause) {
      setEdinetImportError(cause instanceof Error ? cause.message : '取り込みに失敗しました');
    } finally {
      setEdinetImporting(false);
    }
  };

  const updateRow = (index: number, patch: Partial<YearRow>) => {
    const edited = rows[index];
    setRows((previous) =>
      previous.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)),
    );
    // 直したセルの警告は用済みになる（同設計書 §5.6）
    if (edited !== undefined) {
      setCellWarnings((previous) => dropEditedWarnings(previous, edited.fiscalYear, patch));
    }
  };

  /** 判定は純粋関数側に置き、ここは state を渡すだけ */
  const cellWarningsOf = (row: YearRow, field: YearRowField) =>
    warningsForCell(cellWarnings, row.fiscalYear, field);

  const invalidIfWarned = (row: YearRow, field: YearRowField) =>
    cellWarningsOf(row, field).length > 0 ? 'true' : undefined;

  const cellWarningNotes = (row: YearRow, field: YearRowField) =>
    cellWarningsOf(row, field).map((warning, order) => (
      <p className="warning" key={`${field}-${warning.reason}-${String(order)}`}>
        {cellWarningText(warning)}
        {/* 元の値は等幅でそのまま出す。金額として整形しない（同設計書 §5.2） */}
        （元の値: <code>{warning.raw}</code>）
      </p>
    ));

  const warningsOutsideTable = rowlessWarnings(cellWarnings);

  /**
   * 検出結果と解除操作をまとめた表示・送信用の状態。判定は純粋関数側に置き、
   * ここは state を渡すだけ（`cellWarningsOf` と同じ方針）。
   */
  const restatedView = resolveRestatedView(edinetHistoryRestated, edinetRestatedRelease);
  const restatedPendingText = edinetRestatedNoticeText(
    restatedView.pending.eps,
    restatedView.pending.revenue,
  );
  const restatedReleasedText = edinetRestatedReleasedText(
    restatedView.released.eps,
    restatedView.released.revenue,
  );
  const restatedTargets: readonly EdinetRestatedTarget[] = ['eps', 'revenue'];

  /**
   * 入力を受け付けられないときの共通処理。**確認待ちを必ず解除する。**
   * バリデーションが通らない状態で確認バナーを出したままにしない（同設計書 §5.6）。
   */
  const failValidation = (message: string) => {
    setError(message);
    setAwaitingConfirmation(false);
  };

  /**
   * 送信する内容は**呼ばれるたびに毎回ゼロから組み立てる**。確認バナー表示中も表は
   * 編集できるので、スナップショットを保持すると直した値が捨てられる（同設計書 §5.6）。
   */
  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    const normalizedCode = toHalfWidth(code).toUpperCase();
    if (!/^\d{3}[0-9A-Z]$/.test(normalizedCode)) {
      failValidation(
        '銘柄コードは4文字（先頭3桁は数字、末尾1桁は数字か英大文字）で入力してください',
      );
      return;
    }
    if (name.trim() === '') {
      failValidation('銘柄名を入力してください');
      return;
    }

    const priceSen = yenToSen(priceYen);
    if (priceSen === undefined) {
      failValidation('株価は数値で入力してください（小数第2位まで）');
      return;
    }
    if (priceSen !== null && (priceSen < 0 || priceSen > 100_000_000)) {
      failValidation('株価は 0 円以上 1,000,000 円以下で入力してください');
      return;
    }

    const records: AnalyzeCompanyRequest['records'] = [];
    const dividends: AnalyzeCompanyRequest['dividends'] = [];

    for (const row of rows) {
      const fiscalYear = Number(toHalfWidth(row.fiscalYear));
      if (!Number.isInteger(fiscalYear) || fiscalYear < 1900 || fiscalYear > 2200) {
        failValidation(`決算年度が不正です: ${row.fiscalYear}`);
        return;
      }

      const epsSen = yenToSen(row.epsYen);
      const revenueSen = yenToSen(row.revenueYen);
      const dividendPerShareSen = yenToSen(row.dividendYen);
      const roePercent = toRatio(row.roePercent);
      const operatingMarginPercent = toRatio(row.operatingMarginPercent);

      if (
        epsSen === undefined ||
        revenueSen === undefined ||
        dividendPerShareSen === undefined ||
        roePercent === undefined ||
        operatingMarginPercent === undefined
      ) {
        failValidation(`${String(fiscalYear)} 年度の入力に数値として読めない項目があります`);
        return;
      }

      records.push({
        fiscalYear,
        isForecast: row.isForecast,
        epsSen,
        roePercent,
        revenueSen,
        operatingMarginPercent,
      });
      dividends.push({
        fiscalYear,
        kind: row.isForecast ? 'forecast' : 'actual',
        annualAmountSen: dividendPerShareSen,
      });
    }

    const balance = {
      currentAssetsSen: yenToSen(currentAssetsYen),
      investmentSecuritiesSen: yenToSen(investmentSecuritiesYen),
      totalLiabilitiesSen: yenToSen(totalLiabilitiesYen),
      previousDividendTotalSen: yenToSen(previousDividendTotalYen),
    };
    if (Object.values(balance).some((value) => value === undefined)) {
      failValidation('貸借対照表の項目は数値で入力してください');
      return;
    }

    const perValue = toRatio(per);
    const pbrValue = toRatio(pbr);
    if (perValue === undefined || pbrValue === undefined) {
      failValidation('PER / PBR は数値で入力してください');
      return;
    }
    // 出所は空欄なら null（データなし）。値があるのに出所が無い＝ユーザーが直接編集した
    const multiples = {
      per: perValue,
      perSource: perValue === null ? null : (perSource ?? 'manual'),
      pbr: pbrValue,
      pbrSource: pbrValue === null ? null : (pbrSource ?? 'manual'),
    };

    const payload: AnalyzeCompanyRequest = {
      code: normalizedCode,
      name: name.trim(),
      records,
      dividends,
      balanceSheet: balance as AnalyzeCompanyRequest['balanceSheet'],
      multiples,
      priceSen,
      // ④⑦用。EDINET取り込みで遡及修正を検出していて、かつ人が解除していなければ true
      // （設計書 §4.3・§5）。取り込みを実行していなければ `pending` は両方 false になる。
      // 判定は `resolveRestatedView`（純粋関数）に閉じている
      epsHistoryRestated: restatedView.pending.eps,
      revenueHistoryRestated: restatedView.pending.revenue,
    };

    // 確認バナーの「確認した」は type="submit" なので、ここへ戻ってくる（同設計書 §5.6）
    if (shouldShowConfirmation(cellWarnings, awaitingConfirmation)) {
      setAwaitingConfirmation(true);
      return;
    }
    setAwaitingConfirmation(false);
    onSubmit(payload);
  };

  return (
    <form onSubmit={handleSubmit} className="company-form">
      <fieldset>
        <legend>銘柄</legend>
        <label>
          銘柄コード
          <input value={code} onChange={(event) => setCode(event.target.value)} required />
        </label>
        <button type="button" onClick={() => void handleImport()} disabled={importing}>
          {importing ? '取り込み中…' : 'IRバンクから取り込む'}
        </button>
        <button
          type="button"
          onClick={() => void handleMarketDataImport()}
          disabled={marketImporting}
        >
          {marketImporting ? '取り込み中…' : 'Yahoo Financeから株価・配当を取り込む'}
        </button>
        <button type="button" onClick={() => void handleEdinetImport()} disabled={edinetImporting}>
          {edinetImporting ? '取り込み中…' : 'EDINET（有価証券報告書）から取り込む'}
        </button>
        <p className="meta">
          銘柄コードから業績・配当を取り込み、年度別データへ反映します（取り込みに値が無い
          欄の手入力は残ります。株価・PER・PBR は対象外。株価を先に入力しておくと PER/PBR
          も算出します）。貸借対照表は負債総額・前期末の配当総額をIRバンクから取り込みます。
          流動資産・投資有価証券はEDINET（有価証券報告書）から取り込めます（下のボタン。
          日本基準の事業会社のみ対象。IFRS採用企業は投資有価証券が取得できません）。
        </p>
        {importError !== null && (
          <p className="error" role="alert">
            {importError}
          </p>
        )}
        {importNotice !== null && <p className="meta">{importNotice}</p>}
        <p className="meta">
          Yahoo Financeから株価・配当履歴（21〜28年ぶん）・株式分割イベントを取り込みます
          （EPS・売上高等は取れません。銘柄名は英語表記です）。配当の年度集計には決算月が
          必要なため、先にIRバンクから取り込んでおくことを推奨します。
        </p>
        {marketImportError !== null && (
          <p className="error" role="alert">
            {marketImportError}
          </p>
        )}
        {marketImportNotice !== null && <p className="meta">{marketImportNotice}</p>}
        {marketSplits.length > 0 && (
          <div className="meta">
            <p>
              株式分割・併合イベント（参考情報です。配当・株価は取り込み時点で分割調整済みです。
              表の既存の入力値だけは自動更新されません）:
            </p>
            <ul>
              {marketSplits.map((split, order) => (
                <li key={`${split.date}-${String(order)}`}>{splitEventText(split)}</li>
              ))}
            </ul>
          </div>
        )}
        {marketDiagnostics.length > 0 && (
          <ul className="warning">
            {marketDiagnostics.map((diagnostic, order) => (
              <li key={`${diagnostic.fiscalYearKey}-${diagnostic.column}-${String(order)}`}>
                {marketDiagnosticText(diagnostic)}
              </li>
            ))}
          </ul>
        )}
        <p className="meta">
          金融庁EDINETの有価証券報告書から、④EPS・⑦売上高の6期以上前の年度、⑤ROE、
          ⑥流動資産・投資有価証券を取り込みます（予想値は取れません。空欄のセルだけを
          埋め、手入力・IRバンク取り込み済みの値は上書きしません）。
        </p>
        {edinetImportError !== null && (
          <p className="error" role="alert">
            {edinetImportError}
          </p>
        )}
        {edinetImportNotice !== null && <p className="meta">{edinetImportNotice}</p>}
        {/* 読めなかった値の診断。0件なら枠ごと出さない（`marketDiagnostics` と同じ体裁） */}
        {shouldShowEdinetDiagnostics(edinetDiagnostics) && (
          <ul className="warning">
            {edinetDiagnostics.map((diagnostic, order) => (
              <li key={`${diagnostic.field}-${diagnostic.elementId}-${String(order)}`}>
                {edinetDiagnosticText(diagnostic)}
              </li>
            ))}
          </ul>
        )}
        {/* 遡及修正の警告と、人が明示的に解除する導線（設計書 §4.3・案C）。
            自動解除にしない。「嘘の連続性を持つ系列でCAGRを計算するより判定不能が安全側」
            という原則を、人の判断を1回記録することでだけ超えられるようにする。
            ④⑦は別々に解除する（同 §4.3「EPS・売上高は独立に判定する」） */}
        {restatedPendingText !== null && (
          <div className="warning" role="alert">
            <p>{restatedPendingText}</p>
            <p>
              原典（有価証券報告書）を確認して系列が正しいと判断できる場合は、指標ごとに
              判定不能を解除できます。解除すると保存時にその指標の判定を有効にします。
            </p>
            {restatedTargets
              .filter((target) => restatedView.pending[target])
              .map((target) => (
                <button
                  type="button"
                  key={target}
                  onClick={() =>
                    setEdinetRestatedRelease((previous) =>
                      toggleRestatedRelease(previous, target, true),
                    )
                  }
                >
                  {restatedReleaseButtonText(target)}
                </button>
              ))}
          </div>
        )}
        {restatedReleasedText !== null && (
          <div className="meta">
            <p>{restatedReleasedText}</p>
            {restatedTargets
              .filter((target) => restatedView.released[target])
              .map((target) => (
                <button
                  type="button"
                  key={target}
                  onClick={() =>
                    setEdinetRestatedRelease((previous) =>
                      toggleRestatedRelease(previous, target, false),
                    )
                  }
                >
                  {restatedRestoreButtonText(target)}
                </button>
              ))}
          </div>
        )}
        <label>
          銘柄名
          <input value={name} onChange={(event) => setName(event.target.value)} required />
        </label>
        <label>
          現在株価（円）
          <input
            value={priceYen}
            onChange={(event) => {
              const value = event.target.value;
              setPriceYen(value);
              fillMultiplesIfEmpty(value, importedForecastEpsSen, importedEpsSen, importedBpsSen);
            }}
            inputMode="decimal"
            placeholder="例: 1234.50"
          />
        </label>
      </fieldset>

      <fieldset>
        <legend>市場指標・貸借対照表（⑥⑨ で使用）</legend>
        <label>
          PER（倍）
          <input
            value={per}
            onChange={(event) => {
              setPer(event.target.value);
              setPerSource('manual');
            }}
            inputMode="decimal"
          />
        </label>
        <p className="meta">{multipleSourceText(perSource)}</p>
        <label>
          PBR（倍）
          <input
            value={pbr}
            onChange={(event) => {
              setPbr(event.target.value);
              setPbrSource('manual');
            }}
            inputMode="decimal"
          />
        </label>
        <p className="meta">{multipleSourceText(pbrSource)}</p>
        {/* IRバンクからは取り込めない（4欄のうち2欄。同 §1・§7.3）が、EDINETからは
            取り込める（`docs/02_design/logic/edinet-history-import.md` §2.7）。
            `sourceDocId` を監査目的で小さく併記する（Manager決定）。
            採用した決算年度を欄の直下に出す。2欄の年度ずれは人が見比べて判断する（同 §2.3）。
            注記は現在値からの派生（`resolveEditedAmountNote`）。手で書き換えられた欄に
            取り込み時点の由来を出したままにしない（fe-review CR-1）。
            注記の文言計算はここ（呼び出し元）で行い、`BalanceSheetFields` へは
            完成済みの文字列だけを渡す（fe-fix-plan.md §4。データ取得・計算をしない
            表示専用コンポーネントに保つため） */}
        <BalanceSheetFields
          currentAssets={{
            yen: currentAssetsYen,
            onChange: setCurrentAssetsYen,
            notes: [
              'IRバンクからは取り込めません（EDINETから取り込み可。上のボタン。手入力も可）',
              edinetAmountNoteText(currentAssetsNote, 'currentAssets'),
            ],
          }}
          investmentSecurities={{
            yen: investmentSecuritiesYen,
            onChange: setInvestmentSecuritiesYen,
            notes: [
              'IRバンクからは取り込めません（EDINETから取り込み可。上のボタン。手入力も可）',
              edinetAmountNoteText(investmentSecuritiesNote, 'investmentSecurities'),
            ],
          }}
          totalLiabilities={{
            yen: totalLiabilitiesYen,
            onChange: setTotalLiabilitiesYen,
            notes: [
              importedAmountNoteText(
                resolveEditedAmountNote(totalLiabilitiesNote, totalLiabilitiesYen),
                fiscalYearEndMonth,
              ),
            ],
          }}
          previousDividendTotal={{
            yen: previousDividendTotalYen,
            onChange: setPreviousDividendTotalYen,
            notes: [
              importedAmountNoteText(
                resolveEditedAmountNote(previousDividendTotalNote, previousDividendTotalYen),
                fiscalYearEndMonth,
              ),
            ],
          }}
        />
      </fieldset>

      <fieldset>
        <legend>年度別データ（空欄は「データなし」として扱います。0 とは区別されます）</legend>
        {warningsOutsideTable.length > 0 && (
          <ul className="warning">
            {warningsOutsideTable.map((warning, order) => (
              <li key={`${warning.fiscalYearKey}-${warning.column}-${String(order)}`}>
                {rowlessWarningText(warning)}
              </li>
            ))}
          </ul>
        )}
        <table className="input-table">
          <thead>
            <tr>
              <th scope="col">年度</th>
              <th scope="col">区分</th>
              <th scope="col">EPS（円）</th>
              <th scope="col">ROE（%）</th>
              <th scope="col">売上高（円）</th>
              <th scope="col">営業利益率（%）</th>
              <th scope="col">1株配当（円）</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={`${row.fiscalYear}-${String(row.isForecast)}-${String(index)}`}>
                <td>
                  <input
                    value={row.fiscalYear}
                    onChange={(event) => updateRow(index, { fiscalYear: event.target.value })}
                    inputMode="numeric"
                    aria-label="決算年度"
                  />
                </td>
                <td>
                  <label className="inline">
                    <input
                      type="checkbox"
                      checked={row.isForecast}
                      onChange={(event) => updateRow(index, { isForecast: event.target.checked })}
                    />
                    予想
                  </label>
                </td>
                <td>
                  <input
                    value={row.epsYen}
                    onChange={(event) => updateRow(index, { epsYen: event.target.value })}
                    inputMode="decimal"
                    aria-label="EPS"
                    aria-invalid={invalidIfWarned(row, 'epsYen')}
                  />
                  {cellWarningNotes(row, 'epsYen')}
                </td>
                <td>
                  <input
                    value={row.roePercent}
                    onChange={(event) => updateRow(index, { roePercent: event.target.value })}
                    inputMode="decimal"
                    aria-label="ROE"
                    aria-invalid={invalidIfWarned(row, 'roePercent')}
                  />
                  {cellWarningNotes(row, 'roePercent')}
                </td>
                <td>
                  <input
                    value={row.revenueYen}
                    onChange={(event) => updateRow(index, { revenueYen: event.target.value })}
                    inputMode="decimal"
                    aria-label="売上高"
                    aria-invalid={invalidIfWarned(row, 'revenueYen')}
                  />
                  {cellWarningNotes(row, 'revenueYen')}
                </td>
                <td>
                  <input
                    value={row.operatingMarginPercent}
                    onChange={(event) =>
                      updateRow(index, { operatingMarginPercent: event.target.value })
                    }
                    inputMode="decimal"
                    aria-label="営業利益率"
                    aria-invalid={invalidIfWarned(row, 'operatingMarginPercent')}
                  />
                  {cellWarningNotes(row, 'operatingMarginPercent')}
                </td>
                <td>
                  <input
                    value={row.dividendYen}
                    onChange={(event) => updateRow(index, { dividendYen: event.target.value })}
                    inputMode="decimal"
                    aria-label="1株配当"
                    aria-invalid={invalidIfWarned(row, 'dividendYen')}
                  />
                  {cellWarningNotes(row, 'dividendYen')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <button
          type="button"
          onClick={() =>
            setRows((previous) => [...previous, emptyRow(THIS_YEAR - previous.length)])
          }
        >
          年度を追加
        </button>
      </fieldset>

      {error !== null && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {awaitingConfirmation && (
        <div className="warning" role="alert">
          <p>{confirmWarningsText(cellWarnings)}</p>
          {/* type="submit" にして handleSubmit を通す。確認中に直した値をそのまま送るため */}
          <button type="submit" disabled={disabled}>
            確認した
          </button>
          <button type="button" onClick={() => setAwaitingConfirmation(false)}>
            戻る
          </button>
        </div>
      )}

      <button type="submit" disabled={disabled}>
        {disabled ? '解析中…' : '解析して保存'}
      </button>
    </form>
  );
}
