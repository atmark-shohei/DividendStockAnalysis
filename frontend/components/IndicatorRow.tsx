import type { IndicatorConstraint, MetricKey, MetricUnit } from '../pages/indicator-custom-content';
import { NumberInput } from './NumberInput';

/** 1指標＝1行の表示に必要な静的情報。`App.tsx`/`IndicatorCustomPage.tsx` が組み立てる */
export interface IndicatorRowViewModel {
  readonly key: MetricKey;
  /** 原典での通し番号（①〜⑩）。現状は表示に使わないが、並び順の検証・将来拡張用に保持する */
  readonly number: number;
  readonly label: string;
  readonly unit: MetricUnit;
  /** `null` は MIX係数（設定不可。chip表示に切り替える） */
  readonly constraint: IndicatorConstraint | null;
  /** ③予想配当性向のみ非null（`indicator-custom-page.md` §4.0） */
  readonly reverseNote: string | null;
}

/**
 * 指標カスタマイズ画面（`/indicators`）の1指標分の行。
 *
 * **計算・判定をしない。** トグルのno-op判定・基準値バリデーションは呼び出し側
 * （`indicator-custom-logic.ts`）が行い、このコンポーネントは表示だけを担う
 * （`.claude/rules/frontend.md`）。
 */
export function IndicatorRow({
  row,
  selected,
  onToggle,
  valueText,
  onValueChange,
  error,
  disabled,
}: {
  readonly row: IndicatorRowViewModel;
  readonly selected: boolean;
  readonly onToggle: () => void;
  readonly valueText: string;
  readonly onValueChange: (raw: string) => void;
  readonly error: string | null;
  /**
   * fe-reviewer CR-3: 保存中（`saving`）は行全体を操作不可にする。
   * 保存応答受信時の再同期 `useEffect`（`IndicatorCustomPage.tsx`）が、保存中に行われた
   * 追加編集を警告なく破棄しうるため、送信中は編集自体をブロックする
   * （`AuthForm.tsx` の「送信中はボタンを disabled にする」方針を、行単位の入力にも適用する）
   */
  readonly disabled: boolean;
}) {
  return (
    <div className="indicator-row">
      <button
        type="button"
        className="indicator-toggle"
        aria-pressed={selected}
        aria-label={`${row.label}を${selected ? '解除' : '選択'}`}
        onClick={onToggle}
        disabled={disabled}
      />
      <div className="indicator-row-body">
        <span className="indicator-row-label">{row.label}</span>
        {row.constraint !== null && (
          <span className="meta">
            {`${String(row.constraint.step)}${row.unit}きざみ・${String(row.constraint.min)}${row.unit}〜${String(row.constraint.max)}${row.unit}`}
          </span>
        )}
        {row.reverseNote !== null && <span className="meta">{row.reverseNote}</span>}
        {error !== null && (
          <span className="warning" role="alert">
            {error}
          </span>
        )}
      </div>
      {row.constraint === null ? (
        <span className="chip">配当利回り・増配率から自動算出</span>
      ) : (
        <NumberInput
          value={valueText}
          onChange={onValueChange}
          step={row.constraint.step}
          min={row.constraint.min}
          max={row.constraint.max}
          disabled={disabled || !selected}
          invalid={error !== null}
          ariaLabel={`${row.label}の満点となる基準値`}
        />
      )}
    </div>
  );
}
