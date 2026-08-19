/**
 * 現在のセッションのユーザーを取得する。
 *
 * `GET /api/auth/me`（`auth-routes.ts`）と `requireRole` ミドルウェア（`require-role.ts`）の
 * 両方から呼ぶ共通ロジック（重複させない）。
 */

import { type SessionRepository } from '../domain/auth/session-repository';
import { isSessionExpired } from '../domain/auth/session-policy';
import { type User } from '../domain/auth/user';
import { type UserRepository } from '../domain/auth/user-repository';
import { type Result, err, ok } from '../domain/shared/result';

export interface GetCurrentUserDependencies {
  readonly userRepository: UserRepository;
  readonly sessionRepository: SessionRepository;
}

export async function getCurrentUser(
  deps: GetCurrentUserDependencies,
  sessionId: string | undefined,
  now: () => Date,
): Promise<Result<User, { readonly kind: 'unauthenticated' }>> {
  if (sessionId === undefined) return err({ kind: 'unauthenticated' });

  const session = await deps.sessionRepository.findById(sessionId);
  if (session === null) return err({ kind: 'unauthenticated' });

  if (isSessionExpired(session.expiresAt, now())) {
    // 遅延削除（auth-api.md §セッションが明示的に許容する方式）
    await deps.sessionRepository.deleteById(session.id);
    return err({ kind: 'unauthenticated' });
  }

  const user = await deps.userRepository.findById(session.userId);
  // 通常は FK cascade で発生しないはずの防御的分岐（孤児セッション）
  if (user === null) return err({ kind: 'unauthenticated' });

  return ok(user);
}
