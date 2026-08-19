/**
 * ログアウト。仕様: `docs/02_design/api/auth-api.md` §POST /api/auth/logout。
 *
 * 常に成功として扱う（**存在しないセッションでもエラーにしない**。
 * 未ログインでの呼び出しも冪等に 204 を返す設計のため）。
 */

import { type SessionRepository } from '../domain/auth/session-repository';

export async function logout(
  sessionRepository: SessionRepository,
  sessionId: string | undefined,
): Promise<void> {
  if (sessionId === undefined) return;
  await sessionRepository.deleteById(sessionId);
}
