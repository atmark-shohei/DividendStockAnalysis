/**
 * `GET`/`PUT /api/indicator-settings` の入出力 DTO と zod スキーマ（T-101）。
 *
 * 仕様: `docs/02_design/api/portfolio-api.md` §指標カスタマイズ、
 * `docs/02_design/ui/pages/indicator-custom-page.md`。
 * **zod は handler の境界でだけ使う**（`.claude/CLAUDE.md`）。
 */

import { z } from 'zod';

import { type BasisValueKey, type UserIndicatorSettings } from '../../domain/scoring/user-indicator-settings';
import { METRIC_KEYS, METRIC_LABEL, type MetricKey } from '../../domain/shared/metric-key';
import { type SaveIndicatorSettingsError } from '../../usecase/save-indicator-settings';

/**
 * PUTリクエストボディ。
 *
 * `basisValues` のキーは**あえて `MetricKey` に絞らない**（`z.string()`）。
 * ⑨MIX係数キーの有無・件数（5〜10）はここではなく usecase 側（`saveIndicatorSettings`）で
 * 検証する。zod の enum で構造的に弾くと、専用のエラーメッセージ
 * （`{ "error": "MIX係数の基準値は指定できません" }`）を返せなくなるため
 * （BE計画 §3）。
 */
export const indicatorSettingsRequest = z.object({
  selected: z.array(z.enum(METRIC_KEYS)),
  basisValues: z.record(z.string(), z.number().finite()),
});
export type IndicatorSettingsRequest = z.infer<typeof indicatorSettingsRequest>;

/** GET/PUT共通の応答形（`portfolio-api.md` §指標カスタマイズ） */
export interface IndicatorSettingsResponse {
  readonly selected: readonly MetricKey[];
  /** ⑨MIX係数は含まれない（設定不可のため） */
  readonly basisValues: Readonly<Partial<Record<BasisValueKey, number>>>;
}

/** usecase の戻り値（`UserIndicatorSettings`）をそのまま応答形へ写す */
export function toIndicatorSettingsResponse(
  settings: UserIndicatorSettings,
): IndicatorSettingsResponse {
  return {
    selected: settings.selectedKeys,
    basisValues: settings.basisValues,
  };
}

/**
 * `saveIndicatorSettings` のドメインエラーを HTTP 応答へ変換する。
 * 文言は `portfolio-api.md` §指標カスタマイズ の表・`indicator-custom-page.md` §4 と一致させる。
 */
export function toSaveIndicatorSettingsErrorResponse(error: SaveIndicatorSettingsError): {
  readonly body: { readonly error: string };
  readonly status: 400;
} {
  switch (error.kind) {
    case 'selected-count-out-of-range':
      return { body: { error: '選択する指標は5〜10個にしてください' }, status: 400 };
    case 'mix-coefficient-basis-value-present':
      return { body: { error: 'MIX係数の基準値は指定できません' }, status: 400 };
    case 'basis-value-missing':
      return {
        body: { error: `${METRIC_LABEL[error.key]}の基準値を指定してください` },
        status: 400,
      };
    case 'basis-value-not-positive':
      return { body: { error: '満点となる基準値は 0 より大きい値にしてください' }, status: 400 };
    case 'basis-value-out-of-range':
      return {
        body: { error: `${METRIC_LABEL[error.key]}の基準値が指定できる範囲外です` },
        status: 400,
      };
    case 'invalid-bands':
      // 理論上到達しない防御的分岐（BE計画 §3 手順6）。内部情報は出さない
      return { body: { error: '指標の設定を保存できませんでした' }, status: 400 };
  }
}
