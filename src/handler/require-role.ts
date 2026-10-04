/**
 * ロールガードのミドルウェア。`GET /api/auth/me` と同じ `getCurrentUser()` を使い、
 * ロジックを重複させない。
 *
 * **既存の `X-Admin-Token` ミドルウェア（`app.ts` の `/api/admin/edinet/...`）とは
 * 完全に別物として並存させる**（`docs/adr/0013-multi-user-auth-small-scale.md` §決定5）。
 * `X-Admin-Token` 側のコードはここでは一切変更しない。
 */

import { type MiddlewareHandler } from 'hono';

import { type Role } from '../domain/auth/user';
import { getCurrentUser, type GetCurrentUserDependencies } from '../usecase/get-current-user';
import { readSessionId } from './auth-cookie';
import { toUnauthenticatedErrorResponse } from './dto/auth-input';

export function requireRole(
  deps: GetCurrentUserDependencies & { readonly now: () => Date },
  allowedRoles: readonly Role[],
): MiddlewareHandler {
  return async (context, next) => {
    const sessionId = readSessionId(context);
    const result = await getCurrentUser(deps, sessionId, deps.now);

    if (!result.ok) {
      const { body, status } = toUnauthenticatedErrorResponse();
      return context.json(body, status);
    }
    if (!allowedRoles.includes(result.value.role)) {
      return context.json({ error: 'この操作を行う権限がありません' }, 403);
    }

    await next();
  };
}
