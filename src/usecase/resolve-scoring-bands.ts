/**
 * ユースケース: ユーザーの指標設定から「有効な選択指標・区分表」を導出する（T-101）。
 *
 * `GET /api/indicator-settings`（間接的に`get-indicator-settings.ts`経由）と
 * `GET /api/companies/:code`（`read-companies.ts` の `getCompanyScoring` 経由）の
 * 両方が必要とする「選択・基準値 → 有効な区分表」という同じ変換を1箇所に集約する
 * （BE計画 §2.1）。⑩配当利回りの単位変換（`%` 小数 → 1/100%整数）もここに閉じる
 * （BE計画 §4。DB保存は `%` 小数のまま）。
 */

import { scaleBands } from '../domain/scoring/band-scaling';
import { type ScoreBand } from '../domain/scoring/score-band';
import { type BasisValueKey } from '../domain/scoring/user-indicator-settings';
import { type UserIndicatorSettingsRepository } from '../domain/scoring/user-indicator-settings-repository';
import { METRIC_KEYS, type MetricKey } from '../domain/shared/metric-key';
import { unwrapOr } from '../domain/shared/result';
import { BANDS_BY_METRIC } from './get-scoring-bands';

/** ユーザー未設定・未ログイン（ゲスト）の既定選択。全10指標 */
const DEFAULT_SELECTED_KEYS: readonly MetricKey[] = METRIC_KEYS;

export interface ResolvedScoringBands {
  /** 総合点の集計対象にする指標。`domain.buildScoreCard` の `selectedKeys` にそのまま渡す */
  readonly selectedKeys: readonly MetricKey[];
  /** 指標ごとの有効な区分表。各 `calculate*` 関数の `bands` 引数にそのまま渡す */
  readonly bandsByMetric: Readonly<Record<MetricKey, readonly ScoreBand[]>>;
}

export interface ResolveScoringBandsDependencies {
  readonly userIndicatorSettingsRepository: UserIndicatorSettingsRepository;
}

/**
 * ⑩配当利回りの基準値単位変換。`%` 小数 → 1/100%整数（`bands.ts` の
 * `DIVIDEND_YIELD_BANDS` と同じ単位）。丸めるのはここ1箇所（BE計画 §4）。
 */
function toDividendYieldBaselineHundredths(basisValuePercent: number): number {
  return Math.round(basisValuePercent * 100);
}

/**
 * 1指標分の有効な区分表を導出する。
 *
 * - ⑨MIX係数は常にデフォルト定数（ユーザー設定不可。ADR-0012）
 * - 基準値が指定されていなければデフォルト定数をそのまま使う
 * - スケーリングが失敗した場合（`save-indicator-settings.ts` の保存前検証を
 *   通過済みのため理論上到達しない防御的分岐）はデフォルト定数へフォールバックする。
 *   総合点の算出を止めないため（表示は「判定不能」ではなくデフォルト基準での判定になる）
 */
function resolveBandsForMetric(
  key: MetricKey,
  basisValues: Readonly<Partial<Record<BasisValueKey, number>>>,
): readonly ScoreBand[] {
  const defaultBands = BANDS_BY_METRIC[key];
  if (key === 'mixCoefficient') return defaultBands;

  const basisValue = basisValues[key];
  if (basisValue === undefined) return defaultBands;

  const baselineValue =
    key === 'dividendYield' ? toDividendYieldBaselineHundredths(basisValue) : basisValue;
  return unwrapOr(scaleBands(defaultBands, baselineValue), defaultBands);
}

/**
 * ユーザーID（`null` はゲスト）から、有効な選択指標・区分表を導出する。
 *
 * ゲスト（`userId === null`）・未設定ユーザー（保存済み行が0件）は「全10指標選択・
 * `bands.ts` のデフォルト区分表」という**同じ既定応答**になる（BE計画 §5。
 * `userId === null` の場合はリポジトリへ問い合わせすらしない）。
 */
export async function resolveScoringBands(
  deps: ResolveScoringBandsDependencies,
  userId: number | null,
): Promise<ResolvedScoringBands> {
  const settings =
    userId === null ? null : await deps.userIndicatorSettingsRepository.findByUserId(userId);

  const selectedKeys = settings?.selectedKeys ?? DEFAULT_SELECTED_KEYS;
  const basisValues = settings?.basisValues ?? {};

  const bandsByMetric = {} as Record<MetricKey, readonly ScoreBand[]>;
  for (const key of METRIC_KEYS) {
    bandsByMetric[key] = resolveBandsForMetric(key, basisValues);
  }

  return { selectedKeys, bandsByMetric };
}
