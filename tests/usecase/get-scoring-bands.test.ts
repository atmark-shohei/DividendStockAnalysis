import { describe, expect, it } from 'vitest';

import {
  CONSECUTIVE_YEARS_BANDS,
  DIVIDEND_GROWTH_RATE_BANDS,
  DIVIDEND_SUSTAINABILITY_BANDS,
  DIVIDEND_YIELD_BANDS,
  EPS_CAGR_BANDS,
  MIX_COEFFICIENT_BANDS,
  OPERATING_MARGIN_BANDS,
  PAYOUT_RATIO_BANDS,
  REVENUE_CAGR_BANDS,
  ROE_AVERAGE_BANDS,
} from '@/domain/scoring/bands';
import {
  METRIC_KEYS,
  METRIC_LABEL,
  METRIC_NUMBER,
  METRIC_UNIT,
  type MetricKey,
} from '@/domain/shared/metric-key';
import { getScoringBands } from '@/usecase/get-scoring-bands';

/**
 * `getScoringBands()` の結線テスト。
 *
 * `src/domain/scoring/bands.ts` は変更しないため、ここで確認したいのは
 * 「usecase が bands.ts の値をそのまま（書き写さず）返しているか」「METRIC_KEYS の順序を
 * 保っているか」だけ。区分表そのものの健全性（穴・重複が無いこと）は
 * `tests/domain/scoring/bands.test.ts` で尽くしてある。
 */

const EXPECTED_BANDS_BY_KEY: Readonly<Record<MetricKey, readonly unknown[]>> = {
  dividendGrowthRate: DIVIDEND_GROWTH_RATE_BANDS,
  consecutiveYears: CONSECUTIVE_YEARS_BANDS,
  payoutRatio: PAYOUT_RATIO_BANDS,
  epsCagr: EPS_CAGR_BANDS,
  roeAverage: ROE_AVERAGE_BANDS,
  dividendSustainability: DIVIDEND_SUSTAINABILITY_BANDS,
  revenueCagr: REVENUE_CAGR_BANDS,
  operatingMargin: OPERATING_MARGIN_BANDS,
  mixCoefficient: MIX_COEFFICIENT_BANDS,
  dividendYield: DIVIDEND_YIELD_BANDS,
};

describe('getScoringBands', () => {
  it('METRIC_KEYS の順（①〜⑩）で10件返す', () => {
    const result = getScoringBands();
    expect(result).toHaveLength(10);
    expect(result.map((metric) => metric.key)).toEqual(METRIC_KEYS);
  });

  it.each(METRIC_KEYS)('%s の number/label/unit が metric-key.ts と一致する', (key) => {
    const metric = getScoringBands().find((item) => item.key === key);
    expect(metric?.number).toBe(METRIC_NUMBER[key]);
    expect(metric?.label).toBe(METRIC_LABEL[key]);
    expect(metric?.unit).toBe(METRIC_UNIT[key]);
  });

  it.each(METRIC_KEYS)(
    '%s の bands は bands.ts の対応定数と値が一致する（書き写しでなくコピー）',
    (key) => {
      const metric = getScoringBands().find((item) => item.key === key);
      expect(metric?.bands).toEqual(EXPECTED_BANDS_BY_KEY[key]);
    },
  );

  describe('defaultBasisValue（T-101。指標カスタマイズ「初期設定に戻す」用）', () => {
    it('⑨MIX係数は常に null（設定不可）', () => {
      const mixCoefficient = getScoringBands().find((metric) => metric.key === 'mixCoefficient');
      expect(mixCoefficient?.defaultBasisValue).toBeNull();
    });

    it('昇順9指標はデフォルト区分表の最上位区分の下限がそのまま入る', () => {
      const dividendGrowthRate = getScoringBands().find(
        (metric) => metric.key === 'dividendGrowthRate',
      );
      expect(dividendGrowthRate?.defaultBasisValue).toBe(30);

      const roeAverage = getScoringBands().find((metric) => metric.key === 'roeAverage');
      expect(roeAverage?.defaultBasisValue).toBe(15);
    });

    it('③予想配当性向（降順）は最上位区分の上限が入る', () => {
      const payoutRatio = getScoringBands().find((metric) => metric.key === 'payoutRatio');
      expect(payoutRatio?.defaultBasisValue).toBe(25);
    });

    it('⑩配当利回りは 1/100%整数（550）を `%` 小数（5.5）に変換して返す。DBと同じ単位系にするため', () => {
      const dividendYield = getScoringBands().find((metric) => metric.key === 'dividendYield');
      expect(dividendYield?.defaultBasisValue).toBe(5.5);
    });
  });

  describe('境界値（bands.ts の特殊値がそのまま渡ること）', () => {
    it('③予想配当性向は10段。1点を返す経路が無い（bands.ts の意図的な仕様）', () => {
      const payoutRatio = getScoringBands().find((metric) => metric.key === 'payoutRatio');
      expect(payoutRatio?.bands).toHaveLength(10);
      expect(payoutRatio?.bands.some((band) => band.points === 1)).toBe(false);
    });

    it('②連続非減配年数は4段（10/5/3/0のみ）。段数を補完しない', () => {
      const consecutiveYears = getScoringBands().find(
        (metric) => metric.key === 'consecutiveYears',
      );
      expect(consecutiveYears?.bands.map((band) => band.points)).toEqual([10, 5, 3, 0]);
    });

    it('⑤ROE平均の最下段は minInclusive: null（下限なし）のまま渡る', () => {
      const roeAverage = getScoringBands().find((metric) => metric.key === 'roeAverage');
      const lowest = roeAverage?.bands.find((band) => band.points === 0);
      expect(lowest?.minInclusive).toBeNull();
      expect(lowest?.maxExclusive).toBe(2);
    });

    it('⑨MIX係数は最上位区分（下限40倍・上限なし）が0点のまま渡る', () => {
      const mixCoefficient = getScoringBands().find((metric) => metric.key === 'mixCoefficient');
      const openEnded = mixCoefficient?.bands.find((band) => band.maxExclusive === null);
      expect(openEnded?.points).toBe(0);
      expect(openEnded?.minInclusive).toBe(40);
    });
  });
});
