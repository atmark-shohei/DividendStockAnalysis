import { describe, expect, it, vi } from 'vitest';

import { PBKDF2_ITERATIONS } from '@/domain/auth/hash-policy';
import { type PasswordCredential, type PasswordHasher } from '@/domain/auth/password-hasher';
import { type Session } from '@/domain/auth/session';
import { type SessionRepository } from '@/domain/auth/session-repository';
import { type SessionTokenGenerator } from '@/domain/auth/session-token-generator';
import { type NewUser, type User } from '@/domain/auth/user';
import { type UserRepository } from '@/domain/auth/user-repository';
import { type Result, err, ok } from '@/domain/shared/result';
import { signup, type SignupDependencies } from '@/usecase/signup';

const FIXED_NOW = () => new Date('2026-08-18T00:00:00.000Z');

function fakeUserRepository(options: {
  count?: number;
  insertResult?: (user: NewUser) => Result<User, { readonly kind: 'email-already-exists' }>;
}): UserRepository & { insertedUsers: NewUser[] } {
  const insertedUsers: NewUser[] = [];
  return {
    insertedUsers,
    findByEmail: () => Promise.resolve(null),
    findById: () => Promise.resolve(null),
    count: () => Promise.resolve(options.count ?? 0),
    insert: (user: NewUser) => {
      insertedUsers.push(user);
      const result =
        options.insertResult?.(user) ??
        ok({ ...user, id: 1, failedLoginCount: 0, lockedUntil: null });
      return Promise.resolve(result);
    },
    updateLoginAttempt: () => Promise.resolve(),
    updatePasswordHash: () => Promise.resolve(),
  };
}

function fakeSessionRepository(): SessionRepository & { inserted: Session[] } {
  const inserted: Session[] = [];
  return {
    inserted,
    insert: (session: Session) => {
      inserted.push(session);
      return Promise.resolve();
    },
    findById: () => Promise.resolve(null),
    deleteById: () => Promise.resolve(),
  };
}

function fakePasswordHasher(): PasswordHasher & {
  hashCalls: Array<{ password: string; iterations: number }>;
} {
  const hashCalls: Array<{ password: string; iterations: number }> = [];
  return {
    hashCalls,
    hash: (password: string, iterations: number): Promise<PasswordCredential> => {
      hashCalls.push({ password, iterations });
      return Promise.resolve({ hash: `hash(${password})`, salt: 'salt', iterations });
    },
    verify: () => Promise.resolve(true),
  };
}

function fakeSessionTokenGenerator(): SessionTokenGenerator {
  return { generate: () => 'generated-token' };
}

function buildDeps(overrides: Partial<SignupDependencies> = {}): SignupDependencies {
  return {
    userRepository: fakeUserRepository({}),
    sessionRepository: fakeSessionRepository(),
    passwordHasher: fakePasswordHasher(),
    sessionTokenGenerator: fakeSessionTokenGenerator(),
    signupEnabled: true,
    maxUsers: 5,
    ...overrides,
  };
}

describe('signup', () => {
  it('最初の登録者（COUNT=0）は admin になる', async () => {
    const userRepository = fakeUserRepository({ count: 0 });
    const result = await signup(
      buildDeps({ userRepository }),
      'admin@example.com',
      'password123',
      FIXED_NOW,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.user.role).toBe('admin');
  });

  it('2人目以降（COUNT>=1）は user になる', async () => {
    const userRepository = fakeUserRepository({ count: 1 });
    const result = await signup(
      buildDeps({ userRepository }),
      'user@example.com',
      'password123',
      FIXED_NOW,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.user.role).toBe('user');
  });

  it('signupEnabled=false は signup-disabled', async () => {
    const result = await signup(
      buildDeps({ signupEnabled: false }),
      'user@example.com',
      'password123',
      FIXED_NOW,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('signup-disabled');
  });

  it('COUNT(*) が上限ちょうどは signup-limit-reached', async () => {
    const userRepository = fakeUserRepository({ count: 5 });
    const result = await signup(
      buildDeps({ userRepository, maxUsers: 5 }),
      'user@example.com',
      'password123',
      FIXED_NOW,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('signup-limit-reached');
  });

  it('email が既に登録済みなら email-already-exists', async () => {
    const userRepository = fakeUserRepository({
      count: 1,
      insertResult: () => err({ kind: 'email-already-exists' }),
    });
    const result = await signup(
      buildDeps({ userRepository }),
      'dup@example.com',
      'password123',
      FIXED_NOW,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('email-already-exists');
  });

  it(`パスワードは PBKDF2_ITERATIONS（${String(PBKDF2_ITERATIONS)}）でハッシュされる`, async () => {
    const passwordHasher = fakePasswordHasher();
    await signup(buildDeps({ passwordHasher }), 'user@example.com', 'password123', FIXED_NOW);

    expect(passwordHasher.hashCalls).toEqual([
      { password: 'password123', iterations: PBKDF2_ITERATIONS },
    ]);
  });

  it('成功時にセッションを発行する', async () => {
    const sessionRepository = fakeSessionRepository();
    const result = await signup(
      buildDeps({ sessionRepository }),
      'user@example.com',
      'password123',
      FIXED_NOW,
    );

    expect(result.ok).toBe(true);
    expect(sessionRepository.inserted).toHaveLength(1);
    if (!result.ok) return;
    expect(result.value.session.id).toBe('generated-token');
  });

  it('now() は1回だけ呼ばれる（CR-5: user.createdAt と session.createdAt/expiresAt を同一時刻にする回帰テスト）', async () => {
    const nowSpy = vi.fn(FIXED_NOW);
    const result = await signup(buildDeps({}), 'user@example.com', 'password123', nowSpy);

    expect(result.ok).toBe(true);
    expect(nowSpy).toHaveBeenCalledTimes(1);
  });
});
