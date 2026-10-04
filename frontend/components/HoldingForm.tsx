import { useState } from 'react';

import type { AddHoldingRequest } from '../api';
import {
  acquisitionPriceErrorText,
  buildAddHoldingPayload,
  canSubmitHoldingForm,
  codeErrorText,
  normalizeHoldingCodeInput,
  parseAcquisitionPriceInput,
  parseQuantityInput,
  quantityErrorText,
  type HoldingFormValues,
} from '../pages/portfolio-page-logic';
import { NumberInput } from './NumberInput';

/**
 * 「＋ 銘柄を追加」フォーム（`docs/02_design/ui/pages/portfolio-page.md` §5）。
 * モーダル（`<Dialog>`）の中身として `PortfolioPage.tsx` から使う
 * （fe-plan.md §1 確認事項D、Manager決定: 既存 `<Dialog>` を使ったモーダル）。
 *
 * ローカル state で編集中値を持つ（`.claude/rules/frontend.md`「フォームの編集中値は
 * 一時的にコピーせざるを得ない」。`indicator-custom-page.md` §1 と同じ扱い）。
 * バリデーション・payload組み立ては `portfolio-page-logic.ts` の純関数に委譲する
 * （計算・判定をコンポーネントに書かない）。
 */
export function HoldingForm({
  onSubmit,
  onCancel,
  submitting,
  submitError,
}: {
  readonly onSubmit: (payload: AddHoldingRequest) => void;
  readonly onCancel: () => void;
  readonly submitting: boolean;
  readonly submitError: string | null;
}) {
  const [values, setValues] = useState<HoldingFormValues>({
    code: '',
    quantityText: '',
    acquisitionPriceText: '',
  });

  const codeError = values.code === '' ? null : codeErrorText(values.code);
  const quantityError =
    values.quantityText === ''
      ? null
      : quantityErrorText(parseQuantityInput(values.quantityText));
  const acquisitionPriceError =
    values.acquisitionPriceText === ''
      ? null
      : acquisitionPriceErrorText(parseAcquisitionPriceInput(values.acquisitionPriceText));
  const canSubmit = canSubmitHoldingForm(values);

  const handleSubmit = () => {
    const payload = buildAddHoldingPayload(values);
    if (payload === null) return;
    onSubmit(payload);
  };

  return (
    <div>
      <h2 id="add-holding-title">銘柄を追加</h2>
      <label>
        銘柄コード
        <input
          type="text"
          value={values.code}
          disabled={submitting}
          aria-invalid={codeError !== null}
          onChange={(event) => {
            const nextCode = normalizeHoldingCodeInput(event.target.value);
            setValues((current) => ({ ...current, code: nextCode }));
          }}
        />
      </label>
      {codeError !== null && (
        <p className="warning" role="alert">
          {codeError}
        </p>
      )}
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
        追加する
      </button>
      <button type="button" className="button-outline" onClick={onCancel} disabled={submitting}>
        キャンセル
      </button>
    </div>
  );
}
