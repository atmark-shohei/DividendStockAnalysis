/**
 * 認証を必須にしないエンドポイント向けの、ユーザー解決ヘルパー（T-101）。
 *
 * `requireRole`（`require-role.ts`）は未認証・権限不足を 401/403 で弾くガードだが、
 * `GET /api/companies/:code` は**無認証でも閲覧できる既存仕様を変えない**
 * （BE計画 §5）。Cookie にセッションがあればユーザーを解決し、無ければ
 * `null`（ゲスト）を返すだけの、失敗を握りつぶす専用の関数として分離する。
 */

import { type Context } from 'hono';

import { type User } from '../domain/auth/user';
import { getCurrentUser, type GetCurrentUserDependencies } from '../usecase/get-current-user';
import { readSessionId } from './auth-cookie';

/**
 * Cookie のセッションが有効ならそのユーザーを、無効・未ログイン・期限切れなら
 * `null` を返す。**401 を返さない**（呼び出し元はゲストとして処理を続ける）。
 */
export async function resolveOptionalUser(
  deps: GetCurrentUserDependencies & { readonly now: () => Date },
  context: Context,
): Promise<User | null> {
  const sessionId = readSessionId(context);
  const result = await getCurrentUser(deps, sessionId, deps.now);
  return result.ok ? result.value : null;
}
