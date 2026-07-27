import { describe, expect, it } from 'vitest';

import { METRIC_KEYS } from '@/domain/shared/metric-key';
import { type MetricScore, scored, unavailable } from '@/domain/shared/metric-score';
import { scoreFromValidatedBand } from '@/domain/shared/score';
import {
  MAX_TOTAL_SCORE,
  TOTAL_METRIC_COUNT,
  type MetricScoreMap,
  buildScoreCard,
} from '@/domain/scoring/scoring-service';

/**
 * 総合点の集計（F-20 / §0.5）。
 *
 * 旧実装はこれを**カード描画関数の中**でやっていた（app.js:645-656）。
 * `null` と 0点を区別せず、有効指標数も出していなかった。
 */

function fill(value: number | null): (number | null)[] {
  return Array.from({ length: METRIC_KEYS.length }, () => value);
}

function mapOf(points: readonly (number | null)[]): MetricScoreMap {
  const entries = METRIC_KEYS.map((key, index) => {
    const value = points[index] ?? null;
    const metric: MetricScore<string> =
      value === null ? unavailable('input-missing') : scored(scoreFromValidatedBand(value), value);
    return [key, metric] as const;
  });
  return Object.fromEntries(entries) as MetricScoreMap;
}

describe('総合点の集計', () => {
  it('全指標が満点なら 100/100、有効 10/10', () => {
    const card = buildScoreCard(mapOf(fill(10)));
    expect(card.totalScore).toBe(100);
    expect(card.maxTotalScore).toBe(MAX_TOTAL_SCORE);
    expect(card.effectiveMetricCount).toBe(10);
    expect(card.totalMetricCount).toBe(TOTAL_METRIC_COUNT);
  });

  it('判定不能は 0点として合算する。分母は減らさない（§0.5）', () => {
    // 8指標が満点、⑥⑨ 相当が判定不能 → 80/100
    const points = fill(10);
    points[5] = null;
    points[8] = null;
    const card = buildScoreCard(mapOf(points));
    expect(card.totalScore).toBe(80);
    expect(card.maxTotalScore).toBe(100);
  });

  it('⑥⑨ が未実装の間は最大 80/100 になる。有効指標数を併記しないと誤読される', () => {
    const points = fill(10);
    points[5] = null;
    points[8] = null;
    const card = buildScoreCard(mapOf(points));
    expect(card.effectiveMetricCount).toBe(8);
    expect(`${card.totalScore}/${card.maxTotalScore}（有効 ${card.effectiveMetricCount}/10）`).toBe(
      '80/100（有効 8/10）',
    );
  });

  it('全指標が判定不能なら 0/100、有効 0/10', () => {
    const card = buildScoreCard(mapOf(fill(null)));
    expect(card.totalScore).toBe(0);
    expect(card.effectiveMetricCount).toBe(0);
  });

  it('0点と判定不能は総合点では同じでも、有効指標数で区別できる', () => {
    const allZero = buildScoreCard(mapOf(fill(0)));
    const allNull = buildScoreCard(mapOf(fill(null)));
    expect(allZero.totalScore).toBe(allNull.totalScore);
    expect(allZero.effectiveMetricCount).toBe(10);
    expect(allNull.effectiveMetricCount).toBe(0);
  });

  it('個別指標は 0 に丸めない。null のまま残す（画面が — を出すため）', () => {
    const points = fill(5);
    points[0] = null;
    const card = buildScoreCard(mapOf(points));
    const first = METRIC_KEYS[0];
    if (first === undefined) throw new Error('METRIC_KEYS が空');
    expect(card.metrics[first].score).toBeNull();
    expect(card.metrics[first].value).toBeNull();
  });

  it('総合点は 0〜100 に収まる', () => {
    for (let filled = 0; filled <= 10; filled++) {
      const points = METRIC_KEYS.map((_, index) => (index < filled ? 10 : null));
      const card = buildScoreCard(mapOf(points));
      expect(card.totalScore).toBeGreaterThanOrEqual(0);
      expect(card.totalScore).toBeLessThanOrEqual(100);
      expect(card.totalScore).toBe(filled * 10);
    }
  });
});
