/**
 * ログイン試行のレート制限（純関数。副作用なし）。
 *
 * 仕様: `docs/02_design/api/auth-api.md` §レート制限。
 * **ユーザー（メールアドレス）単位でロックする。IP単位ではない。**
 */

export const MAX_FAILED_LOGIN_ATTEMPTS = 5;
export const LOCKOUT_DURATION_MINUTES = 15;

export type LoginError =
  /** メール不存在・パスワード不一致のいずれも区別しない（アカウント存在を漏らさない） */
  | { readonly kind: 'invalid-credentials' }
  | { readonly kind: 'account-locked' };

/** `lockedUntil` が現在時刻より未来かどうか。**ちょうど現在時刻はロックなし扱い**（`>` 判定） */
export function isAccountLocked(lockedUntil: string | null, now: Date): boolean {
  return lockedUntil !== null && new Date(lockedUntil).getTime() > now.getTime();
}

export interface LoginAttemptOutcome {
  readonly failedLoginCount: number;
  readonly lockedUntil: string | null;
}

/**
 * 失敗を1回記録する。**5回連続で `lockedUntil` を「今+15分」にする。**
 *
 * ロック中に再度失敗した場合（ロック期限切れ後の再失敗を含む）も同じ経路を通り、
 * カウントを増やし続けて改めてロックを延長する（`docs/02_design/api/auth-api.md`
 * の文言をそのまま実装した結果。成功時のみカウンタをリセットする。§7 未決点）。
 */
export function recordFailedLogin(currentFailedCount: number, now: Date): LoginAttemptOutcome {
  const failedLoginCount = currentFailedCount + 1;
  const lockedUntil =
    failedLoginCount >= MAX_FAILED_LOGIN_ATTEMPTS
      ? new Date(now.getTime() + LOCKOUT_DURATION_MINUTES * 60_000).toISOString()
      : null;
  return { failedLoginCount, lockedUntil };
}

/** ログイン成功時は失敗回数・ロックを両方リセットする */
export function recordSuccessfulLogin(): LoginAttemptOutcome {
  return { failedLoginCount: 0, lockedUntil: null };
}
