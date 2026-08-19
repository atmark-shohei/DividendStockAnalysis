import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { type Session } from '@/domain/auth/session';
import { type SessionRepository } from '@/domain/auth/session-repository';
import { type User } from '@/domain/auth/user';
import { type UserRepository } from '@/domain/auth/user-repository';
import { requireRole } from '@/handler/require-role';

const FIXED_NOW = () => new Date('2026-08-18T00:00:00.000Z');

const ADMIN_USER: User = {
  id: 1,
  email: 'admin@example.com',
  passwordHash: 'hash',
  passwordSalt: 'salt',
  passwordIterations: 10_000,
  role: 'admin',
  failedLoginCount: 0,
  lockedUntil: null,
  createdAt: '2026-01-01T00:00:00.000Z',
};

const MEMBER_USER: User = { ...ADMIN_USER, id: 2, email: 'user@example.com', role: 'user' };

const VALID_ADMIN_SESSION: Session = {
  id: 'admin-session',
  userId: ADMIN_USER.id,
  expiresAt: '2099-01-01T00:00:00.000Z',
  createdAt: '2026-01-01T00:00:00.000Z',
};

const EXPIRED_SESSION: Session = {
  id: 'expired-session',
  userId: ADMIN_USER.id,
  expiresAt: '2020-01-01T00:00:00.000Z',
  createdAt: '2019-01-01T00:00:00.000Z',
};

const MEMBER_SESSION: Session = {
  id: 'member-session',
  userId: MEMBER_USER.id,
  expiresAt: '2099-01-01T00:00:00.000Z',
  createdAt: '2026-01-01T00:00:00.000Z',
};

function buildApp() {
  const sessions: readonly Session[] = [VALID_ADMIN_SESSION, EXPIRED_SESSION, MEMBER_SESSION];
  const users: readonly User[] = [ADMIN_USER, MEMBER_USER];

  const sessionRepository: SessionRepository = {
    insert: () => Promise.resolve(),
    findById: (id) => Promise.resolve(sessions.find((s) => s.id === id) ?? null),
    deleteById: () => Promise.resolve(),
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

  const app = new Hono();
  app.get(
    '/protected',
    requireRole({ userRepository, sessionRepository, now: FIXED_NOW }, ['admin']),
    (context) => context.json({ ok: true }),
  );
  return app;
}

describe('requireRole', () => {
  it('Cookie無し（未ログイン）は401', async () => {
    const response = await buildApp().request('/protected');
    expect(response.status).toBe(401);
  });

  it('期限切れセッションは401', async () => {
    const response = await buildApp().request('/protected', {
      headers: { cookie: `session_id=${EXPIRED_SESSION.id}` },
    });
    expect(response.status).toBe(401);
  });

  it('role不一致（allowedRolesに含まれない）は403', async () => {
    const response = await buildApp().request('/protected', {
      headers: { cookie: `session_id=${MEMBER_SESSION.id}` },
    });
    expect(response.status).toBe(403);
  });

  it('admin（allowedRolesに含まれる）は通過する', async () => {
    const response = await buildApp().request('/protected', {
      headers: { cookie: `session_id=${VALID_ADMIN_SESSION.id}` },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });
});
