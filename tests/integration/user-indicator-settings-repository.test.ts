import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

import { type NewUser } from '@/domain/auth/user';
import { type UserIndicatorSettings } from '@/domain/scoring/user-indicator-settings';
import { D1UserIndicatorSettingsRepository } from '@/infra/d1/user-indicator-settings-repository';
import { D1UserRepository } from '@/infra/d1/user-repository';

/**
 * `D1UserIndicatorSettingsRepository` — findByUserId/replaceAll、
 * 複合主キー `(user_id, metric_key)`、`replaceAll` の全削除→挿入が1トランザクションで
 * 一貫すること、`users.id` の `ON DELETE CASCADE`。
 * 仕様: `docs/02_design/database/schema.md` §user_indicator_settings
 */

beforeEach(async () => {
  await env.DB.exec('DELETE FROM user_indicator_settings');
  await env.DB.exec('DELETE FROM sessions');
  await env.DB.exec('DELETE FROM users');
});

function newUser(overrides: Partial<NewUser> = {}): NewUser {
  return {
    email: 'user@example.com',
    passwordHash: 'hash-value',
    passwordSalt: 'salt-value',
    passwordIterations: 10_000,
    role: 'user',
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

describe('findByUserId', () => {
  it('未設定（行が0件）は null（404にしない）', async () => {
    const user = await insertUser();
    const repository = new D1UserIndicatorSettingsRepository(env.DB);
    expect(await repository.findByUserId(user.id)).toBeNull();
  });

  it('保存済みの選択・基準値を読み戻せる', async () => {
    const user = await insertUser();
    const repository = new D1UserIndicatorSettingsRepository(env.DB);
    const settings: UserIndicatorSettings = {
      selectedKeys: [
        'dividendGrowthRate',
        'consecutiveYears',
        'roeAverage',
        'operatingMargin',
        'dividendYield',
      ],
      basisValues: {
        dividendGrowthRate: 20,
        consecutiveYears: 10,
        roeAverage: 10,
        operatingMargin: 15,
        dividendYield: 4,
      },
    };
    await repository.replaceAll(user.id, settings);

    const found = await repository.findByUserId(user.id);
    expect(found?.selectedKeys.slice().sort()).toEqual([...settings.selectedKeys].sort());
    expect(found?.basisValues).toEqual(settings.basisValues);
  });

  it('⑨MIX係数を選択しても基準値は保存されない（常にNULL）', async () => {
    const user = await insertUser();
    const repository = new D1UserIndicatorSettingsRepository(env.DB);
    const settings: UserIndicatorSettings = {
      selectedKeys: [
        'dividendGrowthRate',
        'consecutiveYears',
        'roeAverage',
        'operatingMargin',
        'mixCoefficient',
      ],
      basisValues: {
        dividendGrowthRate: 20,
        consecutiveYears: 10,
        roeAverage: 10,
        operatingMargin: 15,
      },
    };
    await repository.replaceAll(user.id, settings);

    const row = await env.DB.prepare(
      "SELECT basis_value FROM user_indicator_settings WHERE user_id = ? AND metric_key = 'mixCoefficient'",
    )
      .bind(user.id)
      .first<{ basis_value: number | null }>();
    expect(row?.basis_value).toBeNull();

    const found = await repository.findByUserId(user.id);
    expect(found?.selectedKeys).toContain('mixCoefficient');
    expect(Object.keys(found?.basisValues ?? {})).not.toContain('mixCoefficient');
  });
});

describe('replaceAll（全削除→挿入。schema.md の複合主キー (user_id, metric_key)）', () => {
  it('2回目の replaceAll で前回の選択が消え、新しい選択だけが残る', async () => {
    const user = await insertUser();
    const repository = new D1UserIndicatorSettingsRepository(env.DB);

    await repository.replaceAll(user.id, {
      selectedKeys: [
        'dividendGrowthRate',
        'consecutiveYears',
        'roeAverage',
        'operatingMargin',
        'dividendYield',
      ],
      basisValues: {
        dividendGrowthRate: 20,
        consecutiveYears: 10,
        roeAverage: 10,
        operatingMargin: 15,
        dividendYield: 4,
      },
    });

    await repository.replaceAll(user.id, {
      selectedKeys: ['payoutRatio', 'epsCagr', 'dividendSustainability', 'revenueCagr', 'roeAverage'],
      basisValues: {
        payoutRatio: 30,
        epsCagr: 15,
        dividendSustainability: 8,
        revenueCagr: 12,
        roeAverage: 9,
      },
    });

    const found = await repository.findByUserId(user.id);
    expect(found?.selectedKeys.slice().sort()).toEqual(
      ['payoutRatio', 'epsCagr', 'dividendSustainability', 'revenueCagr', 'roeAverage'].sort(),
    );
    // ①②⑧⑩（1回目だけの選択）は消えている
    expect(found?.selectedKeys).not.toContain('dividendGrowthRate');
    expect(found?.selectedKeys).not.toContain('operatingMargin');
  });

  it('複合主キー (user_id, metric_key) 違反にならず、ユーザーごとに独立して保存される', async () => {
    const userA = await insertUser({ email: 'a@example.com' });
    const userB = await insertUser({ email: 'b@example.com' });
    const repository = new D1UserIndicatorSettingsRepository(env.DB);

    await repository.replaceAll(userA.id, {
      selectedKeys: ['dividendGrowthRate', 'consecutiveYears', 'roeAverage', 'operatingMargin', 'dividendYield'],
      basisValues: { dividendGrowthRate: 20, consecutiveYears: 10, roeAverage: 10, operatingMargin: 15, dividendYield: 4 },
    });
    await repository.replaceAll(userB.id, {
      selectedKeys: ['payoutRatio', 'epsCagr', 'dividendSustainability', 'revenueCagr', 'roeAverage'],
      basisValues: { payoutRatio: 30, epsCagr: 15, dividendSustainability: 8, revenueCagr: 12, roeAverage: 9 },
    });

    const foundA = await repository.findByUserId(userA.id);
    const foundB = await repository.findByUserId(userB.id);
    expect(foundA?.selectedKeys).toContain('dividendGrowthRate');
    expect(foundB?.selectedKeys).toContain('payoutRatio');
    expect(foundA?.selectedKeys).not.toContain('payoutRatio');
  });
});

describe('users.id の ON DELETE CASCADE', () => {
  it('ユーザーを削除すると、そのユーザーの指標設定も消える', async () => {
    const user = await insertUser();
    const repository = new D1UserIndicatorSettingsRepository(env.DB);
    await repository.replaceAll(user.id, {
      selectedKeys: ['dividendGrowthRate', 'consecutiveYears', 'roeAverage', 'operatingMargin', 'dividendYield'],
      basisValues: { dividendGrowthRate: 20, consecutiveYears: 10, roeAverage: 10, operatingMargin: 15, dividendYield: 4 },
    });

    await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(user.id).run();

    expect(await repository.findByUserId(user.id)).toBeNull();
    const row = await env.DB.prepare(
      'SELECT COUNT(*) AS count FROM user_indicator_settings',
    ).first<{ count: number }>();
    expect(row?.count).toBe(0);
  });
});
