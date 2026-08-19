/**
 * サインアップ可否の判定（純関数。副作用なし）。
 *
 * 仕様: `docs/02_design/api/auth-api.md` §POST /api/auth/signup、
 * `docs/adr/0013-multi-user-auth-small-scale.md` §決定2。
 */

import { type Role } from './user';

export type SignupError =
  | { readonly kind: 'signup-disabled' }
  | { readonly kind: 'signup-limit-reached' }
  | { readonly kind: 'email-already-exists' };

export type SignupEligibilityError = Extract<
  SignupError,
  { readonly kind: 'signup-disabled' | 'signup-limit-reached' }
>['kind'];

/**
 * `SIGNUP_ENABLED=false`、または `COUNT(*) >= SIGNUP_MAX_USERS` なら受付停止。
 *
 * **両条件は応答上区別しない**（auth-api.md「両条件を区別しない」）が、
 * 呼び出し側がログ・テストで原因を追えるよう `kind` は分けて返す。
 */
export function evaluateSignupEligibility(params: {
  readonly signupEnabled: boolean;
  readonly existingUserCount: number;
  readonly maxUsers: number;
}): { readonly ok: true } | { readonly ok: false; readonly kind: SignupEligibilityError } {
  if (!params.signupEnabled) return { ok: false, kind: 'signup-disabled' };
  if (params.existingUserCount >= params.maxUsers) {
    return { ok: false, kind: 'signup-limit-reached' };
  }
  return { ok: true };
}

/** 最初の登録者（`COUNT(*) === 0`）だけ `admin`。ADR-0013 §決定2 */
export function roleForNewSignup(existingUserCount: number): Role {
  return existingUserCount === 0 ? 'admin' : 'user';
}
