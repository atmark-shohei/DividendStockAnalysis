/**
 * 指標カスタマイズ画面（`/indicators`、T-101）の純関数群。
 *
 * JSX を持たない。`@testing-library/react` 未導入のため、トグルの no-op 判定・
 * バリデーション・保存payload組み立てをここに切り出し、`tests/frontend/*.test.ts`
 * （`.tsx` ではない）で直接呼び出してテストする（`AuthForm.tsx` と同じ方針。
 * `.claude/rules/frontend.md`「計算・判定をしない」の対象は指標のスコアリング計算であり、
 * ここでのバリデーションはUIの入力制約であって指標の判定ロジックではない）。
 */

import type { IndicatorSettingsRequest } from '../api';
import {
  INDICATOR_CONSTRAINTS,
  type IndicatorConstraint,
  type MetricKey,
} from './indicator-custom-content';

const FULLWIDTH_OFFSET = 0xfee0;

/**
 * 全角→半角正規化。`CompanyForm.tsx` の `toHalfWidth` と同じ実装をこちらにも持つ。
 * `toHalfWidth` は非export・privateなため import できない。既存の重複容認パターン
 * （`routes.ts` の `COMPANY_CODE` 独自定義前例）に倣い、ここで再定義する。
 */
export function toHalfWidthNumber(raw: string): string {
  return raw
    .replace(/[！-～]/g, (char) => String.fromCharCode(char.charCodeAt(0) - FULLWIDTH_OFFSET))
    .replace(/−/g, '-')
    .replace(/　/g, ' ')
    .trim();
}

/**
 * 基準値の解析。空文字は `null`（未入力）、不正値（数値として読めない）は `undefined`
 * （`CompanyForm.toRatio` と同じ3値設計）。
 */
export function parseBasisValueInput(raw: string): number | null | undefined {
  const normalized = toHalfWidthNumber(raw);
  if (normalized === '') return null;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : undefined;
}

/**
 * トグルのno-op判定込みの選択切り替え。
 * `indicator-custom-page.md` §5「選択のブロックはトグル操作そのものを no-op にする」。
 */
export function toggleSelection(
  selected: readonly MetricKey[],
  key: MetricKey,
): readonly MetricKey[] {
  const isSelected = selected.includes(key);
  if (isSelected && selected.length <= 5) return selected; // no-op（下限。現在5個からは減らせない）
  if (!isSelected && selected.length >= 10) return selected; // no-op（上限。現在10個からは増やせない）
  return isSelected ? selected.filter((k) => k !== key) : [...selected, key];
}

/** 選択数が最小値（5）未満か。amber化・警告バナー表示の判定に使う（§2） */
export function isSelectionCountLow(selectedCount: number): boolean {
  return selectedCount < 5;
}

/**
 * 値が `step` の倍数か（浮動小数点誤差を許容）。
 *
 * fe-reviewer CR-2: BE側 `isMultipleOfStep`（`src/usecase/save-indicator-settings.ts`）と
 * 同じ判定基準（`value / step` を丸めた値との差が `1e-6` 未満）にする。意図的なFEローカル
 * 再定義（`INDICATOR_CONSTRAINTS` と同じ理由。ADR-0008 により `src/usecase` を
 * ランタイム import できないため）。BE側の許容誤差が変わったらここも手動で追従させること。
 */
function isMultipleOfStep(value: number, step: number): boolean {
  const scaled = value / step;
  return Math.abs(scaled - Math.round(scaled)) < 1e-6;
}

/**
 * 基準値のエラー文言。優先順位（`indicator-custom-page.md` §4・§7`、fe-reviewer CR-2 で
 * きざみ検証を追加）:
 * 1. 空文字・非数値 → 「数値を入力してください」
 * 2. 0以下（§4。③⑥だけでなく全指標共通の追加ガード） →
 *    「満点となる基準値は 0 より大きい値にしてください」
 * 3. §3 の min/max 範囲外 → 「◯〜◯の範囲で入力してください」
 * 4. §3 のきざみ（`step`）の倍数でない → 「◯きざみで入力してください」
 *    （BE側 `isMultipleOfStep` は範囲外と同じ `basis-value-out-of-range` に統合しているが、
 *    FE側はユーザーに何を直せばよいか伝えるため文言を分ける。TODO: 文言の正典は
 *    `docs/02_design/ui/pages/indicator-custom-page.md` §7 に未記載のため推測で追加した）
 * 該当なしは `null`。
 */
export function basisValueErrorText(
  value: number | null | undefined,
  constraint: IndicatorConstraint,
): string | null {
  if (value === null || value === undefined) return '数値を入力してください';
  if (value <= 0) return '満点となる基準値は 0 より大きい値にしてください';
  if (value < constraint.min || value > constraint.max) {
    return `${String(constraint.min)}〜${String(constraint.max)}の範囲で入力してください`;
  }
  if (!isMultipleOfStep(value, constraint.step)) {
    return `${String(constraint.step)}きざみで入力してください`;
  }
  return null;
}

/**
 * PUT payload組み立て。選択していない指標の基準値は含めない（`indicator-custom-page.md`
 * §6「選択していない指標の基準値は送らない」）。⑨MIX係数は選択されていても基準値を
 * 含めない（設定不可。`basisValueTexts` にMIX係数の値が入っていても無視する）。
 * 解析できない（`undefined`）行が混ざっていた場合も送信対象に含めない
 * （呼び出し側は `canSaveIndicatorSettings` が true のときだけ呼ぶ前提だが、
 * 防御的にここでも除外する）。
 */
export function buildSavePayload(
  selected: readonly MetricKey[],
  basisValueTexts: Readonly<Record<MetricKey, string>>,
): IndicatorSettingsRequest {
  const basisValues: Record<string, number> = {};
  for (const key of selected) {
    if (key === 'mixCoefficient') continue;
    const parsed = parseBasisValueInput(basisValueTexts[key]);
    if (typeof parsed === 'number') {
      basisValues[key] = parsed;
    }
  }
  return { selected: [...selected], basisValues };
}

/**
 * 選択数の下限・上限。`src/usecase/save-indicator-settings.ts` の
 * `MIN_SELECTED_COUNT`/`MAX_SELECTED_COUNT` と値を揃える意図的なFEローカル再定義
 * （`INDICATOR_CONSTRAINTS` と同じ理由。ADR-0008 により `src/usecase` を
 * ランタイム import できないため）。BE側の値が変わったらここも手動で追従させること。
 */
const MIN_SELECTED_COUNT = 5;
const MAX_SELECTED_COUNT = 10;

/**
 * 保存可否（送信前フロントバリデーション）。
 *
 * fe-reviewer CR-4: `toggleSelection` の不変条件（5〜10の範囲内でしかトグルできない）だけに
 * 依存すると、初期state（`IndicatorCustomPage` の `useState<readonly MetricKey[]>([])`）や
 * `settings` 未反映時点の空配列に対する防御が抜ける。ここでも選択数の範囲を独立して検証する。
 *
 * 1. 選択数が5〜10の範囲外 → false
 * 2. 選択中の指標（⑨MIX係数を除く）に1つでもエラー行があれば → false
 */
export function canSaveIndicatorSettings(
  selected: readonly MetricKey[],
  basisValueTexts: Readonly<Record<MetricKey, string>>,
): boolean {
  if (selected.length < MIN_SELECTED_COUNT || selected.length > MAX_SELECTED_COUNT) return false;

  return selected
    .filter((key) => key !== 'mixCoefficient')
    .every((key) => {
      const constraint = INDICATOR_CONSTRAINTS[key];
      if (constraint === null) return true; // 到達しない防御的分岐（MIX係数は上で除外済み）
      const parsed = parseBasisValueInput(basisValueTexts[key]);
      return basisValueErrorText(parsed, constraint) === null;
    });
}
