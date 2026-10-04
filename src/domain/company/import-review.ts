/**
 * 取り込み診断（`ImportDiagnostic`）を「画面のどのセルの話か」に解決する。
 *
 * 仕様: `docs/02_design/logic/import-review.md` §3.2
 *
 * 件数に潰すと、どの年度のどの値を見ればよいのか分からず人は判断できない（同 §2.1）。
 * 判定はここ（素TS の純粋関数）に置き、画面には条件分岐を書かない（`.claude/CLAUDE.md`）。
 */

import { type ImportDiagnostic } from './financial-source';

/** 年度別データの入力欄。行内のどの `<input>` かを一意に決める（同 §3.2） */
export type YearRowField =
  'epsYen' | 'roePercent' | 'revenueYen' | 'operatingMarginPercent' | 'dividendYen';

/** 診断1件を、画面のどのセルの話かに解決したもの */
export interface CellWarning {
  /** 決算年度。`fiscalYearKey`（`2026/03`）の先頭4桁。解決できなければ `null`（同 §6） */
  readonly fiscalYear: number | null;
  /** 元のキー。3月期以外の銘柄は年度だけでは原典と突き合わせられない（同 §3.4） */
  readonly fiscalYearKey: string;
  /** 画面の入力欄。画面に列が無い項目・行ごと落ちた診断は `null`（同 §3.2） */
  readonly field: YearRowField | null;
  /** 元の列名。`field` が `null` のとき「何が読めなかったか」を伝えるのに要る（同 §5.3） */
  readonly column: string;
  readonly reason: ImportDiagnostic['reason'];
  /** 値が使われたか。表示文言を変える唯一の分岐（同 §3.2） */
  readonly valueKept: boolean;
  /** 元の値。**整形しない**（同 §5.2） */
  readonly raw: string;
}

/**
 * 取り込み元の区画名・列名。**`src/infra/irbank/parse-fy-data.ts` の同名の定数と
 * 同じ値を持たせている。** domain は infra を import できないため
 * （`.claude/CLAUDE.md` 依存ルール）、片方を変えたら両方を合わせること。
 *
 * `export` しているのは、両者が食い違っていないことを
 * `tests/domain/company/import-review-constants.test.ts` で機械的に検査するため
 * （変更検知をコメントだけに頼らない）。
 */
export const BLOCK_PERFORMANCE = '業績';
export const BLOCK_DIVIDEND = '配当';
export const COLUMN_EPS = 'EPS';
export const COLUMN_ROE = 'ROE';
export const COLUMN_REVENUE = '売上高';
export const COLUMN_DIVIDEND_PER_SHARE = '一株配当';

/** 決算期のキー。`2026/03` の先頭4桁を決算年度にする（同 §3.4） */
const FISCAL_YEAR_KEY = /^(\d{4})\/(\d{2})$/;

/**
 * 列名を画面の入力欄に対応させる（同 §3.2 の表）。
 *
 * 業績の `営業利益` と財務の `BPS`、行が落ちた `年度` / `備考` は画面に対応する
 * 欄が無いので `null`。**紐づかないものを黙って捨てない。** 行外の警告として出す（同 §5.3）。
 */
function resolveField(block: string, column: string): YearRowField | null {
  if (block === BLOCK_PERFORMANCE) {
    if (column === COLUMN_EPS) return 'epsYen';
    if (column === COLUMN_ROE) return 'roePercent';
    if (column === COLUMN_REVENUE) return 'revenueYen';
    return null;
  }
  if (block === BLOCK_DIVIDEND && column === COLUMN_DIVIDEND_PER_SHARE) return 'dividendYen';
  return null;
}

function resolveFiscalYear(fiscalYearKey: string): number | null {
  const digits = FISCAL_YEAR_KEY.exec(fiscalYearKey)?.[1];
  if (digits === undefined) return null;
  return Number(digits);
}

/**
 * 値が採用されたままか。
 *
 * **`switch` で書き `default` を置かないのは、網羅を型で守るため**（同 §3.2）。
 * `ImportDiagnostic['reason']` に種別が増えると、戻り値に `undefined` が混ざって
 * コンパイルが落ちる（TS2366）。新しい種別を「値が落ちた」側へ黙って倒さない。
 */
function keepsValue(reason: ImportDiagnostic['reason']): boolean {
  switch (reason) {
    // 値は採用したまま記録だけ残している。「データなし扱い」と言うと誤りになる
    case 'suspicious-jump':
    case 'rounded':
      return true;
    // `inconsistent-value`（数値としては読めたが他の値と突き合わせると成立しない）も
    // 値は採用せず空欄にする（`docs/02_design/logic/balance-sheet-derivation.md` §5.1 / §5.5）
    case 'unparsable-value':
    case 'unsafe-integer':
    case 'year-out-of-range':
    case 'duplicate-year':
    case 'unknown-note':
    case 'inconsistent-value':
      return false;
  }
}

/** 診断を1件ずつ警告に解決する。**件数に潰さない**（同 §6「1件に潰さない」） */
export function resolveCellWarnings(
  diagnostics: readonly ImportDiagnostic[],
): readonly CellWarning[] {
  return diagnostics.map((diagnostic) => ({
    fiscalYear: resolveFiscalYear(diagnostic.fiscalYearKey),
    fiscalYearKey: diagnostic.fiscalYearKey,
    field: resolveField(diagnostic.block, diagnostic.column),
    column: diagnostic.column,
    reason: diagnostic.reason,
    valueKept: keepsValue(diagnostic.reason),
    raw: diagnostic.raw,
  }));
}
