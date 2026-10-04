import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

import { type NewUser } from '@/domain/auth/user';
import { D1UserRepository } from '@/infra/d1/user-repository';

/**
 * `D1UserRepository` — insert/findByEmail/findById/count、email重複→`email-already-exists`
 * の `Result`、updateLoginAttempt・updatePasswordHash の永続化確認。
 * 仕様: `docs/02_design/database/schema.md` §users
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

describe('insert / findByEmail / findById / count', () => {
  it('insert した内容を findByEmail / findById で読み戻せる', async () => {
    const repository = new D1UserRepository(env.DB);
    const inserted = await repository.insert(newUser());
    expect(inserted.ok).toBe(true);
    if (!inserted.ok) return;

    expect(inserted.value.id).toBeGreaterThan(0);
    expect(inserted.value.failedLoginCount).toBe(0);
    expect(inserted.value.lockedUntil).toBeNull();

    const byEmail = await repository.findByEmail('user@example.com');
    expect(byEmail).toEqual(inserted.value);

    const byId = await repository.findById(inserted.value.id);
    expect(byId).toEqual(inserted.value);
  });

  it('未登録の email / id は null（例外にしない）', async () => {
    const repository = new D1UserRepository(env.DB);
    expect(await repository.findByEmail('nobody@example.com')).toBeNull();
    expect(await repository.findById(999_999)).toBeNull();
  });

  it('count は登録件数を返す', async () => {
    const repository = new D1UserRepository(env.DB);
    expect(await repository.count()).toBe(0);
    await repository.insert(newUser({ email: 'a@example.com' }));
    expect(await repository.count()).toBe(1);
    await repository.insert(newUser({ email: 'b@example.com' }));
    expect(await repository.count()).toBe(2);
  });
});

describe('email の UNIQUE 制約', () => {
  it('重複した email の insert は email-already-exists を返す（例外にしない）', async () => {
    const repository = new D1UserRepository(env.DB);
    const first = await repository.insert(newUser({ email: 'dup@example.com' }));
    expect(first.ok).toBe(true);

    const second = await repository.insert(newUser({ email: 'dup@example.com' }));
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.error.kind).toBe('email-already-exists');

    // 失敗した行は残らない
    expect(await repository.count()).toBe(1);
  });
});

describe('updateLoginAttempt', () => {
  it('failedLoginCount / lockedUntil を更新し、永続化される', async () => {
    const repository = new D1UserRepository(env.DB);
    const inserted = await repository.insert(newUser());
    expect(inserted.ok).toBe(true);
    if (!inserted.ok) return;

    await repository.updateLoginAttempt(inserted.value.id, {
      failedLoginCount: 5,
      lockedUntil: '2026-08-18T00:15:00.000Z',
    });

    const reloaded = await repository.findById(inserted.value.id);
    expect(reloaded?.failedLoginCount).toBe(5);
    expect(reloaded?.lockedUntil).toBe('2026-08-18T00:15:00.000Z');
  });

  it('ロック解除（lockedUntil を null に戻す）も永続化される', async () => {
    const repository = new D1UserRepository(env.DB);
    const inserted = await repository.insert(newUser());
    expect(inserted.ok).toBe(true);
    if (!inserted.ok) return;

    await repository.updateLoginAttempt(inserted.value.id, {
      failedLoginCount: 5,
      lockedUntil: '2026-08-18T00:15:00.000Z',
    });
    await repository.updateLoginAttempt(inserted.value.id, {
      failedLoginCount: 0,
      lockedUntil: null,
    });

    const reloaded = await repository.findById(inserted.value.id);
    expect(reloaded?.failedLoginCount).toBe(0);
    expect(reloaded?.lockedUntil).toBeNull();
  });
});

describe('updatePasswordHash', () => {
  it('段階的移行（イテレーション数の引き上げ）が永続化される', async () => {
    const repository = new D1UserRepository(env.DB);
    const inserted = await repository.insert(newUser({ passwordIterations: 10_000 }));
    expect(inserted.ok).toBe(true);
    if (!inserted.ok) return;

    await repository.updatePasswordHash(inserted.value.id, {
      hash: 'new-hash',
      salt: 'new-salt',
      iterations: 600_000,
    });

    const reloaded = await repository.findById(inserted.value.id);
    expect(reloaded?.passwordHash).toBe('new-hash');
    expect(reloaded?.passwordSalt).toBe('new-salt');
    expect(reloaded?.passwordIterations).toBe(600_000);
  });
});
