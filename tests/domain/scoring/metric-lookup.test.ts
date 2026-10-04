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
import { scoreByBands, scoreByBandsWithIndex } from '@/domain/scoring/metric-lookup';
import { type ScoreBand } from '@/domain/scoring/score-band';

/**
 * T-108: `scoreByBandsWithIndex` の新設と `scoreByBands` のラッパー化。
 * `scoreByBands` は②④⑤⑥⑦⑧⑨ほかの採点経路なので、結果が 1 件も変わらないことを
 * 全デフォルト区分表の格子で確かめる（payout-ratio-scoring.md §10.2 R4）。
 */

const ALL_BANDS: readonly (readonly [string, readonly ScoreBand[]])[] = [
  ['① 増配率', DIVIDEND_GROWTH_RATE_BANDS],
  ['② 連続非減配年数', CONSECUTIVE_YEARS_BANDS],
  ['③ 予想配当性向', PAYOUT_RATIO_BANDS],
  ['④ EPS CAGR', EPS_CAGR_BANDS],
  ['⑤ ROE 5年平均', ROE_AVERAGE_BANDS],
  ['⑥ 配当維持可能年数', DIVIDEND_SUSTAINABILITY_BANDS],
  ['⑦ 売上高 CAGR', REVENUE_CAGR_BANDS],
  ['⑧ 営業利益率 5年平均', OPERATING_MARGIN_BANDS],
  ['⑨ MIX係数', MIX_COEFFICIENT_BANDS],
  ['⑩ 配当利回り', DIVIDEND_YIELD_BANDS],
];

const EPSILON = 1e-6;

function gridValues(bands: readonly ScoreBand[]): readonly number[] {
  const values: number[] = [Number.NaN, -1e9, 1e9];
  for (const band of bands) {
    if (band.minInclusive !== null) values.push(band.minInclusive, band.minInclusive - EPSILON);
    if (band.maxExclusive !== null) values.push(band.maxExclusive, band.maxExclusive - EPSILON);
  }
  return values;
}

describe('scoreByBandsWithIndex — 点数と添字', () => {
  const cases: ReadonlyArray<{ name: string; value: number; score: number; bandIndex: number }> = [
    { name: '③ 0% → 10点・添字0', value: 0, score: 10, bandIndex: 0 },
    { name: '③ 25% ちょうど → 9点・添字1', value: 25, score: 9, bandIndex: 1 },
    { name: '③ 69.99% → 2点・添字8', value: 69.99, score: 2, bandIndex: 8 },
    { name: '③ 70% ちょうど → 0点・最下位区分の添字9', value: 70, score: 0, bandIndex: 9 },
  ];

  it.each(cases)('$name', ({ value, score, bandIndex }) => {
    const result = scoreByBandsWithIndex(PAYOUT_RATIO_BANDS, value);
    expect(result.bandIndex).toBe(bandIndex);
    expect(result.metric).toEqual({ score, value, unavailableReason: null });
  });

  it('表外（負の値）は value-out-of-band・添字 null（最低点に倒さない）', () => {
    const result = scoreByBandsWithIndex(PAYOUT_RATIO_BANDS, -1);
    expect(result.bandIndex).toBeNull();
    expect(result.metric).toEqual({
      score: null,
      value: null,
      unavailableReason: 'value-out-of-band',
    });
  });

  it('NaN は value-out-of-band・添字 null', () => {
    const result = scoreByBandsWithIndex(PAYOUT_RATIO_BANDS, Number.NaN);
    expect(result.bandIndex).toBeNull();
    expect(result.metric.unavailableReason).toBe('value-out-of-band');
  });
});

describe('scoreByBands は scoreByBandsWithIndex の metric と一致する（R4）', () => {
  it.each(ALL_BANDS)('%s の全境界で一致し、添字の点数が score と等しい', (_label, bands) => {
    for (const value of gridValues(bands)) {
      const withIndex = scoreByBandsWithIndex(bands, value);
      expect(scoreByBands(bands, value)).toEqual(withIndex.metric);
      if (withIndex.bandIndex === null) {
        expect(withIndex.metric.score).toBeNull();
      } else {
        expect(bands[withIndex.bandIndex]?.points).toBe(withIndex.metric.score);
      }
    }
  });
});
