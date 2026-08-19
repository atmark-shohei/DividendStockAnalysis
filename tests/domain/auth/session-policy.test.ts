import { describe, expect, it } from 'vitest';

import { SESSION_TTL_DAYS, isSessionExpired, sessionExpiresAt } from '@/domain/auth/session-policy';

const NOW = new Date('2026-08-18T00:00:00.000Z');

describe('isSessionExpired', () => {
  const cases: ReadonlyArray<{ name: string; expiresAt: string; expected: boolean }> = [
    { name: 'ちょうど現在時刻: 期限切れ扱い', expiresAt: NOW.toISOString(), expected: true },
    {
      name: '1秒未来: まだ有効',
      expiresAt: new Date(NOW.getTime() + 1_000).toISOString(),
      expected: false,
    },
    {
      name: '1秒過去: 期限切れ',
      expiresAt: new Date(NOW.getTime() - 1_000).toISOString(),
      expected: true,
    },
  ];

  it.each(cases)('$name', ({ expiresAt, expected }) => {
    expect(isSessionExpired(expiresAt, NOW)).toBe(expected);
  });
});

describe('sessionExpiresAt', () => {
  it(`現在時刻から ${String(SESSION_TTL_DAYS)} 日後を返す`, () => {
    const expected = new Date(NOW.getTime() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
    expect(sessionExpiresAt(NOW)).toBe(expected);
  });
});
