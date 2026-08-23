import { useEffect, useState } from 'react';

import type {
  IndicatorSettingsRequest,
  IndicatorSettingsResponse,
  ScoringBandsResponse,
} from '../api';
import { IndicatorRow, type IndicatorRowViewModel } from '../components/IndicatorRow';
import { ratioToEditableText, TOTAL_SCORE_COMPARISON_NOTE } from '../format';
import {
  INDICATOR_CONSTRAINTS,
  PAYOUT_RATIO_DIRECTION_NOTE,
  REVERSED_DIRECTION_KEYS,
  type MetricKey,
} from './indicator-custom-content';
import {
  basisValueErrorText,
  buildSavePayload,
  canSaveIndicatorSettings,
  isSelectionCountLow,
  parseBasisValueInput,
  toggleSelection,
} from './indicator-custom-logic';

/**
 * サーバーの `basisValues`（選択中・⑨MIX係数以外のみ含む）を、10指標ぶんの編集用テキストへ
 * 展開する。未選択・未設定のキーは空文字（`indicator-custom-page.md` §2「選択解除された
 * 行の数値入力は…入力値自体は保持する」はクライアント内トグルの話であり、サーバーから
 * 新規に取得した設定には未選択キーの値が無いため、ここでは空欄にする）。
 */
function buildInitialBasisValueTexts(
  bands: ScoringBandsResponse,
  settings: IndicatorSettingsResponse,
): Record<MetricKey, string> {
  const result = {} as Record<MetricKey, string>;
  for (const metric of bands.metrics) {
    if (metric.key === 'mixCoefficient') {
      result[metric.key] = '';
      continue;
    }
    const value = settings.basisValues[metric.key];
    result[metric.key] = value === undefined ? '' : ratioToEditableText(value);
  }
  return result;
}

/**
 * 「初期設定に戻す」用の編集テキストを組み立てる。`GET /api/scoring/bands` の
 * `defaultBasisValue`（BE側で `deriveDefaultBaseline` を1回呼んだ結果）をそのままコピーする
 * だけで、FE側では計算・判定を一切行わない（`.claude/rules/frontend.md`）。
 */
function buildDefaultBasisValueTexts(bands: ScoringBandsResponse): Record<MetricKey, string> {
  const result = {} as Record<MetricKey, string>;
  for (const metric of bands.metrics) {
    result[metric.key] =
      metric.defaultBasisValue === null ? '' : ratioToEditableText(metric.defaultBasisValue);
  }
  return result;
}

/**
 * 指標カスタマイズ画面（`/indicators`、T-101）。
 *
 * **データ取得はしない。** `bands`/`settings` は `App.tsx` が取得した結果を props で渡す
 * （`.claude/rules/frontend.md`）。ローカル編集state（選択・基準値の入力途中値）だけを持つ
 * （`indicator-custom-page.md` §1「フォームの編集中値は一時的にコピーせざるを得ない」）。
 */
export function IndicatorCustomPage({
  bands,
  settings,
  loading,
  saving,
  saveError,
  onSave,
}: {
  readonly bands: ScoringBandsResponse | null;
  readonly settings: IndicatorSettingsResponse | null;
  readonly loading: boolean;
  readonly saving: boolean;
  readonly saveError: string | null;
  readonly onSave: (payload: IndicatorSettingsRequest) => void;
}) {
  const [selected, setSelected] = useState<readonly MetricKey[]>([]);
  // 初期値は空オブジェクト（`bands`/`settings` が届く前は行自体を描画しないため、
  // 未初期化キーへのアクセスは常に `?? ''` で防御する）
  const [basisValueTexts, setBasisValueTexts] = useState<Record<MetricKey, string>>(
    {} as Record<MetricKey, string>,
  );

  // `settings`（`App.tsx` の state）の参照が変わるたびにローカル編集stateへ同期する。
  // 保存成功後は PUT の応答がそのまま `settings` に上書きされる設計（App.tsx §5）なので、
  // ここで再同期することが「保存直後に再取得した設定が編集内容と一致する」受入基準になる。
  useEffect(() => {
    if (settings === null || bands === null) return;
    setSelected(settings.selected);
    setBasisValueTexts(buildInitialBasisValueTexts(bands, settings));
  }, [settings, bands]);

  if (loading) return <p className="meta">読み込み中…</p>;
  if (bands === null || settings === null) {
    return (
      <p className="meta" role="alert">
        指標設定を表示できませんでした。
      </p>
    );
  }

  const rows: readonly IndicatorRowViewModel[] = bands.metrics.map((metric) => ({
    key: metric.key,
    number: metric.number,
    label: metric.label,
    unit: metric.unit,
    constraint: INDICATOR_CONSTRAINTS[metric.key],
    reverseNote: REVERSED_DIRECTION_KEYS.has(metric.key) ? PAYOUT_RATIO_DIRECTION_NOTE : null,
  }));

  const selectedCount = selected.length;
  const countLow = isSelectionCountLow(selectedCount);
  const canSave = canSaveIndicatorSettings(selected, basisValueTexts);

  const handleToggle = (key: MetricKey) => {
    setSelected((current) => toggleSelection(current, key));
  };

  const handleValueChange = (key: MetricKey, raw: string) => {
    setBasisValueTexts((current) => ({ ...current, [key]: raw }));
  };

  /** §5「初期設定に戻す」: 全指標を選択・デフォルト基準値に即時反映する。保存はまだしない */
  const handleResetToDefault = () => {
    setSelected(bands.metrics.map((metric) => metric.key));
    setBasisValueTexts(buildDefaultBasisValueTexts(bands));
  };

  const handleSave = () => {
    if (!canSave) return;
    onSave(buildSavePayload(selected, basisValueTexts));
  };

  return (
    <section>
      <h2>指標カスタマイズ</h2>
      <p className={countLow ? 'indicator-counter indicator-counter-low' : 'indicator-counter'}>
        選択中 <span className="numeric">{selectedCount}</span> / 10（最小 5）
      </p>
      {countLow && (
        <p className="warning" role="status">
          ⚠ 選択中の指標が5個未満です。5〜10個を選択してください。
        </p>
      )}
      {/* ADR-0012 §決定D-3。常時表示・非表示にできない（§2） */}
      <p className="meta">{TOTAL_SCORE_COMPARISON_NOTE}</p>
      <div className="indicator-list">
        {rows.map((row) => {
          const isSelected = selected.includes(row.key);
          const valueText = basisValueTexts[row.key] ?? '';
          const error =
            !isSelected || row.constraint === null
              ? null
              : basisValueErrorText(parseBasisValueInput(valueText), row.constraint);
          return (
            <IndicatorRow
              key={row.key}
              row={row}
              selected={isSelected}
              onToggle={() => handleToggle(row.key)}
              valueText={valueText}
              onValueChange={(raw) => handleValueChange(row.key, raw)}
              error={error}
              disabled={saving}
            />
          );
        })}
      </div>
      <button type="button" onClick={handleSave} disabled={saving || !canSave}>
        設定を保存
      </button>
      <button
        type="button"
        className="button-outline"
        onClick={handleResetToDefault}
        disabled={saving}
      >
        初期設定に戻す
      </button>
      {saveError !== null && (
        <p className="error" role="alert">
          {saveError}
        </p>
      )}
    </section>
  );
}
