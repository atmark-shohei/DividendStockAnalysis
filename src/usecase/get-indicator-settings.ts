/**
 * ユースケース: ログイン中ユーザーの指標カスタマイズ設定を返す（GET /api/indicator-settings）。
 *
 * 仕様: `docs/02_design/api/portfolio-api.md` §指標カスタマイズ。
 * 未設定（初回アクセス）なら 404 にせず、**全10指標選択・デフォルト基準値相当**を返す
 * （「保存済みレコードが無くても404にしない」）。
 */

import { deriveDefaultBaseline } from '../domain/scoring/band-scaling';
import {
  type BasisValueKey,
  type UserIndicatorSettings,
} from '../domain/scoring/user-indicator-settings';
import { type UserIndicatorSettingsRepository } from '../domain/scoring/user-indicator-settings-repository';
import { METRIC_KEYS } from '../domain/shared/metric-key';
import { unwrapOr } from '../domain/shared/result';
import { BANDS_BY_METRIC } from './get-scoring-bands';

/** ⑨MIX係数を除く、基準値を持てる9指標のキー */
const BASIS_VALUE_KEYS: readonly BasisValueKey[] = METRIC_KEYS.filter(
  (key): key is BasisValueKey => key !== 'mixCoefficient',
);

/** ⑩配当利回りの基準値単位変換（1/100%整数 → `%` 小数）。`resolve-scoring-bands.ts` の逆変換 */
function fromDividendYieldBaselineHundredths(hundredths: number): number {
  return hundredths / 100;
}

/**
 * 未設定ユーザーの既定応答: 全10指標選択・`bands.ts` のデフォルト満点境界。
 *
 * `deriveDefaultBaseline` が失敗する（理論上どの既存指標にも発生しない防御的分岐）
 * ケースは基準値 `0` を返す。呼び出し元の画面は基準値をそのまま数値入力欄へ
 * 表示するだけなので、0 は「入力し直してください」という程度の安全側の値になる。
 */
function defaultSettings(): UserIndicatorSettings {
  const basisValues: Partial<Record<BasisValueKey, number>> = {};
  for (const key of BASIS_VALUE_KEYS) {
    const baseline = unwrapOr(deriveDefaultBaseline(BANDS_BY_METRIC[key]), 0);
    basisValues[key] =
      key === 'dividendYield' ? fromDividendYieldBaselineHundredths(baseline) : baseline;
  }
  return { selectedKeys: METRIC_KEYS, basisValues };
}

export async function getIndicatorSettings(
  repository: UserIndicatorSettingsRepository,
  userId: number,
): Promise<UserIndicatorSettings> {
  const settings = await repository.findByUserId(userId);
  return settings ?? defaultSettings();
}
