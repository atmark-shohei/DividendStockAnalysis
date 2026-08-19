import { describe, expect, it, vi } from 'vitest';

import { PBKDF2_ITERATIONS } from '@/domain/auth/hash-policy';
import { MAX_FAILED_LOGIN_ATTEMPTS, type LoginAttemptOutcome } from '@/domain/auth/login-policy';
import {
  DUMMY_PASSWORD_CREDENTIAL,
  type PasswordCredential,
  type PasswordHasher,
} from '@/domain/auth/password-hasher';
import { type Session } from '@/domain/auth/session';
import { type SessionRepository } from '@/domain/auth/session-repository';
import { type SessionTokenGenerator } from '@/domain/auth/session-token-generator';
import { type User } from '@/domain/auth/user';
import { type UserRepository } from '@/domain/auth/user-repository';
import { login, type LoginDependencies } from '@/usecase/login';

const FIXED_NOW = () => new Date('2026-08-18T00:00:00.000Z');

const BASE_USER: User = {
  id: 1,
  email: 'user@example.com',
  passwordHash: 'stored-hash',
  passwordSalt: 'stored-salt',
  passwordIterations: PBKDF2_ITERATIONS,
  role: 'user',
  failedLoginCount: 0,
  lockedUntil: null,
  createdAt: '2026-01-01T00:00:00.000Z',
};

function fakeUserRepository(user: User | null): UserRepository & {
  updateLoginAttemptCalls: Array<{ userId: number; outcome: LoginAttemptOutcome }>;
  updatePasswordHashCalls: Array<{ userId: number; credential: PasswordCredential }>;
} {
  const updateLoginAttemptCalls: Array<{ userId: number; outcome: LoginAttemptOutcome }> = [];
  const updatePasswordHashCalls: Array<{ userId: number; credential: PasswordCredential }> = [];
  return {
    updateLoginAttemptCalls,
    updatePasswordHashCalls,
    findByEmail: () => Promise.resolve(user),
    findById: () => Promise.resolve(user),
    count: () => Promise.resolve(user === null ? 0 : 1),
    insert: () => {
      throw new Error('このテストで insert が呼ばれるのは想定外');
    },
    updateLoginAttempt: (userId, outcome) => {
      updateLoginAttemptCalls.push({ userId, outcome });
      return Promise.resolve();
    },
    updatePasswordHash: (userId, credential) => {
      updatePasswordHashCalls.push({ userId, credential });
      return Promise.resolve();
    },
  };
}

function fakeSessionRepository(): SessionRepository & { inserted: Session[] } {
  const inserted: Session[] = [];
  return {
    inserted,
    insert: (session) => {
      inserted.push(session);
      return Promise.resolve();
    },
    findById: () => Promise.resolve(null),
    deleteById: () => Promise.resolve(),
  };
}

/** `matches` は「渡された credential が本物（stored-hash）かどうか」を模擬する */
function fakePasswordHasher(matches: boolean): PasswordHasher & {
  verifyCalls: Array<{ password: string; credential: PasswordCredential }>;
} {
  const verifyCalls: Array<{ password: string; credential: PasswordCredential }> = [];
  return {
    verifyCalls,
    hash: (password: string, iterations: number) =>
      Promise.resolve({ hash: `hash(${password})`, salt: 'new-salt', iterations }),
    verify: (password: string, credential: PasswordCredential) => {
      verifyCalls.push({ password, credential });
      return Promise.resolve(matches);
    },
  };
}

function fakeSessionTokenGenerator(): SessionTokenGenerator {
  return { generate: () => 'generated-token' };
}

function buildDeps(overrides: Partial<LoginDependencies> = {}): LoginDependencies {
  return {
    userRepository: fakeUserRepository(BASE_USER),
    sessionRepository: fakeSessionRepository(),
    passwordHasher: fakePasswordHasher(true),
    sessionTokenGenerator: fakeSessionTokenGenerator(),
    ...overrides,
  };
}

describe('login', () => {
  it('成功: カウンタをリセットし、セッションを発行する', async () => {
    const userRepository = fakeUserRepository({ ...BASE_USER, failedLoginCount: 3 });
    const sessionRepository = fakeSessionRepository();
    const result = await login(
      buildDeps({ userRepository, sessionRepository }),
      'user@example.com',
      'correct-password',
      FIXED_NOW,
    );

    expect(result.ok).toBe(true);
    expect(userRepository.updateLoginAttemptCalls).toEqual([
      { userId: 1, outcome: { failedLoginCount: 0, lockedUntil: null } },
    ]);
    expect(sessionRepository.inserted).toHaveLength(1);
  });

  it('now() は1回だけ呼ばれる（CR-5: isAccountLocked/sessionExpiresAt/createdAt を同一時刻にする回帰テスト）', async () => {
    const nowSpy = vi.fn(FIXED_NOW);
    const result = await login(buildDeps({}), 'user@example.com', 'correct-password', nowSpy);

    expect(result.ok).toBe(true);
    expect(nowSpy).toHaveBeenCalledTimes(1);
  });

  it('パスワード不一致: カウンタ+1、invalid-credentials', async () => {
    const userRepository = fakeUserRepository(BASE_USER);
    const passwordHasher = fakePasswordHasher(false);
    const result = await login(
      buildDeps({ userRepository, passwordHasher }),
      'user@example.com',
      'wrong-password',
      FIXED_NOW,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('invalid-credentials');
    expect(userRepository.updateLoginAttemptCalls).toEqual([
      { userId: 1, outcome: { failedLoginCount: 1, lockedUntil: null } },
    ]);
  });

  it(`${String(MAX_FAILED_LOGIN_ATTEMPTS)}回目の失敗でロックが成立する`, async () => {
    const userRepository = fakeUserRepository({
      ...BASE_USER,
      failedLoginCount: MAX_FAILED_LOGIN_ATTEMPTS - 1,
    });
    const passwordHasher = fakePasswordHasher(false);
    await login(
      buildDeps({ userRepository, passwordHasher }),
      'user@example.com',
      'wrong-password',
      FIXED_NOW,
    );

    const outcome = userRepository.updateLoginAttemptCalls[0]?.outcome;
    expect(outcome?.failedLoginCount).toBe(MAX_FAILED_LOGIN_ATTEMPTS);
    expect(outcome?.lockedUntil).not.toBeNull();
  });

  it('ロック中はパスワード検証をスキップして account-locked を返す', async () => {
    const lockedUser: User = {
      ...BASE_USER,
      lockedUntil: new Date(FIXED_NOW().getTime() + 60_000).toISOString(),
    };
    const userRepository = fakeUserRepository(lockedUser);
    const passwordHasher = fakePasswordHasher(true);
    const result = await login(
      buildDeps({ userRepository, passwordHasher }),
      'user@example.com',
      'correct-password',
      FIXED_NOW,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('account-locked');
    // 検証してから拒否すると応答内容から漏れる余地があるため、verify 自体を呼ばない
    expect(passwordHasher.verifyCalls).toHaveLength(0);
    expect(userRepository.updateLoginAttemptCalls).toHaveLength(0);
  });

  it('アカウント不存在時、ダミー資格情報で verify が1回呼ばれる（タイミング攻撃対策）', async () => {
    const userRepository = fakeUserRepository(null);
    const passwordHasher = fakePasswordHasher(true);
    const result = await login(
      buildDeps({ userRepository, passwordHasher }),
      'nobody@example.com',
      'whatever',
      FIXED_NOW,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('invalid-credentials');
    expect(passwordHasher.verifyCalls).toEqual([
      { password: 'whatever', credential: DUMMY_PASSWORD_CREDENTIAL },
    ]);
  });

  it('passwordIterations が古い場合、成功時に再ハッシュが発火する', async () => {
    const staleUser: User = { ...BASE_USER, passwordIterations: PBKDF2_ITERATIONS - 1 };
    const userRepository = fakeUserRepository(staleUser);
    const result = await login(
      buildDeps({ userRepository }),
      'user@example.com',
      'correct-password',
      FIXED_NOW,
    );

    expect(result.ok).toBe(true);
    expect(userRepository.updatePasswordHashCalls).toHaveLength(1);
    expect(userRepository.updatePasswordHashCalls[0]?.credential.iterations).toBe(
      PBKDF2_ITERATIONS,
    );
  });

  it('passwordIterations が最新の場合、再ハッシュは発火しない', async () => {
    const userRepository = fakeUserRepository(BASE_USER);
    const result = await login(
      buildDeps({ userRepository }),
      'user@example.com',
      'correct-password',
      FIXED_NOW,
    );

    expect(result.ok).toBe(true);
    expect(userRepository.updatePasswordHashCalls).toHaveLength(0);
  });
});
