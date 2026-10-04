/**
 * セッション有効期限の算出（純関数。副作用なし）。
 *
 * `docs/02_design/api/auth-api.md` §セッション・`docs/02_design/database/schema.md`
 * §sessions は「実装時に決める」としており、**30日**を実装値として採用する
 * （T-091 計画 §1.6・Manager承認）。
 */

export const SESSION_TTL_DAYS = 30;

/** `expiresAt` が現在時刻以前かどうか。**ちょうど現在時刻は期限切れ扱い**（`<=` 判定） */
export function isSessionExpired(expiresAt: string, now: Date): boolean {
  return new Date(expiresAt).getTime() <= now.getTime();
}

export function sessionExpiresAt(now: Date): string {
  return new Date(now.getTime() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
}
