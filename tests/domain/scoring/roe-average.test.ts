import { describe, expect, it } from 'vitest';

import { calculateRoeAverage } from '@/domain/scoring/roe-average';

/**
 * 指標⑤ ROE の5年平均。
 * 仕様: docs/02_design/logic/roe-scoring.md
 * 受入基準 §6 の4系統（境界値ちょうど / 負の値 / 無配・0 / データ欠損）を全部踏む。
 */

/** 全年同じ ROE の履歴を作る。平均がその値そのものになるので境界を狙いやすい */
function flat(percent: number, years = 5): (number | null)[] {
  return Array.from({ length: years }, () => percent);
}

const scoreOf = (history: (number | null)[]) => calculateRoeAverage({ roeHistory: history }).score;

describe('⑤ ROE 5年平均 — 6.1 境界値ちょうど', () => {
  it.each([
    { percent: 15, points: 10 },
    { percent: 12, points: 9 },
    { percent: 10, points: 8 },
    { percent: 8, points: 7 },
    { percent: 7, points: 6 },
    { percent: 6, points: 5 },
    { percent: 5, points: 4 },
    { percent: 4, points: 3 },
    { percent: 3, points: 2 },
    { percent: 2, points: 1 },
    { percent: 0, points: 0 },
  ])('平均 $percent% ちょうどは $points 点', ({ percent, points }) => {
    expect(scoreOf(flat(percent))).toBe(points);
  });

  it.each([
    { percent: 14.999, points: 9 },
    { percent: 11.999, points: 8 },
    { percent: 1.999, points: 0 },
  ])('$percent% は下の区分（$points 点）に落ちる', ({ percent, points }) => {
    expect(scoreOf(flat(percent))).toBe(points);
  });

  it('平均を取る。単年ではない', () => {
    // 平均 (20+10+10+10+10)/5 = 12 → 9点。直近の 20% に引きずられない
    expect(scoreOf([20, 10, 10, 10, 10])).toBe(9);
  });
});

describe('⑤ ROE 5年平均 — 6.2 負の値', () => {
  it('平均が負なら 0点（§0.3）。判定不能ではない', () => {
    const result = calculateRoeAverage({ roeHistory: flat(-5) });
    expect(result.score).toBe(0);
    expect(result.unavailableReason).toBeNull();
  });

  it('赤字年が混ざっても平均が正なら通常どおり採点する', () => {
    // (30 + 30 + 30 + 30 - 45) / 5 = 15 → 10点
    expect(scoreOf([30, 30, 30, 30, -45])).toBe(10);
  });
});

describe('⑤ ROE 5年平均 — 6.3 無配・0', () => {
  it('ROE 0% は最下段に該当して 0点。判定不能ではない', () => {
    const result = calculateRoeAverage({ roeHistory: flat(0) });
    expect(result.score).toBe(0);
    expect(result.value).toBe(0);
    expect(result.unavailableReason).toBeNull();
  });
});

describe('⑤ ROE 5年平均 — 6.4 データ欠損', () => {
  it('5年に満たなければ判定不能。0 を返さない', () => {
    const result = calculateRoeAverage({ roeHistory: flat(15, 4) });
    expect(result.score).toBeNull();
    expect(result.value).toBeNull();
    expect(result.unavailableReason).toBe('insufficient-history');
  });

  it('5年のうち1つでも null なら判定不能', () => {
    expect(scoreOf([15, 15, null, 15, 15])).toBeNull();
  });

  it('6年目以降の null は結果に影響しない（直近5年しか見ない）', () => {
    expect(scoreOf([15, 15, 15, 15, 15, null, null])).toBe(10);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY])('%s が混ざったら判定不能', (value) => {
    // NaN は < も >= も false なので、素朴に書くと最高点に落ちる
    const result = calculateRoeAverage({ roeHistory: [value, 15, 15, 15, 15] });
    expect(result.score).toBeNull();
  });
});
