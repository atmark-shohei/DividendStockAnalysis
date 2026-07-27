/**
 * スコアカードの組み立て（ドメインサービス）。
 *
 * **総合点の合算をここに置くのは意図的。** 旧実装はカード描画関数の中で
 * 合算しており（`reference/legacy-web/app.js:645-656`）、`null` と 0点を
 * 区別しないまま画面に出ていた。集計は表示層の関心事ではない。
 */

import { type MetricKey, METRIC_KEYS } from '../shared/metric-key';
import { type MetricScore, isScored } from '../shared/metric-score';

/** 満点。**判定不能な指標があっても分母は常に 100**（§0.5） */
export const MAX_TOTAL_SCORE = 100;
/** 指標の総数 */
export const TOTAL_METRIC_COUNT = METRIC_KEYS.length;

export type MetricScoreMap = Readonly<Record<MetricKey, MetricScore<string>>>;

export interface ScoreCard {
  readonly metrics: MetricScoreMap;
  /** 0〜100。判定不能な指標は 0点として合算する（§0.5） */
  readonly totalScore: number;
  /** 常に 100 */
  readonly maxTotalScore: number;
  /** 判定できた指標の数。総合点の隣に必ず併記する（§0.5） */
  readonly effectiveMetricCount: number;
  /** 常に 10 */
  readonly totalMetricCount: number;
}

/**
 * 10指標の判定結果から総合点を組み立てる。
 *
 * §0.5 の3点をここで満たす:
 * 1. **判定不能は 0点として合算する。** 除外して分母を減らさない
 * 2. **分母は常に 100点。** 実装済みが8指標でも 80/100 と出る
 * 3. **有効指標数を返す。** これを画面に併記しないと 80/100 が誤読される
 *
 * 0 に丸めるのは**この集計の中だけ**。個別指標は `null` のまま画面へ渡し、
 * 画面は `—` を出す（`0` を出してはいけない）。
 */
export function buildScoreCard(metrics: MetricScoreMap): ScoreCard {
  let totalScore = 0;
  let effectiveMetricCount = 0;

  for (const key of METRIC_KEYS) {
    const metric = metrics[key];
    if (isScored(metric)) {
      totalScore += metric.score;
      effectiveMetricCount++;
    }
    // 判定不能は 0点として合算する = 何も足さない（§0.5）
  }

  return {
    metrics,
    totalScore,
    maxTotalScore: MAX_TOTAL_SCORE,
    effectiveMetricCount,
    totalMetricCount: TOTAL_METRIC_COUNT,
  };
}
