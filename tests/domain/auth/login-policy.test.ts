import { describe, expect, it } from 'vitest';

import {
  LOCKOUT_DURATION_MINUTES,
  MAX_FAILED_LOGIN_ATTEMPTS,
  isAccountLocked,
  recordFailedLogin,
  recordSuccessfulLogin,
} from '@/domain/auth/login-policy';

/**
 * ログイン試行のレート制限（`docs/02_design/api/auth-api.md` §レート制限）。
 * ユーザー単位のロック。5回連続失敗で15分ロック。
 */

const NOW = new Date('2026-08-18T00:00:00.000Z');

describe('isAccountLocked', () => {
  const cases: ReadonlyArray<{ name: string; lockedUntil: string | null; expected: boolean }> = [
    { name: 'ロックなし（null）', lockedUntil: null, expected: false },
    {
      name: 'ちょうど現在時刻: ロックなし扱い（過ぎた瞬間に解除）',
      lockedUntil: NOW.toISOString(),
      expected: false,
    },
    {
      name: '1秒未来: ロック中',
      lockedUntil: new Date(NOW.getTime() + 1_000).toISOString(),
      expected: true,
    },
    {
      name: '1秒過去: ロック解除済み',
      lockedUntil: new Date(NOW.getTime() - 1_000).toISOString(),
      expected: false,
    },
  ];

  it.each(cases)('$name', ({ lockedUntil, expected }) => {
    expect(isAccountLocked(lockedUntil, NOW)).toBe(expected);
  });
});

describe('recordFailedLogin', () => {
  it.each([0, 1, 2, 3])('直前の失敗回数%iからの失敗（結果5回未満）はロックしない', (currentFailedCount) => {
    const outcome = recordFailedLogin(currentFailedCount, NOW);
    expect(outcome.failedLoginCount).toBe(currentFailedCount + 1);
    expect(outcome.lockedUntil).toBeNull();
  });

  it(`${String(MAX_FAILED_LOGIN_ATTEMPTS)}回目ちょうどでロックが成立する（今+${String(LOCKOUT_DURATION_MINUTES)}分）`, () => {
    const outcome = recordFailedLogin(MAX_FAILED_LOGIN_ATTEMPTS - 1, NOW);
    expect(outcome.failedLoginCount).toBe(MAX_FAILED_LOGIN_ATTEMPTS);
    expect(outcome.lockedUntil).toBe(
      new Date(NOW.getTime() + LOCKOUT_DURATION_MINUTES * 60_000).toISOString(),
    );
  });

  it('ロック後も失敗が続くとカウントが伸び、ロックが改めて延長される', () => {
    const outcome = recordFailedLogin(MAX_FAILED_LOGIN_ATTEMPTS, NOW);
    expect(outcome.failedLoginCount).toBe(MAX_FAILED_LOGIN_ATTEMPTS + 1);
    expect(outcome.lockedUntil).toBe(
      new Date(NOW.getTime() + LOCKOUT_DURATION_MINUTES * 60_000).toISOString(),
    );
  });
});

describe('recordSuccessfulLogin', () => {
  it('失敗回数・ロックの両方をリセットする', () => {
    expect(recordSuccessfulLogin()).toEqual({ failedLoginCount: 0, lockedUntil: null });
  });
});
