/**
 * ポートフォリオ画面（`/portfolio`、T-103）の純関数群。**JSX を持たない。**
 *
 * `@testing-library/react` 未導入のため、`indicator-custom-logic.ts` と同じ方針で
 * バリデーション・disabled 判定・空状態文言を切り出し、`tests/frontend/*.test.ts`
 * （`.tsx` ではない）で直接呼び出してテストする。
 */

import type { AddHoldingRequest, PortfolioSummary, UpdateHoldingRequest } from '../api';
import { COMPANY_CODE } from '../routes';
import { toHalfWidthNumber } from './indicator-custom-logic';

/**
 * 保有銘柄数の上限（`docs/02_design/ui/pages/portfolio-page.md` §1「1ポートフォリオに
 * 最大100銘柄」）。`GET /api/portfolios/:id` のレスポンスに上限値のフィールドが無いため
 * （`docs/02_design/api/portfolio-api.md` 参照）、FE 側でこの値をハードコードする
 * （`indicator-custom-logic.ts` の `MIN_SELECTED_COUNT`/`MAX_SELECTED_COUNT` と同じ
 * 「意図的なFEローカル定数」パターン。BE側の上限が変わったら手動で追従させること）。
 */
export const MAX_HOLDINGS_PER_PORTFOLIO = 100;

/** ポートフォリオ名の上限文字数（`portfolio-api.md` §POST /api/portfolios「1〜50文字」） */
const PORTFOLIO_NAME_MAX_LENGTH = 50;

/** ポートフォリオ追加の可否（§3「10個未満のときだけ活性」。境界値: count===max で不可） */
export function canAddPortfolio(count: number, max: number): boolean {
  return count < max;
}

/** 保有銘柄追加の可否（§5「100銘柄到達時は追加ボタンをdisabled」。境界値は同上） */
export function canAddHolding(count: number, max: number): boolean {
  return count < max;
}

export interface EmptyStateContent {
  readonly heading: string;
  readonly description: string | null;
}

/** ポートフォリオを1つも持たない場合の空状態（§6） */
export function portfolioEmptyStateContent(): EmptyStateContent {
  return { heading: 'ポートフォリオがありません', description: null };
}

/** ポートフォリオはあるが保有銘柄0件の場合の空状態（§6） */
export function holdingsEmptyStateContent(): EmptyStateContent {
  return { heading: '銘柄を追加してください', description: null };
}

/**
 * 先頭ポートフォリオへのフォールバック解決（`portfolio-page.md` §2「既定: ユーザーの
 * 先頭ポートフォリオ」）。`routes.ts` は一覧を知らない（DOM非依存の純粋なURL解釈）ため、
 * この解決は `App.tsx` 側の責務としてここに置く。
 */
export function resolveActivePortfolioId(
  portfolioIdParam: string | null,
  portfolios: readonly PortfolioSummary[],
): string | null {
  if (portfolioIdParam !== null) return portfolioIdParam;
  return portfolios[0]?.id ?? null;
}

/** ポートフォリオ名のエラー文言（`portfolio-api.md` §POST /api/portfolios「1〜50文字。空文字は400」） */
export function portfolioNameErrorText(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed === '') return 'ポートフォリオ名を入力してください';
  if (trimmed.length > PORTFOLIO_NAME_MAX_LENGTH) {
    return `ポートフォリオ名は${String(PORTFOLIO_NAME_MAX_LENGTH)}文字以内で入力してください`;
  }
  return null;
}

/** 保有数量の解析。空文字は `null`（未入力）、不正値（非整数・非数値）は `undefined` */
export function parseQuantityInput(raw: string): number | null | undefined {
  const normalized = toHalfWidthNumber(raw);
  if (normalized === '') return null;
  if (!/^\d+$/.test(normalized)) return undefined;
  const value = Number(normalized);
  return Number.isSafeInteger(value) ? value : undefined;
}

/** 保有数量のエラー文言（`portfolio-page.md` §5「0以下は拒否」。保有数量は株数=正の整数） */
export function quantityErrorText(parsed: number | null | undefined): string | null {
  if (parsed === undefined) return '整数で入力してください';
  if (parsed === null) return '保有数量を入力してください';
  if (parsed <= 0) return '保有数量は1以上の整数で入力してください';
  return null;
}

/**
 * 取得単価（円）の入力を銭へ変換する。空欄は `null`（未入力）。読めなければ `undefined`
 * （`CompanyForm.tsx` の非export `yenToSen` と同じ3値設計。意図的な重複定義。
 * `indicator-custom-logic.ts` の `toHalfWidthNumber` を正規化に再利用する）。
 */
export function parseAcquisitionPriceInput(raw: string): number | null | undefined {
  const normalized = toHalfWidthNumber(raw).replace(/,/g, '');
  if (normalized === '') return null;
  if (!/^-?\d+(\.\d{1,2})?$/.test(normalized)) return undefined;
  const sen = Math.round(Number(normalized) * 100);
  return Number.isSafeInteger(sen) ? sen : undefined;
}

/** 取得単価のエラー文言（`portfolio-page.md` §5「0以下は拒否」） */
export function acquisitionPriceErrorText(parsedSen: number | null | undefined): string | null {
  if (parsedSen === undefined) return '数値で入力してください';
  if (parsedSen === null) return '取得単価を入力してください';
  if (parsedSen <= 0) return '取得単価は0より大きい値で入力してください';
  return null;
}

/**
 * 銘柄コード入力の全角→半角正規化（CR-1・T-103 FEレビュー対応）。
 *
 * `toHalfWidthNumber`（`！-～` の Unicode 全角英数記号ブロックをまとめて半角化する）を
 * 再利用する。名前に反して数字専用ではなく、全角英字（末尾1桁が英大文字の銘柄コード、
 * 例: `１３０Ａ`）も含めて半角化できる（`CompanyForm.tsx` の `toHalfWidth` と同等の変換範囲）。
 * 新しい変換関数は追加しない。
 */
export function normalizeHoldingCodeInput(raw: string): string {
  return toHalfWidthNumber(raw).toUpperCase();
}

/**
 * 銘柄コードのエラー文言（`routes.ts` の `COMPANY_CODE` と同一形式。
 * `portfolio-page.md` §5「銘柄コードは screen-list.md の COMPANY_CODE 形式検証後に確定」）。
 */
export function codeErrorText(code: string): string | null {
  if (code.trim() === '') return '銘柄コードを入力してください';
  return COMPANY_CODE.test(code) ? null : '銘柄コードの形式が不正です（例: 7203）';
}

export interface HoldingFormValues {
  readonly code: string;
  readonly quantityText: string;
  readonly acquisitionPriceText: string;
}

/** フォーム全体の送信可否（すべてのフィールドがエラー無し） */
export function canSubmitHoldingForm(values: HoldingFormValues): boolean {
  if (codeErrorText(values.code) !== null) return false;
  if (quantityErrorText(parseQuantityInput(values.quantityText)) !== null) return false;
  if (acquisitionPriceErrorText(parseAcquisitionPriceInput(values.acquisitionPriceText)) !== null) {
    return false;
  }
  return true;
}

/** 送信payload組み立て。`canSubmitHoldingForm` が false のときは `null` */
export function buildAddHoldingPayload(values: HoldingFormValues): AddHoldingRequest | null {
  if (!canSubmitHoldingForm(values)) return null;
  const quantity = parseQuantityInput(values.quantityText);
  const acquisitionPriceSen = parseAcquisitionPriceInput(values.acquisitionPriceText);
  if (typeof quantity !== 'number' || typeof acquisitionPriceSen !== 'number') return null;
  return { code: values.code, quantity, acquisitionPriceSen };
}

/**
 * 保有銘柄の数量・取得単価の編集フォーム値（CR-3・T-103 FEレビュー対応）。
 * 銘柄コードは含まない（`UpdateHoldingRequest` が `code` を持たず、編集不可のため）。
 */
export interface EditHoldingFormValues {
  readonly quantityText: string;
  readonly acquisitionPriceText: string;
}

/**
 * 編集フォームの送信可否。
 *
 * TODO(CR-3・推測実装): `portfolio-page.md` は「数量編集」としか書いておらず、取得単価も
 * 編集対象にするか・両方の入力を必須にするかは明記が無い。Manager確認済みの前提として
 * **数量・取得単価の両方を編集対象とし、両方とも有効な入力を必須にする**（`UpdateHoldingRequest`
 * は両方 optional だが、フォームは常に既存値をprefillするため実質空欄になることは想定しない）。
 * `quantityErrorText`/`acquisitionPriceErrorText` を再利用し、重複実装しない。
 */
export function canSubmitEditHoldingForm(values: EditHoldingFormValues): boolean {
  if (quantityErrorText(parseQuantityInput(values.quantityText)) !== null) return false;
  if (acquisitionPriceErrorText(parseAcquisitionPriceInput(values.acquisitionPriceText)) !== null) {
    return false;
  }
  return true;
}

/** 送信payload組み立て。`canSubmitEditHoldingForm` が false のときは `null` */
export function buildUpdateHoldingPayload(
  values: EditHoldingFormValues,
): UpdateHoldingRequest | null {
  if (!canSubmitEditHoldingForm(values)) return null;
  const quantity = parseQuantityInput(values.quantityText);
  const acquisitionPriceSen = parseAcquisitionPriceInput(values.acquisitionPriceText);
  if (typeof quantity !== 'number' || typeof acquisitionPriceSen !== 'number') return null;
  return { quantity, acquisitionPriceSen };
}
