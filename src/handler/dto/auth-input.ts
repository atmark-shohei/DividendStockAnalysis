/**
 * 認証系 API の入出力 DTO と zod スキーマ。**zod は handler の境界でだけ使う。**
 * 仕様: `docs/02_design/api/auth-api.md`。
 */

import { z } from 'zod';

import { type LoginError } from '../../domain/auth/login-policy';
import { type SignupError } from '../../domain/auth/signup-policy';
import { type Role, type User } from '../../domain/auth/user';

export const signupRequest = z.object({
  email: z.string().trim().email('メールアドレスの形式が不正です'),
  // password の確認欄はサーバーに送らない（auth-api.md。フロントだけで一致を検証する）
  password: z
    .string()
    .min(8, 'パスワードは8文字以上で入力してください')
    .max(128, 'パスワードは128文字以内で入力してください'),
});
export type SignupRequest = z.infer<typeof signupRequest>;

export const loginRequest = z.object({
  email: z.string().trim().email('メールアドレスの形式が不正です'),
  password: z.string().min(1, 'パスワードを入力してください').max(128),
});
export type LoginRequest = z.infer<typeof loginRequest>;

export interface UserView {
  readonly id: number;
  readonly email: string;
  readonly role: Role;
}

export function toUserView(user: User): UserView {
  return { id: user.id, email: user.email, role: user.role };
}

/**
 * `signup-disabled` と `signup-limit-reached` は internal には分けて保持するが、
 * **応答本文・ステータスは両方とも同一**にする（auth-api.md「両条件を区別しない」）。
 */
export function toSignupErrorResponse(error: SignupError): {
  readonly body: { readonly error: string };
  readonly status: 403 | 409;
} {
  switch (error.kind) {
    case 'signup-disabled':
    case 'signup-limit-reached':
      return { body: { error: '現在、新規登録を受け付けていません' }, status: 403 };
    case 'email-already-exists':
      return { body: { error: 'そのメールアドレスは既に登録されています' }, status: 409 };
  }
}

/**
 * メール不存在とパスワード不一致は区別しない（アカウント存在を漏らさない。
 * auth-api.md §POST /api/auth/login）。
 */
export function toLoginErrorResponse(error: LoginError): {
  readonly body: { readonly error: string };
  readonly status: 401 | 429;
} {
  switch (error.kind) {
    case 'invalid-credentials':
      return {
        body: { error: 'メールアドレスまたはパスワードが正しくありません' },
        status: 401,
      };
    case 'account-locked':
      return { body: { error: 'しばらく時間をおいてからお試しください' }, status: 429 };
  }
}

/**
 * 未ログイン応答（401）。`GET /api/auth/me`（`auth-routes.ts`）と `requireRole`
 * ミドルウェア（`require-role.ts`）の両方から呼ぶ共通の文言（CR-7。重複させない）。
 */
export function toUnauthenticatedErrorResponse(): {
  readonly body: { readonly error: string };
  readonly status: 401;
} {
  return { body: { error: 'ログインが必要です' }, status: 401 };
}
