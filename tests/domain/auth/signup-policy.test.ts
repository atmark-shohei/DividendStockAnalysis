import { describe, expect, it } from 'vitest';

import { evaluateSignupEligibility, roleForNewSignup } from '@/domain/auth/signup-policy';

/**
 * サインアップ可否（`docs/02_design/api/auth-api.md` §POST /api/auth/signup、
 * `docs/adr/0013-multi-user-auth-small-scale.md` §決定2）。
 */

describe('evaluateSignupEligibility', () => {
  it('SIGNUP_ENABLED=false は signup-disabled', () => {
    const result = evaluateSignupEligibility({
      signupEnabled: false,
      existingUserCount: 0,
      maxUsers: 5,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe('signup-disabled');
  });

  it('COUNT(*) が上限ちょうど（>=maxUsers）は signup-limit-reached', () => {
    const result = evaluateSignupEligibility({
      signupEnabled: true,
      existingUserCount: 5,
      maxUsers: 5,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe('signup-limit-reached');
  });

  it('COUNT(*) が上限を1件超過していても signup-limit-reached', () => {
    const result = evaluateSignupEligibility({
      signupEnabled: true,
      existingUserCount: 6,
      maxUsers: 5,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe('signup-limit-reached');
  });

  it('上限未満・有効なら ok', () => {
    const result = evaluateSignupEligibility({
      signupEnabled: true,
      existingUserCount: 4,
      maxUsers: 5,
    });
    expect(result).toEqual({ ok: true });
  });
});

describe('roleForNewSignup', () => {
  it('COUNT(*)===0（最初の登録者）は admin', () => {
    expect(roleForNewSignup(0)).toBe('admin');
  });

  it.each([1, 2, 100])('COUNT(*)=%i（2人目以降）は user', (existingUserCount) => {
    expect(roleForNewSignup(existingUserCount)).toBe('user');
  });
});
