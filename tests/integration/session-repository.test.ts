import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

import { type Session } from '@/domain/auth/session';
import { type NewUser } from '@/domain/auth/user';
import { D1SessionRepository } from '@/infra/d1/session-repository';
import { D1UserRepository } from '@/infra/d1/user-repository';

/**
 * `D1SessionRepository` — insert/findById/deleteById、`users` 行削除時の `ON DELETE CASCADE`。
 * 仕様: `docs/02_design/database/schema.md` §sessions
 */

beforeEach(async () => {
  await env.DB.exec('DELETE FROM sessions');
  await env.DB.exec('DELETE FROM users');
});

function newUser(overrides: Partial<NewUser> = {}): NewUser {
  return {
    email: 'user@example.com',
    passwordHash: 'hash-value',
    passwordSalt: 'salt-value',
    passwordIterations: 10_000,
    role: 'admin',
    createdAt: '2026-08-18T00:00:00.000Z',
    ...overrides,
  };
}

async function insertUser(overrides: Partial<NewUser> = {}) {
  const userRepository = new D1UserRepository(env.DB);
  const inserted = await userRepository.insert(newUser(overrides));
  if (!inserted.ok) throw new Error('setup failed: user insert');
  return inserted.value;
}

function session(userId: number, overrides: Partial<Session> = {}): Session {
  return {
    id: 'session-id-1',
    userId,
    expiresAt: '2026-09-17T00:00:00.000Z',
    createdAt: '2026-08-18T00:00:00.000Z',
    ...overrides,
  };
}

describe('insert / findById / deleteById', () => {
  it('insert した内容を findById で読み戻せる', async () => {
    const user = await insertUser();
    const repository = new D1SessionRepository(env.DB);
    await repository.insert(session(user.id));

    const found = await repository.findById('session-id-1');
    expect(found).toEqual(session(user.id));
  });

  it('未登録のIDは null（例外にしない）', async () => {
    const repository = new D1SessionRepository(env.DB);
    expect(await repository.findById('no-such-session')).toBeNull();
  });

  it('deleteById で削除され、以降 findById は null。存在しないIDの削除も例外にしない', async () => {
    const user = await insertUser();
    const repository = new D1SessionRepository(env.DB);
    await repository.insert(session(user.id));

    await repository.deleteById('session-id-1');
    expect(await repository.findById('session-id-1')).toBeNull();

    await expect(repository.deleteById('already-gone')).resolves.toBeUndefined();
  });
});

describe('users.id の ON DELETE CASCADE', () => {
  it('ユーザーを削除すると、そのユーザーのセッションも消える', async () => {
    const user = await insertUser();
    const sessionRepository = new D1SessionRepository(env.DB);
    await sessionRepository.insert(session(user.id));

    await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(user.id).run();

    expect(await sessionRepository.findById('session-id-1')).toBeNull();
    const row = await env.DB.prepare('SELECT COUNT(*) AS count FROM sessions').first<{
      count: number;
    }>();
    expect(row?.count).toBe(0);
  });
});
