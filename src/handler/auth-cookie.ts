/**
 * セッション Cookie の読み書き。`hono/cookie`（Hono 4 標準）を使う。
 *
 * `HttpOnly; Secure; SameSite=Lax`（`docs/02_design/api/auth-api.md` §セッション）。
 *
 * `secure` は呼び出し側（`COOKIE_SECURE`。既定 `true`）から注入する。
 * ローカル http 開発（`wrangler dev` 既定）でブラウザ手動確認したい場合のみ、
 * `.dev.vars` に `COOKIE_SECURE=false` を足して無効化できる（`src/index.ts` §cookieSecureOf）。
 * `npm test`（workers 系統）は fetch ベースで Cookie の Secure 属性自体は検証しないため
 * `secure` の値に関わらず通る。
 */

import { type Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';

import { type Session } from '../domain/auth/session';

export const SESSION_COOKIE_NAME = 'session_id';

export function setSessionCookie(
  context: Context,
  session: Session,
  options: { readonly secure: boolean },
): void {
  setCookie(context, SESSION_COOKIE_NAME, session.id, {
    httpOnly: true,
    secure: options.secure,
    sameSite: 'Lax',
    path: '/',
    expires: new Date(session.expiresAt),
  });
}

export function clearSessionCookie(context: Context): void {
  deleteCookie(context, SESSION_COOKIE_NAME, { path: '/' });
}

export function readSessionId(context: Context): string | undefined {
  return getCookie(context, SESSION_COOKIE_NAME);
}
