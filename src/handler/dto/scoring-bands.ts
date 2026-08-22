/**
 * `GET /api/scoring/bands` の応答 DTO（T-099 評価基準画面）。
 *
 * クエリパラメータ・パスパラメータを持たない設計なので zod スキーマは無い
 * （`company-dividends.ts` と同じ前例）。「型 + 変換関数」ペアの分割方針も踏襲する。
 */

import { type MetricBands } from '../../usecase/get-scoring-bands';
import { type MetricKey, type MetricUnit } from '../../domain/shared/metric-key';

export interface ScoreBandView {
  /** 下限。この値を含む。`null` は下限なし */
  readonly minInclusive: number | null;
  /** 上限。この値を含まない。`null` は上限なし（最上位区分） */
  readonly maxExclusive: number | null;
  /** 0〜10 */
  readonly points: number;
}

export interface MetricBandsView {
  readonly key: MetricKey;
  /** 原典での通し番号（①〜⑩） */
  readonly number: number;
  readonly label: string;
  readonly unit: MetricUnit;
  /** `bands.ts` の対応定数をそのまま返す。段数を揃えたり補完したりしない */
  readonly bands: readonly ScoreBandView[];
}

export interface ScoringBandsResponse {
  /** `METRIC_KEYS` の順（①〜⑩）で固定10件 */
  readonly metrics: readonly MetricBandsView[];
}

/**
 * usecase の戻り値をそのまま応答形へ写す。値の変換・丸め・並び替えはしない。
 */
export function toScoringBandsResponse(metrics: readonly MetricBands[]): ScoringBandsResponse {
  return {
    metrics: metrics.map((metric) => ({
      key: metric.key,
      number: metric.number,
      label: metric.label,
      unit: metric.unit,
      bands: metric.bands.map((band) => ({
        minInclusive: band.minInclusive,
        maxExclusive: band.maxExclusive,
        points: band.points,
      })),
    })),
  };
}
