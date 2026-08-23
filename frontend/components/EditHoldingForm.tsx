import { useState } from 'react';

import type { HoldingView, UpdateHoldingRequest } from '../api';
import { senToEditableText } from '../format';
import {
  acquisitionPriceErrorText,
  buildUpdateHoldingPayload,
  canSubmitEditHoldingForm,
  parseAcquisitionPriceInput,
  parseQuantityInput,
  quantityErrorText,
  type EditHoldingFormValues,
} from '../pages/portfolio-page-logic';
import { NumberInput } from './NumberInput';

/**
 * 保有銘柄の数量・取得単価の編集フォーム（CR-3・T-103 FEレビュー対応）。
 * `<HoldingForm>` と同型の構造（`<Dialog>` の中身として使う）だが、銘柄コードは
 * 変更不可のため入力欄を持たず、代わりに読み取り専用の銘柄名・コードを表示する
 * （`UpdateHoldingRequest` が `code` を持たない設計に合わせる）。
 *
 * 呼び出し側（`PortfolioPage.tsx`）は編集対象の `holding` が変わるたびに
 * `key={holding.code}` を付けて再マウントさせること（このコンポーネント自身は
 * 初期値をマウント時の `holding` からしか読まないため）。
 *
 * TODO(CR-3・推測実装): `portfolio-page.md` は「数量編集」としか書いておらず、取得単価も
 * 編集対象にするかは明記が無い。数量・取得単価の両方を編集可能にする前提を置いた
 * （`portfolio-page-logic.ts` の `canSubmitEditHoldingForm` 参照。Manager確認済み）。
 */
export function EditHoldingForm({
  holding,
  onSubmit,
  onCancel,
  submitting,
  submitError,
}: {
  readonly holding: HoldingView;
  readonly onSubmit: (payload: UpdateHoldingRequest) => void;
  readonly onCancel: () => void;
  readonly submitting: boolean;
  readonly submitError: string | null;
}) {
  const [values, setValues] = useState<EditHoldingFormValues>({
    quantityText: String(holding.quantity),
    acquisitionPriceText: senToEditableText(holding.acquisitionPriceSen),
  });

  const quantityError = quantityErrorText(parseQuantityInput(values.quantityText));
  const acquisitionPriceError = acquisitionPriceErrorText(
    parseAcquisitionPriceInput(values.acquisitionPriceText),
  );
  const canSubmit = canSubmitEditHoldingForm(values);

  const handleSubmit = () => {
    const payload = buildUpdateHoldingPayload(values);
    if (payload === null) return;
    onSubmit(payload);
  };

  return (
    <div>
      <h2 id="edit-holding-title">保有銘柄を編集</h2>
      <p>
        <span className="company-name">{holding.name}</span>{' '}
        <span className="mono company-code">{holding.code}</span>
      </p>
      <label>
        保有数量
        <NumberInput
          value={values.quantityText}
          onChange={(raw) => {
            setValues((current) => ({ ...current, quantityText: raw }));
          }}
          step={1}
          min={1}
          max={1_000_000_000}
          disabled={submitting}
          invalid={quantityError !== null}
          ariaLabel="保有数量"
        />
      </label>
      {quantityError !== null && (
        <p className="warning" role="alert">
          {quantityError}
        </p>
      )}
      <label>
        取得単価（円）
        <NumberInput
          value={values.acquisitionPriceText}
          onChange={(raw) => {
            setValues((current) => ({ ...current, acquisitionPriceText: raw }));
          }}
          step={0.01}
          min={0.01}
          max={1_000_000}
          disabled={submitting}
          invalid={acquisitionPriceError !== null}
          ariaLabel="取得単価"
        />
      </label>
      {acquisitionPriceError !== null && (
        <p className="warning" role="alert">
          {acquisitionPriceError}
        </p>
      )}
      {submitError !== null && (
        <p className="error" role="alert">
          {submitError}
        </p>
      )}
      <button type="button" onClick={handleSubmit} disabled={submitting || !canSubmit}>
        更新する
      </button>
      <button type="button" className="button-outline" onClick={onCancel} disabled={submitting}>
        キャンセル
      </button>
    </div>
  );
}
