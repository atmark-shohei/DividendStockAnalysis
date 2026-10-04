import { describe, expect, it } from 'vitest';

import {
  MAX_HOLDINGS_PER_PORTFOLIO,
  MAX_PORTFOLIOS_PER_USER,
  isHoldingLimitReached,
  isPortfolioLimitReached,
} from '@/domain/portfolio/portfolio';

/**
 * 上限判定（T-103。`portfolio-api.md` §共通仕様の403「ポートフォリオ数の上限（10）／
 * 保有銘柄数の上限（100）に到達」）。`signup-policy.ts` の
 * `evaluateSignupEligibility` と同型の「件数を渡して閾値判定する」純関数。
 */
describe('isPortfolioLimitReached', () => {
  const cases: ReadonlyArray<{ name: string; count: number; expected: boolean }> = [
    { name: '0件: 上限未到達', count: 0, expected: false },
    { name: '境界値ちょうど: 9件(10件目の作成は許可)', count: MAX_PORTFOLIOS_PER_USER - 1, expected: false },
    { name: '境界値ちょうど: 10件(11件目の作成は拒否)', count: MAX_PORTFOLIOS_PER_USER, expected: true },
    { name: '上限超過: 11件', count: MAX_PORTFOLIOS_PER_USER + 1, expected: true },
  ];

  it.each(cases)('$name', ({ count, expected }) => {
    expect(isPortfolioLimitReached(count)).toBe(expected);
  });
});

describe('isHoldingLimitReached', () => {
  const cases: ReadonlyArray<{ name: string; count: number; expected: boolean }> = [
    { name: '0件: 上限未到達', count: 0, expected: false },
    { name: '境界値ちょうど: 99件(100件目の追加は許可)', count: MAX_HOLDINGS_PER_PORTFOLIO - 1, expected: false },
    { name: '境界値ちょうど: 100件(101件目の追加は拒否)', count: MAX_HOLDINGS_PER_PORTFOLIO, expected: true },
    { name: '上限超過: 101件', count: MAX_HOLDINGS_PER_PORTFOLIO + 1, expected: true },
  ];

  it.each(cases)('$name', ({ count, expected }) => {
    expect(isHoldingLimitReached(count)).toBe(expected);
  });
});
