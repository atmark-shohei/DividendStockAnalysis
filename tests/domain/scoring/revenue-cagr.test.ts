import { describe, expect, it } from 'vitest';

import { calculateRevenueCagr } from '@/domain/scoring/revenue-cagr';
import { CAGR_BASE_SEN, atLeastGrowth, justUnderGrowth } from '../../helpers/cagr';
import { sen } from '../../helpers/sen';

/**
 * 指標⑦ 売上高の5年 CAGR。
 * 仕様: docs/02_design/logic/revenue-cagr-scoring.md
 *
 * `historyRestated` は EDINET 取り込み専用の追加入力（`edinet-history-import.md` §4.3）。
 * 既存ケースはすべて `historyRestated: false`（EDINET未実施）を明示する。
 */

const scoreAt = (currentSen: number, baseSen = CAGR_BASE_SEN) =>
  calculateRevenueCagr({
    revenueCurrent: sen(currentSen),
    revenueFiveYearsAgo: sen(baseSen),
    historyRestated: false,
  }).score;

describe('⑦ 売上高 CAGR — 6.1 境界値ちょうど', () => {
  it.each([
    { percent: 20, points: 10 },
    { percent: 16, points: 9 },
    { percent: 14, points: 8 },
    { percent: 12, points: 7 },
    { percent: 10, points: 6 },
    { percent: 8, points: 5 },
    { percent: 6, points: 4 },
    { percent: 4, points: 3 },
    { percent: 2, points: 2 },
  ])('成長率 $percent% ちょうどは $points 点', ({ percent, points }) => {
    const currentSen = atLeastGrowth(percent);
    const result = calculateRevenueCagr({
      revenueCurrent: sen(currentSen),
      revenueFiveYearsAgo: sen(CAGR_BASE_SEN),
      historyRestated: false,
    });
    // ヘルパーが本当に「閾値以上の最小」を作れているかを、結果の算出値で裏取りする
    expect(result.value).toBeGreaterThanOrEqual(percent);
    expect(result.score).toBe(points);
  });

  it.each([
    { percent: 20, points: 9 },
    { percent: 16, points: 8 },
    { percent: 2, points: 1 },
  ])('$percent% を下回ると $points 点に落ちる', ({ percent, points }) => {
    expect(scoreAt(justUnderGrowth(percent))).toBe(points);
  });

  it('0.0% は 0点。1点ではない', () => {
    // 横ばい（現在 == 5年前）は成長していないので 0点。
    // 区分表の最下段 [0%, 2%) → 1点 に取られないよう表を引く前に落としている
    expect(scoreAt(CAGR_BASE_SEN)).toBe(0);
  });

  it('1 銭でも増えていれば 1点', () => {
    expect(scoreAt(CAGR_BASE_SEN + 1)).toBe(1);
  });
});

describe('⑦ 売上高 CAGR — 6.2 負の値', () => {
  it('減収（CAGR が負）は 0点。判定不能ではない', () => {
    const result = calculateRevenueCagr({
      revenueCurrent: sen(CAGR_BASE_SEN / 2),
      revenueFiveYearsAgo: sen(CAGR_BASE_SEN),
      historyRestated: false,
    });
    expect(result.score).toBe(0);
    expect(result.unavailableReason).toBeNull();
    expect(result.value).toBeLessThan(0);
  });

  it('5年前の売上高が負なら判定不能。0点ではない（成長率を定義できない）', () => {
    const result = calculateRevenueCagr({
      revenueCurrent: sen(1_000),
      revenueFiveYearsAgo: sen(-1_000),
      historyRestated: false,
    });
    expect(result.score).toBeNull();
    expect(result.unavailableReason).toBe('undefined-growth');
  });

  it('現在の売上高が負なら判定不能', () => {
    const result = calculateRevenueCagr({
      revenueCurrent: sen(-1_000),
      revenueFiveYearsAgo: sen(1_000),
      historyRestated: false,
    });
    expect(result.score).toBeNull();
    expect(result.unavailableReason).toBe('undefined-growth');
  });
});

describe('⑦ 売上高 CAGR — 6.3 無配・0', () => {
  it('5年前が 0 ならゼロ除算で判定不能。0点ではない', () => {
    const result = calculateRevenueCagr({
      revenueCurrent: sen(1_000),
      revenueFiveYearsAgo: sen(0),
      historyRestated: false,
    });
    expect(result.score).toBeNull();
    expect(result.unavailableReason).toBe('division-by-zero');
  });

  it('現在が 0（売上消滅）は -100% で 0点', () => {
    const result = calculateRevenueCagr({
      revenueCurrent: sen(0),
      revenueFiveYearsAgo: sen(CAGR_BASE_SEN),
      historyRestated: false,
    });
    expect(result.score).toBe(0);
    expect(result.value).toBe(-100);
  });
});

describe('⑦ 売上高 CAGR — 6.4 データ欠損', () => {
  it.each([
    { label: '現在が null', current: null, base: 1_000 },
    { label: '5年前が null', current: 1_000, base: null },
    { label: '両方 null', current: null, base: null },
  ])('$label なら判定不能。0 を返さない', ({ current, base }) => {
    const result = calculateRevenueCagr({
      revenueCurrent: current === null ? null : sen(current),
      revenueFiveYearsAgo: base === null ? null : sen(base),
      historyRestated: false,
    });
    expect(result.score).toBeNull();
    expect(result.value).toBeNull();
    expect(result.unavailableReason).toBe('input-missing');
  });
});

/**
 * EDINET取り込みの遡及修正検出（`docs/02_design/logic/edinet-history-import.md` §4.3・§7.2）。
 */
describe('⑦ 売上高 CAGR — EDINET遡及修正（historyRestated）', () => {
  it('historyRestated: true なら判定不能（restated-history）。0点ではない', () => {
    const result = calculateRevenueCagr({
      revenueCurrent: sen(atLeastGrowth(20)),
      revenueFiveYearsAgo: sen(CAGR_BASE_SEN),
      historyRestated: true,
    });
    expect(result.score).toBeNull();
    expect(result.value).toBeNull();
    expect(result.unavailableReason).toBe('restated-history');
  });

  it('入力が欠損している場合は input-missing が restated-history より先に返る', () => {
    const result = calculateRevenueCagr({
      revenueCurrent: null,
      revenueFiveYearsAgo: sen(CAGR_BASE_SEN),
      historyRestated: true,
    });
    expect(result.unavailableReason).toBe('input-missing');
  });

  it('historyRestated: false なら通常どおり採点する（回帰確認）', () => {
    const result = calculateRevenueCagr({
      revenueCurrent: sen(atLeastGrowth(20)),
      revenueFiveYearsAgo: sen(CAGR_BASE_SEN),
      historyRestated: false,
    });
    expect(result.score).toBe(10);
    expect(result.unavailableReason).toBeNull();
  });
});
