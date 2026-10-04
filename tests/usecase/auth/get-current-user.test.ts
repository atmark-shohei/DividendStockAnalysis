import { describe, expect, it } from 'vitest';

import { type Session } from '@/domain/auth/session';
import { type SessionRepository } from '@/domain/auth/session-repository';
import { type User } from '@/domain/auth/user';
import { type UserRepository } from '@/domain/auth/user-repository';
import { getCurrentUser, type GetCurrentUserDependencies } from '@/usecase/get-current-user';

const FIXED_NOW = () => new Date('2026-08-18T00:00:00.000Z');

const USER: User = {
  id: 1,
  email: 'user@example.com',
  passwordHash: 'hash',
  passwordSalt: 'salt',
  passwordIterations: 10_000,
  role: 'admin',
  failedLoginCount: 0,
  lockedUntil: null,
  createdAt: '2026-01-01T00:00:00.000Z',
};

const VALID_SESSION: Session = {
  id: 'valid-session',
  userId: 1,
  expiresAt: new Date(FIXED_NOW().getTime() + 60_000).toISOString(),
  createdAt: '2026-08-01T00:00:00.000Z',
};

const EXPIRED_SESSION: Session = {
  id: 'expired-session',
  userId: 1,
  expiresAt: new Date(FIXED_NOW().getTime() - 60_000).toISOString(),
  createdAt: '2026-01-01T00:00:00.000Z',
};

function buildDeps(options: {
  sessions?: readonly Session[];
  users?: readonly User[];
}): GetCurrentUserDependencies & { deleteByIdCalls: string[] } {
  const sessions = options.sessions ?? [];
  const users = options.users ?? [];
  const deleteByIdCalls: string[] = [];

  const sessionRepository: SessionRepository = {
    insert: () => Promise.resolve(),
    findById: (id) => Promise.resolve(sessions.find((s) => s.id === id) ?? null),
    deleteById: (id) => {
      deleteByIdCalls.push(id);
      return Promise.resolve();
    },
  };
  const userRepository: UserRepository = {
    findByEmail: () => Promise.resolve(null),
    findById: (id) => Promise.resolve(users.find((u) => u.id === id) ?? null),
    count: () => Promise.resolve(users.length),
    insert: () => {
      throw new Error('このテストで insert が呼ばれるのは想定外');
    },
    updateLoginAttempt: () => Promise.resolve(),
    updatePasswordHash: () => Promise.resolve(),
  };

  return { sessionRepository, userRepository, deleteByIdCalls };
}

describe('getCurrentUser', () => {
  it('正常セッション: ユーザーを返す', async () => {
    const deps = buildDeps({ sessions: [VALID_SESSION], users: [USER] });
    const result = await getCurrentUser(deps, VALID_SESSION.id, FIXED_NOW);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual(USER);
  });

  it('Cookie無し（sessionId undefined）: unauthenticated', async () => {
    const deps = buildDeps({});
    const result = await getCurrentUser(deps, undefined, FIXED_NOW);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('unauthenticated');
  });

  it('セッション無し（未知のID）: unauthenticated', async () => {
    const deps = buildDeps({});
    const result = await getCurrentUser(deps, 'no-such-session', FIXED_NOW);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('unauthenticated');
  });

  it('期限切れセッション: unauthenticated を返し、deleteById が呼ばれる（遅延削除）', async () => {
    const deps = buildDeps({ sessions: [EXPIRED_SESSION], users: [USER] });
    const result = await getCurrentUser(deps, EXPIRED_SESSION.id, FIXED_NOW);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('unauthenticated');
    expect(deps.deleteByIdCalls).toEqual([EXPIRED_SESSION.id]);
  });

  it('孤児セッション（セッションはあるがユーザーが居ない）: unauthenticated（防御的分岐）', async () => {
    const deps = buildDeps({ sessions: [VALID_SESSION], users: [] });
    const result = await getCurrentUser(deps, VALID_SESSION.id, FIXED_NOW);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('unauthenticated');
  });
});
