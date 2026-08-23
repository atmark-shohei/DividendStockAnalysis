/**
 * `AppDependencies` の認証まわりフィールド向け共有フィクスチャ。
 *
 * `AppDependencies` に `userRepository`/`sessionRepository`/`passwordHasher`/
 * `sessionTokenGenerator`/`signupEnabled`/`maxUsers`/`cookieSecure` を**必須フィールド**として
 * 追加したことに伴い、認証自体を検証対象にしない既存テスト（EDINET/IRバンク/Yahoo取り込み等）
 * が `createApp()` を直接呼ぶたびに埋める必要が生じた。ここに共通化して重複を避ける
 * （T-091計画 §4.6）。
 *
 * `POST/DELETE /api/companies` は `requireRole(['admin'])` で保護されるようになったため、
 * これらのエンドポイントを呼ぶ既存テストは `TEST_ADMIN_SESSION_COOKIE` を
 * リクエストヘッダに付ける必要がある（`tests/integration/api.test.ts` 等）。
 */

import { type PasswordHasher } from '@/domain/auth/password-hasher';
import { type Session } from '@/domain/auth/session';
import { type SessionRepository } from '@/domain/auth/session-repository';
import { type SessionTokenGenerator } from '@/domain/auth/session-token-generator';
import { type User } from '@/domain/auth/user';
import { type UserRepository } from '@/domain/auth/user-repository';
import { type UserIndicatorSettings } from '@/domain/scoring/user-indicator-settings';
import { type UserIndicatorSettingsRepository } from '@/domain/scoring/user-indicator-settings-repository';
import { type Result } from '@/domain/shared/result';

/** このテストで「常にログイン済みの admin」として扱うセッションID・ユーザー */
export const TEST_ADMIN_SESSION_ID = 'test-admin-session-id';
export const TEST_ADMIN_USER: User = {
  id: 1,
  email: 'admin@example.com',
  passwordHash: 'unused',
  passwordSalt: 'unused',
  passwordIterations: 10_000,
  role: 'admin',
  failedLoginCount: 0,
  lockedUntil: null,
  createdAt: '2026-01-01T00:00:00.000Z',
};
/** `requireRole`/`getCurrentUser` が Cookie から読む値。テストのリクエストに付与する */
export const TEST_ADMIN_SESSION_COOKIE = `session_id=${TEST_ADMIN_SESSION_ID}`;

/**
 * このテストで「常にログイン済みの一般ユーザー（user ロール）」として扱う
 * セッションID・ユーザー（T-101。`userOrAdmin` が保護する指標カスタマイズ設定用）。
 */
export const TEST_USER_SESSION_ID = 'test-user-session-id';
export const TEST_USER_USER: User = {
  id: 2,
  email: 'user@example.com',
  passwordHash: 'unused',
  passwordSalt: 'unused',
  passwordIterations: 10_000,
  role: 'user',
  failedLoginCount: 0,
  lockedUntil: null,
  createdAt: '2026-01-01T00:00:00.000Z',
};
export const TEST_USER_SESSION_COOKIE = `session_id=${TEST_USER_SESSION_ID}`;

function unimplemented(name: string): never {
  throw new Error(`このテストで ${name} が呼ばれるのは想定外`);
}

/** `findById(TEST_ADMIN_USER.id)`・`findById(TEST_USER_USER.id)` にだけ応答する。それ以外は「想定外」として落とす */
export function fakeUserRepository(): UserRepository {
  return {
    findByEmail: () => unimplemented('UserRepository.findByEmail'),
    findById: (id: number): Promise<User | null> => {
      if (id === TEST_ADMIN_USER.id) return Promise.resolve(TEST_ADMIN_USER);
      if (id === TEST_USER_USER.id) return Promise.resolve(TEST_USER_USER);
      return Promise.resolve(null);
    },
    count: () => unimplemented('UserRepository.count'),
    insert: (): Promise<Result<User, { readonly kind: 'email-already-exists' }>> =>
      unimplemented('UserRepository.insert'),
    updateLoginAttempt: (): Promise<void> => unimplemented('UserRepository.updateLoginAttempt'),
    updatePasswordHash: (): Promise<void> => unimplemented('UserRepository.updatePasswordHash'),
  };
}

/**
 * `findById(TEST_ADMIN_SESSION_ID)`・`findById(TEST_USER_SESSION_ID)` にだけ、
 * 遠い未来に失効する有効なセッションを返す
 */
export function fakeSessionRepository(): SessionRepository {
  const sessionsById: Readonly<Record<string, Session>> = {
    [TEST_ADMIN_SESSION_ID]: {
      id: TEST_ADMIN_SESSION_ID,
      userId: TEST_ADMIN_USER.id,
      // 「想定外に期限切れにならない」ことが目的の固定未来日
      expiresAt: '2099-01-01T00:00:00.000Z',
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    [TEST_USER_SESSION_ID]: {
      id: TEST_USER_SESSION_ID,
      userId: TEST_USER_USER.id,
      expiresAt: '2099-01-01T00:00:00.000Z',
      createdAt: '2026-01-01T00:00:00.000Z',
    },
  };

  return {
    insert: () => unimplemented('SessionRepository.insert'),
    findById: (id: string): Promise<Session | null> =>
      Promise.resolve(sessionsById[id] ?? null),
    deleteById: () => Promise.resolve(),
  };
}

/**
 * `userIndicatorSettingsRepository` のフェイク（T-101）。
 * `findByUserId`/`replaceAll` の呼び出しをメモリ上で完結させる（DBに触らない）。
 * `TEST_USER_USER.id` 以外で呼ばれたら「想定外」として落とす
 * （このコードベースの `unusedXxx` パターンに揃える）。
 */
export function fakeUserIndicatorSettingsRepository(): UserIndicatorSettingsRepository {
  const store = new Map<number, UserIndicatorSettings>();
  return {
    findByUserId: (userId: number): Promise<UserIndicatorSettings | null> =>
      Promise.resolve(store.get(userId) ?? null),
    replaceAll: (userId: number, settings: UserIndicatorSettings): Promise<void> => {
      store.set(userId, settings);
      return Promise.resolve();
    },
  };
}

export function fakePasswordHasher(): PasswordHasher {
  return {
    hash: () => unimplemented('PasswordHasher.hash'),
    verify: () => unimplemented('PasswordHasher.verify'),
  };
}

export function fakeSessionTokenGenerator(): SessionTokenGenerator {
  return { generate: () => unimplemented('SessionTokenGenerator.generate') };
}

/**
 * `AppDependencies` の認証系フィールド（＋ T-101 の `userIndicatorSettingsRepository`）を
 * まとめて返す。`createApp({ ...buildAuthTestDependencies(), repository: ..., ... })` の形で使う。
 */
export function buildAuthTestDependencies(): {
  readonly userRepository: UserRepository;
  readonly sessionRepository: SessionRepository;
  readonly passwordHasher: PasswordHasher;
  readonly sessionTokenGenerator: SessionTokenGenerator;
  readonly signupEnabled: boolean;
  readonly maxUsers: number;
  readonly cookieSecure: boolean;
  readonly userIndicatorSettingsRepository: UserIndicatorSettingsRepository;
} {
  return {
    userRepository: fakeUserRepository(),
    sessionRepository: fakeSessionRepository(),
    passwordHasher: fakePasswordHasher(),
    sessionTokenGenerator: fakeSessionTokenGenerator(),
    signupEnabled: false,
    maxUsers: 0,
    cookieSecure: true,
    userIndicatorSettingsRepository: fakeUserIndicatorSettingsRepository(),
  };
}
