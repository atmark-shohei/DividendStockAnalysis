import { describe, expect, it } from 'vitest';

import { DIVIDEND_YIELD_BANDS } from '@/lib/scoring/dividend-yield';
import { assertContiguous, lookupPoints, type ScoreBand } from '@/lib/scoring/score-table';

/**
 * 全指標が共有する区分表のルックアップ。
 * 区分の解釈: scoring-requirements.md §0.1「下限以上・上限未満」
 *
 * T-014 の決定により、区分表は定数として1箇所に切り出し差し替え可能にしてある。
 */

// 実物より小さい表で規約そのものを検証する
const BANDS: readonly ScoreBand[] = [
  { minInclusive: 30, maxExclusive: null, points: 10 },
  { minInclusive: 20, maxExclusive: 30, points: 9 },
  { minInclusive: 0, maxExclusive: 20, points: 1 },
];

/** 判定値 v を閾値と比べる素直な比較関数 */
const by = (v: number) => (threshold: number) => v - threshold;

describe('区分表のルックアップ', () => {
  it('下限ちょうどはその区分に属する', () => {
    expect(lookupPoints(BANDS, by(30))).toBe(10);
    expect(lookupPoints(BANDS, by(20))).toBe(9);
    expect(lookupPoints(BANDS, by(0))).toBe(1);
  });

  it('上限ちょうどは上の区分に属する（上限未満）', () => {
    expect(lookupPoints(BANDS, by(19.999))).toBe(1);
    expect(lookupPoints(BANDS, by(29.999))).toBe(9);
  });

  it('最上位区分に上限はない', () => {
    expect(lookupPoints(BANDS, by(1_000_000))).toBe(10);
  });

  it('どの区分にも該当しなければ null。0 を返さない', () => {
    // 表の外＝「計算できたが区分が無い」であり、最低点とは違う
    expect(lookupPoints(BANDS, by(-1))).toBeNull();
  });

  it('比較関数が NaN を返したら null。先頭区分（最高点）に落ちない', () => {
    // 「該当しなければ次へ」と否定形で書くと、NaN は < 0 も >= 0 も false なので
    // すべてのガードを素通りして先頭の区分＝10 点を返してしまう。
    // 壊れたデータが満点を取るのが最悪の壊れ方なので、肯定形で書いて null に倒す。
    expect(lookupPoints(BANDS, () => Number.NaN)).toBeNull();
  });
});

describe('区分表の健全性チェック', () => {
  it('穴も重複もない表は通る', () => {
    expect(() => assertContiguous(BANDS)).not.toThrow();
  });

  it('⑩ 配当利回りの区分表に穴も重複もない', () => {
    // 原典のスコア表には実際に穴があった（§0.2 の ① の 1〜2%）。
    // 各指標の定数はこのチェックに通すこと。
    expect(() => assertContiguous(DIVIDEND_YIELD_BANDS)).not.toThrow();
  });

  it('穴がある表は落ちる', () => {
    const holed: readonly ScoreBand[] = [
      { minInclusive: 30, maxExclusive: null, points: 10 },
      { minInclusive: 20, maxExclusive: 29, points: 9 }, // 29〜30 が抜けている
      { minInclusive: 0, maxExclusive: 20, points: 1 },
    ];
    expect(() => assertContiguous(holed)).toThrow(/29/);
  });

  it('重複がある表は落ちる', () => {
    const overlapped: readonly ScoreBand[] = [
      { minInclusive: 30, maxExclusive: null, points: 10 },
      { minInclusive: 20, maxExclusive: 35, points: 9 },
      { minInclusive: 0, maxExclusive: 20, points: 1 },
    ];
    expect(() => assertContiguous(overlapped)).toThrow();
  });

  it('最上位に上限があると落ちる（上が開いていない）', () => {
    const capped: readonly ScoreBand[] = [
      { minInclusive: 30, maxExclusive: 40, points: 10 },
      { minInclusive: 0, maxExclusive: 30, points: 1 },
    ];
    expect(() => assertContiguous(capped)).toThrow();
  });

  it('空の表は落ちる', () => {
    expect(() => assertContiguous([])).toThrow();
  });
});
