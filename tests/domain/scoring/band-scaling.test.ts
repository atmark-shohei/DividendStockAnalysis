import { describe, expect, it } from 'vitest';

import { deriveDefaultBaseline, scaleBands } from '@/domain/scoring/band-scaling';
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
import { type ScoreBand } from '@/domain/scoring/score-band';

/**
 * T-100: 「満点となる基準値」から区分表をスケーリングする（ADR-0012 D-2）。
 *
 * 受入基準として明記されている「基準値=デフォルトのとき bands.ts と完全一致する」を
 * 10指標（⑨含む）で確認したうえで、境界値（0/負/NaN・倍率・③降順・⑩丸め誤差・②4段）を踏む。
 */

// ⑨ MIX係数を除く9指標。デフォルト満点境界は bands.ts 実測表（be-plan.md §2）と一致する。
const ALL_BANDS_EXCEPT_MIX: readonly (readonly [string, readonly ScoreBand[], number])[] = [
  ['① 増配率', DIVIDEND_GROWTH_RATE_BANDS, 30],
  ['② 連続非減配年数', CONSECUTIVE_YEARS_BANDS, 17],
  ['③ 予想配当性向', PAYOUT_RATIO_BANDS, 25],
  ['④ EPS CAGR', EPS_CAGR_BANDS, 20],
  ['⑤ ROE 5年平均', ROE_AVERAGE_BANDS, 15],
  ['⑥ 配当維持可能年数', DIVIDEND_SUSTAINABILITY_BANDS, 30],
  ['⑦ 売上高 CAGR', REVENUE_CAGR_BANDS, 20],
  ['⑧ 営業利益率 5年平均', OPERATING_MARGIN_BANDS, 20],
  ['⑩ 配当利回り', DIVIDEND_YIELD_BANDS, 550],
];

// 10指標全件（⑨も含む）。deriveDefaultBaseline は⑨に対しても正しく導出できることを示す。
const ALL_BANDS_INCLUDING_MIX: readonly (readonly [string, readonly ScoreBand[], number])[] = [
  ...ALL_BANDS_EXCEPT_MIX,
  ['⑨ MIX係数', MIX_COEFFICIENT_BANDS, 10],
];

describe('scaleBands', () => {
  describe('基準値=デフォルトのとき bands.ts の定数と完全一致する', () => {
    it.each(ALL_BANDS_EXCEPT_MIX)('%s', (_label, defaultBands, defaultBaseline) => {
      const result = scaleBands(defaultBands, defaultBaseline);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toEqual(defaultBands);
    });
  });

  describe('境界値: 基準値が正でない', () => {
    it.each([
      ['0', 0],
      ['負（-10）', -10],
      ['NaN', Number.NaN],
    ])('%s は BaselineNotPositive を返す', (_label, baselineValue) => {
      const result = scaleBands(DIVIDEND_GROWTH_RATE_BANDS, baselineValue);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.kind).toBe('BaselineNotPositive');
      expect(result.error).toEqual({ kind: 'BaselineNotPositive', value: baselineValue });
    });
  });

  it('基準値がデフォルトの2倍（⑤ROE: 30）のとき全境界が2倍。null は null のまま', () => {
    const result = scaleBands(ROE_AVERAGE_BANDS, 30);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value).toEqual(
      ROE_AVERAGE_BANDS.map((band) => ({
        minInclusive: band.minInclusive === null ? null : band.minInclusive * 2,
        maxExclusive: band.maxExclusive === null ? null : band.maxExclusive * 2,
        points: band.points,
      })),
    );
    // 最下段の下限 null（負のROEを0点にするガード）が維持されている
    const lowest = result.value.find((band) => band.points === 0);
    expect(lowest?.minInclusive).toBeNull();
  });

  it('基準値がデフォルトの0.5倍（⑤ROE: 7.5）のとき全境界が0.5倍', () => {
    const result = scaleBands(ROE_AVERAGE_BANDS, 7.5);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value).toEqual(
      ROE_AVERAGE_BANDS.map((band) => ({
        minInclusive: band.minInclusive === null ? null : band.minInclusive * 0.5,
        maxExclusive: band.maxExclusive === null ? null : band.maxExclusive * 0.5,
        points: band.points,
      })),
    );
  });

  it('③（降順）で基準値を変更してもスケール後に単調減少が保たれ validateBands を通る', () => {
    const result = scaleBands(PAYOUT_RATIO_BANDS, 50);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // デフォルト満点境界(25%)の2倍 → 全境界が2倍になっているはず
    expect(result.value).toEqual(
      PAYOUT_RATIO_BANDS.map((band) => ({
        minInclusive: band.minInclusive === null ? null : band.minInclusive * 2,
        maxExclusive: band.maxExclusive === null ? null : band.maxExclusive * 2,
        points: band.points,
      })),
    );
  });

  it('⑩（1/100%整数単位）でスケール後に非整数が生じても丸めず、そのまま validateBands を通す', () => {
    // デフォルト満点境界550に対し基準値333 → scale = 333/550（割り切れない）
    const result = scaleBands(DIVIDEND_YIELD_BANDS, 333);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const scale = 333 / 550;
    // 整数への丸めは行わない（非整数がそのまま境界値になる）
    expect(result.value[1]?.minInclusive).toBeCloseTo(525 * scale);
    expect(Number.isInteger(result.value[1]?.minInclusive)).toBe(false);
  });

  it('②（4段のみ）でも境界配列の長さに依存せず正しく比例スケールされる', () => {
    const result = scaleBands(CONSECUTIVE_YEARS_BANDS, 34); // デフォルト17の2倍
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value).toHaveLength(4);
    expect(result.value).toEqual([
      { minInclusive: 34, maxExclusive: null, points: 10 },
      { minInclusive: 20, maxExclusive: 34, points: 5 },
      { minInclusive: 10, maxExclusive: 20, points: 3 },
      { minInclusive: 0, maxExclusive: 10, points: 0 },
    ]);
  });

  it('⑨（MIX係数）を渡しても型的には呼び出し可能で、他指標と同様に動作する（呼び出し禁止の強制はusecase層/T-101の責務）', () => {
    const result = scaleBands(MIX_COEFFICIENT_BANDS, 10);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual(MIX_COEFFICIENT_BANDS);
  });
});

describe('deriveDefaultBaseline', () => {
  describe('10指標全件で bands.ts 実測表の値と一致する', () => {
    it.each(ALL_BANDS_INCLUDING_MIX)('%s: %s', (_label, bands, expectedBaseline) => {
      const result = deriveDefaultBaseline(bands);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toBe(expectedBaseline);
    });
  });

  it('空配列は ThresholdEmpty を返す', () => {
    const result = deriveDefaultBaseline([]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('ThresholdEmpty');
  });

  it('最高得点区分の下限・上限が両方 null（区分表として成立しない）のとき BaselineUndeterminable を返す', () => {
    // 理論上どの既存10指標にも発生しない防御的分岐を実際に発火させる。
    // 「全区間が1区分」で、どちら向きにも開いているため満点境界を導出できない。
    const undeterminableBands: readonly ScoreBand[] = [
      { minInclusive: null, maxExclusive: null, points: 10 },
    ];

    const result = deriveDefaultBaseline(undeterminableBands);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('BaselineUndeterminable');
    expect(result.error).toEqual({ kind: 'BaselineUndeterminable' });
  });
});

describe('scaleBands: deriveDefaultBaseline が BaselineUndeterminable を返す場合', () => {
  it('最高得点区分の下限・上限が両方 null の区分表を渡すと BaselineUndeterminable を返す', () => {
    const undeterminableBands: readonly ScoreBand[] = [
      { minInclusive: null, maxExclusive: null, points: 10 },
    ];

    const result = scaleBands(undeterminableBands, 15);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('BaselineUndeterminable');
  });
});
