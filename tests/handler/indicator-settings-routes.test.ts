import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { type Session } from '@/domain/auth/session';
import { type SessionRepository } from '@/domain/auth/session-repository';
import { type User } from '@/domain/auth/user';
import { type UserRepository } from '@/domain/auth/user-repository';
import { type UserIndicatorSettings } from '@/domain/scoring/user-indicator-settings';
import { type UserIndicatorSettingsRepository } from '@/domain/scoring/user-indicator-settings-repository';
import {
  registerIndicatorSettingsRoutes,
  type IndicatorSettingsDependencies,
} from '@/handler/indicator-settings-routes';
import { requireRole } from '@/handler/require-role';

/**
 * `GET`/`PUT /api/indicator-settings` の結線テスト（T-101）。D1 を使わない（フェイクを
 * 差し替える）ので unit プロジェクトで動く。仕様: `docs/02_design/api/portfolio-api.md`
 * §指標カスタマイズ。
 */

const FIXED_NOW = () => new Date('2026-08-22T00:00:00.000Z');

const USER_ROLE_USER: User = {
  id: 1,
  email: 'user@example.com',
  passwordHash: 'unused',
  passwordSalt: 'unused',
  passwordIterations: 10_000,
  role: 'user',
  failedLoginCount: 0,
  lockedUntil: null,
  createdAt: '2026-01-01T00:00:00.000Z',
};

const ADMIN_USER: User = {
  ...USER_ROLE_USER,
  id: 2,
  email: 'admin@example.com',
  role: 'admin',
};

const USER_SESSION: Session = {
  id: 'user-session',
  userId: USER_ROLE_USER.id,
  expiresAt: '2099-01-01T00:00:00.000Z',
  createdAt: '2026-01-01T00:00:00.000Z',
};

const ADMIN_SESSION: Session = {
  id: 'admin-session',
  userId: ADMIN_USER.id,
  expiresAt: '2099-01-01T00:00:00.000Z',
  createdAt: '2026-01-01T00:00:00.000Z',
};

function fakeUserRepository(): UserRepository {
  return {
    findByEmail: () => Promise.resolve(null),
    findById: (id) =>
      Promise.resolve(
        id === USER_ROLE_USER.id ? USER_ROLE_USER : id === ADMIN_USER.id ? ADMIN_USER : null,
      ),
    count: () => Promise.resolve(2),
    insert: () => {
      throw new Error('このテストで UserRepository.insert が呼ばれるのは想定外');
    },
    updateLoginAttempt: () => Promise.resolve(),
    updatePasswordHash: () => Promise.resolve(),
  };
}

function fakeSessionRepository(): SessionRepository {
  return {
    insert: () => Promise.resolve(),
    findById: (id) =>
      Promise.resolve([USER_SESSION, ADMIN_SESSION].find((s) => s.id === id) ?? null),
    deleteById: () => Promise.resolve(),
  };
}

function fakeUserIndicatorSettingsRepository(
  settingsByUserId: Readonly<Record<number, UserIndicatorSettings>> = {},
): { repository: UserIndicatorSettingsRepository; savedFor: Map<number, UserIndicatorSettings> } {
  const savedFor = new Map<number, UserIndicatorSettings>(Object.entries(settingsByUserId).map(([k, v]) => [Number(k), v]));
  const repository: UserIndicatorSettingsRepository = {
    findByUserId: (userId: number) => Promise.resolve(savedFor.get(userId) ?? null),
    replaceAll: (userId: number, settings: UserIndicatorSettings): Promise<void> => {
      savedFor.set(userId, settings);
      return Promise.resolve();
    },
  };
  return { repository, savedFor };
}

function buildApp(deps: IndicatorSettingsDependencies) {
  const app = new Hono();
  const userOrAdmin = requireRole(
    { userRepository: deps.userRepository, sessionRepository: deps.sessionRepository, now: deps.now },
    ['user', 'admin'],
  );
  registerIndicatorSettingsRoutes(app, deps, userOrAdmin);
  return app;
}

describe('GET /api/indicator-settings', () => {
  it('未ログイン（Cookie無し）は401', async () => {
    const { repository } = fakeUserIndicatorSettingsRepository();
    const app = buildApp({
      userRepository: fakeUserRepository(),
      sessionRepository: fakeSessionRepository(),
      userIndicatorSettingsRepository: repository,
      now: FIXED_NOW,
    });

    const response = await app.request('/api/indicator-settings');
    expect(response.status).toBe(401);
  });

  it('role=user は200で通過する（indicator-custom-page.md §1）', async () => {
    const { repository } = fakeUserIndicatorSettingsRepository();
    const app = buildApp({
      userRepository: fakeUserRepository(),
      sessionRepository: fakeSessionRepository(),
      userIndicatorSettingsRepository: repository,
      now: FIXED_NOW,
    });

    const response = await app.request('/api/indicator-settings', {
      headers: { cookie: `session_id=${USER_SESSION.id}` },
    });
    expect(response.status).toBe(200);
  });

  it('role=admin も200で通過する', async () => {
    const { repository } = fakeUserIndicatorSettingsRepository();
    const app = buildApp({
      userRepository: fakeUserRepository(),
      sessionRepository: fakeSessionRepository(),
      userIndicatorSettingsRepository: repository,
      now: FIXED_NOW,
    });

    const response = await app.request('/api/indicator-settings', {
      headers: { cookie: `session_id=${ADMIN_SESSION.id}` },
    });
    expect(response.status).toBe(200);
  });

  it('未設定ユーザーは全10指標選択・デフォルト基準値相当を返す（404にしない）', async () => {
    const { repository } = fakeUserIndicatorSettingsRepository();
    const app = buildApp({
      userRepository: fakeUserRepository(),
      sessionRepository: fakeSessionRepository(),
      userIndicatorSettingsRepository: repository,
      now: FIXED_NOW,
    });

    const response = await app.request('/api/indicator-settings', {
      headers: { cookie: `session_id=${USER_SESSION.id}` },
    });
    const body = (await response.json()) as { selected: string[]; basisValues: Record<string, number> };
    expect(body.selected).toHaveLength(10);
    expect(body.basisValues.dividendYield).toBe(5.5);
  });

  it('保存済みユーザーはその設定をそのまま返す', async () => {
    const saved: UserIndicatorSettings = {
      selectedKeys: ['dividendGrowthRate', 'consecutiveYears', 'roeAverage', 'operatingMargin', 'dividendYield'],
      basisValues: { dividendGrowthRate: 20, consecutiveYears: 10, roeAverage: 10, operatingMargin: 15, dividendYield: 4 },
    };
    const { repository } = fakeUserIndicatorSettingsRepository({ [USER_ROLE_USER.id]: saved });
    const app = buildApp({
      userRepository: fakeUserRepository(),
      sessionRepository: fakeSessionRepository(),
      userIndicatorSettingsRepository: repository,
      now: FIXED_NOW,
    });

    const response = await app.request('/api/indicator-settings', {
      headers: { cookie: `session_id=${USER_SESSION.id}` },
    });
    const body = (await response.json()) as { selected: string[]; basisValues: Record<string, number> };
    expect([...body.selected].sort()).toEqual([...saved.selectedKeys].sort());
    expect(body.basisValues.dividendGrowthRate).toBe(20);
  });
});

describe('PUT /api/indicator-settings', () => {
  function putRequest(body: unknown, cookie = `session_id=${USER_SESSION.id}`) {
    return { method: 'PUT' as const, headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(body) };
  }

  it('未ログインは401', async () => {
    const { repository } = fakeUserIndicatorSettingsRepository();
    const app = buildApp({
      userRepository: fakeUserRepository(),
      sessionRepository: fakeSessionRepository(),
      userIndicatorSettingsRepository: repository,
      now: FIXED_NOW,
    });

    const response = await app.request(
      '/api/indicator-settings',
      putRequest({ selected: [], basisValues: {} }, ''),
    );
    expect(response.status).toBe(401);
  });

  it('正常系: 保存して200、保存内容を返す', async () => {
    const { repository, savedFor } = fakeUserIndicatorSettingsRepository();
    const app = buildApp({
      userRepository: fakeUserRepository(),
      sessionRepository: fakeSessionRepository(),
      userIndicatorSettingsRepository: repository,
      now: FIXED_NOW,
    });

    const response = await app.request(
      '/api/indicator-settings',
      putRequest({
        selected: ['dividendGrowthRate', 'consecutiveYears', 'roeAverage', 'operatingMargin', 'dividendYield'],
        basisValues: {
          dividendGrowthRate: 20,
          consecutiveYears: 10,
          roeAverage: 10,
          operatingMargin: 15,
          dividendYield: 4,
        },
      }),
    );
    expect(response.status).toBe(200);
    expect(savedFor.get(USER_ROLE_USER.id)?.selectedKeys).toHaveLength(5);
  });

  it('選択件数4件（5未満）は400', async () => {
    const { repository } = fakeUserIndicatorSettingsRepository();
    const app = buildApp({
      userRepository: fakeUserRepository(),
      sessionRepository: fakeSessionRepository(),
      userIndicatorSettingsRepository: repository,
      now: FIXED_NOW,
    });

    const response = await app.request(
      '/api/indicator-settings',
      putRequest({
        selected: ['dividendGrowthRate', 'consecutiveYears', 'roeAverage', 'operatingMargin'],
        basisValues: { dividendGrowthRate: 20, consecutiveYears: 10, roeAverage: 10, operatingMargin: 15 },
      }),
    );
    expect(response.status).toBe(400);
  });

  it('⑨MIX係数に基準値を指定すると400（専用メッセージ）', async () => {
    const { repository } = fakeUserIndicatorSettingsRepository();
    const app = buildApp({
      userRepository: fakeUserRepository(),
      sessionRepository: fakeSessionRepository(),
      userIndicatorSettingsRepository: repository,
      now: FIXED_NOW,
    });

    const response = await app.request(
      '/api/indicator-settings',
      putRequest({
        selected: ['dividendGrowthRate', 'consecutiveYears', 'roeAverage', 'operatingMargin', 'mixCoefficient'],
        basisValues: {
          dividendGrowthRate: 20,
          consecutiveYears: 10,
          roeAverage: 10,
          operatingMargin: 15,
          mixCoefficient: 1,
        },
      }),
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe('MIX係数の基準値は指定できません');
  });

  it('基準値が0以下は400（満点となる基準値は 0 より大きい値にしてください）', async () => {
    const { repository } = fakeUserIndicatorSettingsRepository();
    const app = buildApp({
      userRepository: fakeUserRepository(),
      sessionRepository: fakeSessionRepository(),
      userIndicatorSettingsRepository: repository,
      now: FIXED_NOW,
    });

    const response = await app.request(
      '/api/indicator-settings',
      putRequest({
        selected: ['dividendGrowthRate', 'consecutiveYears', 'roeAverage', 'operatingMargin', 'dividendYield'],
        basisValues: {
          dividendGrowthRate: 0,
          consecutiveYears: 10,
          roeAverage: 10,
          operatingMargin: 15,
          dividendYield: 4,
        },
      }),
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe('満点となる基準値は 0 より大きい値にしてください');
  });

  it('不正なJSONボディは400（zod境界）', async () => {
    const { repository } = fakeUserIndicatorSettingsRepository();
    const app = buildApp({
      userRepository: fakeUserRepository(),
      sessionRepository: fakeSessionRepository(),
      userIndicatorSettingsRepository: repository,
      now: FIXED_NOW,
    });

    const response = await app.request('/api/indicator-settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', cookie: `session_id=${USER_SESSION.id}` },
      body: JSON.stringify({ selected: ['not-a-real-metric-key'], basisValues: {} }),
    });
    expect(response.status).toBe(400);
  });
});
