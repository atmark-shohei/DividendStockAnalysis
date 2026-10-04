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
  type ScoreBand,
  lookupBandIndex,
  lookupPoints,
  lookupPointsByValue,
} from '@/domain/scoring/score-band';

/**
 * T-108: `lookupBandIndex` の新設と `lookupPoints` のラッパー化。
 *
 * `lookupPoints` は①〜⑩すべての採点が通る経路なので、組み替えで挙動が 1 件でも
 * 変わると③以外の指標の点数が黙って変わる（payout-ratio-scoring.md §10.2 R4）。
 * 全デフォルト区分表 × 各区分の境界の格子で、添字から引いた点数と
 * `lookupPoints` の結果が一致することを確かめる。
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

/** 各区分の下限ちょうど・下限の直前・上限ちょうど・上限の直前、表の遠い外側、NaN */
function gridValues(bands: readonly ScoreBand[]): readonly number[] {
  const values: number[] = [Number.NaN, -1e9, 1e9];
  for (const band of bands) {
    if (band.minInclusive !== null) values.push(band.minInclusive, band.minInclusive - EPSILON);
    if (band.maxExclusive !== null) values.push(band.maxExclusive, band.maxExclusive - EPSILON);
  }
  return values;
}

const byValue = (value: number) => (threshold: number) => value - threshold;

/** 下限なしの最下段と穴を持つ表（ルックアップの端を踏むためのテスト専用） */
const WITH_OPEN_BOTTOM_AND_GAP: readonly ScoreBand[] = [
  { minInclusive: 20, maxExclusive: null, points: 10 },
  { minInclusive: 10, maxExclusive: 15, points: 5 },
  { minInclusive: null, maxExclusive: 0, points: 1 },
];

describe('lookupBandIndex — 該当区分の添字', () => {
  const cases: ReadonlyArray<{
    name: string;
    bands: readonly ScoreBand[];
    value: number;
    expected: number | null;
  }> = [
    {
      name: '③ 下限ちょうど 0% は先頭区分（添字0）',
      bands: PAYOUT_RATIO_BANDS,
      value: 0,
      expected: 0,
    },
    { name: '③ 上限の直前 24.99% は添字0', bands: PAYOUT_RATIO_BANDS, value: 24.99, expected: 0 },
    {
      name: '③ 上限ちょうど 25% は次区分（添字1）',
      bands: PAYOUT_RATIO_BANDS,
      value: 25,
      expected: 1,
    },
    { name: '③ 60% は 60〜70% の区分（添字8）', bands: PAYOUT_RATIO_BANDS, value: 60, expected: 8 },
    { name: '③ 69.99% は添字8', bands: PAYOUT_RATIO_BANDS, value: 69.99, expected: 8 },
    {
      name: '③ 70% は上が開いた最下位区分（添字9）',
      bands: PAYOUT_RATIO_BANDS,
      value: 70,
      expected: 9,
    },
    { name: '③ 負の値は表外で null', bands: PAYOUT_RATIO_BANDS, value: -0.01, expected: null },
    { name: '最上位（上限 null）', bands: WITH_OPEN_BOTTOM_AND_GAP, value: 1e9, expected: 0 },
    { name: '最下段（下限 null）', bands: WITH_OPEN_BOTTOM_AND_GAP, value: -1e9, expected: 2 },
    {
      name: '穴（15〜20）に落ちた値は null',
      bands: WITH_OPEN_BOTTOM_AND_GAP,
      value: 17,
      expected: null,
    },
    {
      name: '穴（0〜10）に落ちた値は null',
      bands: WITH_OPEN_BOTTOM_AND_GAP,
      value: 0,
      expected: null,
    },
    {
      name: 'NaN は先頭区分に落ちず null',
      bands: PAYOUT_RATIO_BANDS,
      value: Number.NaN,
      expected: null,
    },
    { name: '空の表は null', bands: [], value: 10, expected: null },
  ];

  it.each(cases)('$name', ({ bands, value, expected }) => {
    expect(lookupBandIndex(bands, byValue(value))).toBe(expected);
  });

  it('compare が常に NaN を返しても null（肯定形判定）', () => {
    expect(lookupBandIndex(PAYOUT_RATIO_BANDS, () => Number.NaN)).toBeNull();
  });
});

describe('lookupPoints は lookupBandIndex の点数と一致する（R4: ③以外の指標を変えない）', () => {
  it.each(ALL_BANDS)('%s の全境界で一致する', (_label, bands) => {
    for (const value of gridValues(bands)) {
      const index = lookupBandIndex(bands, byValue(value));
      const expected = index === null ? null : (bands[index]?.points ?? null);
      expect(lookupPoints(bands, byValue(value))).toBe(expected);
      expect(lookupPointsByValue(bands, value)).toBe(expected);
    }
  });

  it.each(ALL_BANDS)('%s の NaN は null', (_label, bands) => {
    expect(lookupPoints(bands, byValue(Number.NaN))).toBeNull();
  });
});
