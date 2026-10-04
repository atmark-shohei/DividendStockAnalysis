import { toHalfWidthNumber } from '../pages/indicator-custom-logic';

/**
 * 数値入力の共通ラッパー。責務は**全角正規化のみ**（`indicator-custom-page.md` §8
 * 「既存コンポーネント方針。全角数字の正規化・範囲検証込み」）。
 *
 * 範囲検証・0以下チェックなどの業務ルールはここに持たせない
 * （`basisValueErrorText` 等、呼び出し側の純関数に委譲する）。将来他画面でも
 * 使い回せる「見た目＋正規化」だけの部品にする。
 */
export function NumberInput({
  value,
  onChange,
  step,
  min,
  max,
  disabled,
  invalid,
  ariaLabel,
}: {
  /** 編集中のテキストをそのまま持つ（`CompanyForm.tsx` の入力欄と同じ方式） */
  readonly value: string;
  readonly onChange: (raw: string) => void;
  readonly step: number;
  readonly min: number;
  readonly max: number;
  readonly disabled: boolean;
  readonly invalid: boolean;
  readonly ariaLabel: string;
}) {
  return (
    <input
      type="number"
      inputMode="decimal"
      step={step}
      min={min}
      max={max}
      value={value}
      disabled={disabled}
      aria-invalid={invalid}
      aria-label={ariaLabel}
      onChange={(event) => onChange(toHalfWidthNumber(event.target.value))}
    />
  );
}
