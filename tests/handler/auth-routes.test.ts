import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { type PasswordCredential, type PasswordHasher } from '@/domain/auth/password-hasher';
import { type Session } from '@/domain/auth/session';
import { type SessionRepository } from '@/domain/auth/session-repository';
import { type SessionTokenGenerator } from '@/domain/auth/session-token-generator';
import { type User } from '@/domain/auth/user';
import { type UserRepository } from '@/domain/auth/user-repository';
import { type Result, err, ok } from '@/domain/shared/result';
import { registerAuthRoutes, type AuthDependencies } from '@/handler/auth-routes';

/**
 * `/api/auth/*` の結線テスト。D1 を使わない（フェイクを差し替える）ので unit プロジェクトで動く。
 * 仕様: `docs/02_design/api/auth-api.md`。
 */

const FIXED_NOW = () => new Date('2026-08-18T00:00:00.000Z');

const STORED_USER: User = {
  id: 1,
  email: 'user@example.com',
  passwordHash: 'stored-hash',
  passwordSalt: 'stored-salt',
  passwordIterations: 10_000,
  role: 'admin',
  failedLoginCount: 0,
  lockedUntil: null,
  createdAt: '2026-01-01T00:00:00.000Z',
};

const VALID_SESSION: Session = {
  id: 'valid-session-id',
  userId: 1,
  expiresAt: '2099-01-01T00:00:00.000Z',
  createdAt: '2026-01-01T00:00:00.000Z',
};

function fakeUserRepository(options: {
  count?: number;
  findByEmailResult?: User | null;
  insertResult?: Result<User, { readonly kind: 'email-already-exists' }>;
}): UserRepository {
  return {
    findByEmail: () => Promise.resolve(options.findByEmailResult ?? null),
    findById: (id) => Promise.resolve(id === STORED_USER.id ? STORED_USER : null),
    count: () => Promise.resolve(options.count ?? 0),
    insert: () => Promise.resolve(options.insertResult ?? ok({ ...STORED_USER, id: 2 })),
    updateLoginAttempt: () => Promise.resolve(),
    updatePasswordHash: () => Promise.resolve(),
  };
}

function fakeSessionRepository(options: { sessions?: readonly Session[] } = {}): SessionRepository {
  const sessions = options.sessions ?? [];
  return {
    insert: () => Promise.resolve(),
    findById: (id) => Promise.resolve(sessions.find((s) => s.id === id) ?? null),
    deleteById: () => Promise.resolve(),
  };
}

function fakePasswordHasher(verifyResult = true): PasswordHasher {
  return {
    hash: (password: string, iterations: number): Promise<PasswordCredential> =>
      Promise.resolve({ hash: `hash(${password})`, salt: 'salt', iterations }),
    verify: () => Promise.resolve(verifyResult),
  };
}

function fakeSessionTokenGenerator(): SessionTokenGenerator {
  return { generate: () => 'new-session-token' };
}

function buildApp(overrides: Partial<AuthDependencies> = {}) {
  const app = new Hono();
  registerAuthRoutes(app, {
    userRepository: fakeUserRepository({}),
    sessionRepository: fakeSessionRepository({ sessions: [VALID_SESSION] }),
    passwordHasher: fakePasswordHasher(),
    sessionTokenGenerator: fakeSessionTokenGenerator(),
    signupEnabled: true,
    maxUsers: 5,
    cookieSecure: true,
    now: FIXED_NOW,
    ...overrides,
  });
  return app;
}

describe('POST /api/auth/signup', () => {
  const invalidCases: ReadonlyArray<{ name: string; body: unknown }> = [
    { name: 'メール形式が不正', body: { email: 'not-an-email', password: 'password123' } },
    {
      name: 'パスワードが7文字（8文字未満）',
      body: { email: 'a@example.com', password: '1234567' },
    },
    {
      name: 'パスワードが129文字（128文字超過）',
      body: { email: 'a@example.com', password: 'a'.repeat(129) },
    },
  ];

  it.each(invalidCases)('$name は 400', async ({ body }) => {
    const response = await buildApp().request('/api/auth/signup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    expect(response.status).toBe(400);
  });

  const boundaryOkCases: ReadonlyArray<{ name: string; password: string }> = [
    { name: 'パスワードが8文字（下限ちょうど）は zod を通過する', password: '12345678' },
    { name: 'パスワードが128文字（上限ちょうど）は zod を通過する', password: 'a'.repeat(128) },
  ];

  it.each(boundaryOkCases)('$name', async ({ password }) => {
    const response = await buildApp().request('/api/auth/signup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'a@example.com', password }),
    });
    expect(response.status).toBe(201);
  });

  it('成功時は Set-Cookie を返す', async () => {
    const response = await buildApp().request('/api/auth/signup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'a@example.com', password: 'password123' }),
    });
    expect(response.status).toBe(201);
    expect(response.headers.get('set-cookie')).toContain('session_id=new-session-token');
  });

  it('SIGNUP_ENABLED=false は 403。Set-Cookie を返さない', async () => {
    const response = await buildApp({ signupEnabled: false }).request('/api/auth/signup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'a@example.com', password: 'password123' }),
    });
    expect(response.status).toBe(403);
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('email が既に登録済みなら 409', async () => {
    const userRepository = fakeUserRepository({
      insertResult: err({ kind: 'email-already-exists' }),
    });
    const response = await buildApp({ userRepository }).request('/api/auth/signup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'dup@example.com', password: 'password123' }),
    });
    expect(response.status).toBe(409);
  });
});

describe('POST /api/auth/login', () => {
  it('メール形式・パスワード未入力は 400', async () => {
    const response = await buildApp().request('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'not-an-email', password: '' }),
    });
    expect(response.status).toBe(400);
  });

  it('成功時は Set-Cookie を返し、user を返す', async () => {
    const userRepository = fakeUserRepository({ findByEmailResult: STORED_USER });
    const response = await buildApp({ userRepository }).request('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: STORED_USER.email, password: 'correct-password' }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('set-cookie')).toContain('session_id=new-session-token');
    const body = (await response.json()) as { user: { email: string } };
    expect(body.user.email).toBe(STORED_USER.email);
  });

  it('パスワード不一致は 401。Set-Cookie を返さない', async () => {
    const userRepository = fakeUserRepository({ findByEmailResult: STORED_USER });
    const passwordHasher = fakePasswordHasher(false);
    const response = await buildApp({ userRepository, passwordHasher }).request('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: STORED_USER.email, password: 'wrong-password' }),
    });
    expect(response.status).toBe(401);
    expect(response.headers.get('set-cookie')).toBeNull();
  });
});

describe('POST /api/auth/logout', () => {
  it('セッションが有る場合も無い場合も常に204', async () => {
    const withCookie = await buildApp().request('/api/auth/logout', {
      method: 'POST',
      headers: { cookie: `session_id=${VALID_SESSION.id}` },
    });
    expect(withCookie.status).toBe(204);

    const withoutCookie = await buildApp().request('/api/auth/logout', { method: 'POST' });
    expect(withoutCookie.status).toBe(204);
  });
});

describe('GET /api/auth/me', () => {
  it('未ログイン（Cookie無し）は401', async () => {
    const response = await buildApp().request('/api/auth/me');
    expect(response.status).toBe(401);
  });

  it('有効なセッションなら200とuserを返す', async () => {
    const response = await buildApp().request('/api/auth/me', {
      headers: { cookie: `session_id=${VALID_SESSION.id}` },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { user: { id: number } };
    expect(body.user.id).toBe(STORED_USER.id);
  });
});
