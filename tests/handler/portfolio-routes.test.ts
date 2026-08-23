import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { type Company } from '@/domain/company/company';
import { type CompanyListResult, type CompanyRepository } from '@/domain/company/company-repository';
import { MAX_PRICE_SEN } from '@/domain/company/dividend-record';
import { MAX_HOLDINGS_PER_PORTFOLIO, MAX_PORTFOLIOS_PER_USER } from '@/domain/portfolio/portfolio';
import { MAX_HOLDING_QUANTITY, type PortfolioHoldingRecord } from '@/domain/portfolio/portfolio-holding';
import { type PortfolioIdGenerator } from '@/domain/portfolio/portfolio-id-generator';
import { registerPortfolioRoutes, type PortfolioDependencies } from '@/handler/portfolio-routes';
import { requireRole } from '@/handler/require-role';

import {
  TEST_ADMIN_SESSION_COOKIE,
  TEST_USER_SESSION_COOKIE,
  TEST_USER_USER,
  fakeSessionRepository,
  fakeUserRepository,
} from './support/build-app-dependencies';
import { createFakePortfolioRepository } from '../usecase/portfolio/support/fake-portfolio-repository';

/**
 * ポートフォリオAPI（T-103）の結線テスト。D1 を使わない（フェイクを差し替える）ので
 * unit プロジェクトで動く。仕様: `docs/02_design/api/portfolio-api.md`。
 * `tests/handler/indicator-settings-routes.test.ts` と同型パターン。
 */

const FIXED_NOW = () => new Date('2026-08-23T00:00:00.000Z');
const CREATED_AT = '2026-01-01T00:00:00.000Z';

const SAMPLE_COMPANY: Company = {
  code: '7203',
  name: 'トヨタ自動車',
  records: [],
  dividends: [],
  balanceSheet: {
    currentAssetsSen: null,
    investmentSecuritiesSen: null,
    totalLiabilitiesSen: null,
    previousDividendTotalSen: null,
  },
  multiples: { per: null, perSource: null, pbr: null, pbrSource: null },
  priceSen: null,
  fetchedAt: CREATED_AT,
  epsHistoryRestated: false,
  revenueHistoryRestated: false,
};

function unimplemented(name: string): never {
  throw new Error(`このテストで ${name} が呼ばれるのは想定外`);
}

function fakeCompanyRepository(companies: Readonly<Record<string, Company>> = {}): CompanyRepository {
  return {
    save: (): Promise<void> => unimplemented('CompanyRepository.save'),
    findByCode: (code: string): Promise<Company | null> => Promise.resolve(companies[code] ?? null),
    listSummaries: (): Promise<CompanyListResult> => unimplemented('CompanyRepository.listSummaries'),
    deleteByCode: (): Promise<void> => unimplemented('CompanyRepository.deleteByCode'),
    listFiscalYearEndMonths: (): Promise<readonly number[]> =>
      unimplemented('CompanyRepository.listFiscalYearEndMonths'),
  };
}

function fakePortfolioIdGenerator(id = 'pf_generated'): PortfolioIdGenerator {
  return { generate: () => id };
}

function buildApp(deps: PortfolioDependencies) {
  const app = new Hono();
  const userOrAdmin = requireRole(
    { userRepository: deps.userRepository, sessionRepository: deps.sessionRepository, now: deps.now },
    ['user', 'admin'],
  );
  registerPortfolioRoutes(app, deps, userOrAdmin);
  return app;
}

function baseDeps(
  overrides: Partial<PortfolioDependencies> = {},
): PortfolioDependencies {
  return {
    userRepository: fakeUserRepository(),
    sessionRepository: fakeSessionRepository(),
    portfolioRepository: createFakePortfolioRepository().repository,
    portfolioIdGenerator: fakePortfolioIdGenerator(),
    companyRepository: fakeCompanyRepository(),
    now: FIXED_NOW,
    ...overrides,
  };
}

describe('GET /api/portfolios', () => {
  it('未ログイン（Cookie無し）は401', async () => {
    const app = buildApp(baseDeps());
    const response = await app.request('/api/portfolios');
    expect(response.status).toBe(401);
  });

  it('role=user は200。自分のポートフォリオ一覧とmaxPortfoliosを返す', async () => {
    const { repository } = createFakePortfolioRepository({
      portfolios: [{ id: 'pf_1', userId: TEST_USER_USER.id, name: 'メインNISA', createdAt: CREATED_AT }],
    });
    const app = buildApp(baseDeps({ portfolioRepository: repository }));

    const response = await app.request('/api/portfolios', {
      headers: { cookie: TEST_USER_SESSION_COOKIE },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { portfolios: unknown[]; maxPortfolios: number };
    expect(body.portfolios).toHaveLength(1);
    expect(body.maxPortfolios).toBe(MAX_PORTFOLIOS_PER_USER);
  });

  it('role=admin も200で通過する', async () => {
    const app = buildApp(baseDeps());
    const response = await app.request('/api/portfolios', {
      headers: { cookie: TEST_ADMIN_SESSION_COOKIE },
    });
    expect(response.status).toBe(200);
  });
});

describe('POST /api/portfolios', () => {
  function postRequest(body: unknown, cookie = TEST_USER_SESSION_COOKIE) {
    return {
      method: 'POST' as const,
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify(body),
    };
  }

  it('未ログインは401', async () => {
    const app = buildApp(baseDeps());
    const response = await app.request('/api/portfolios', postRequest({ name: 'A' }, ''));
    expect(response.status).toBe(401);
  });

  it('空文字のnameは400', async () => {
    const app = buildApp(baseDeps());
    const response = await app.request('/api/portfolios', postRequest({ name: '' }));
    expect(response.status).toBe(400);
  });

  it('正常系: 201でid/nameを返す', async () => {
    const app = buildApp(baseDeps({ portfolioIdGenerator: fakePortfolioIdGenerator('pf_new') }));
    const response = await app.request('/api/portfolios', postRequest({ name: 'メインNISA' }));
    expect(response.status).toBe(201);
    const body = (await response.json()) as { id: string; name: string };
    expect(body).toEqual({ id: 'pf_new', name: 'メインNISA' });
  });

  it('上限（10）到達時は403', async () => {
    const existing = Array.from({ length: MAX_PORTFOLIOS_PER_USER }, (_, i) => ({
      id: `pf_${i}`,
      userId: TEST_USER_USER.id,
      name: `既存${i}`,
      createdAt: CREATED_AT,
    }));
    const { repository } = createFakePortfolioRepository({ portfolios: existing });
    const app = buildApp(baseDeps({ portfolioRepository: repository }));

    const response = await app.request('/api/portfolios', postRequest({ name: '11個目' }));
    expect(response.status).toBe(403);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe('ポートフォリオは最大10個までです');
  });
});

describe('DELETE /api/portfolios/:id', () => {
  it('未ログインは401', async () => {
    const app = buildApp(baseDeps());
    const response = await app.request('/api/portfolios/pf_1', { method: 'DELETE' });
    expect(response.status).toBe(401);
  });

  it('他ユーザーのIDは404', async () => {
    const { repository } = createFakePortfolioRepository({
      portfolios: [{ id: 'pf_1', userId: 999, name: '他ユーザー', createdAt: CREATED_AT }],
    });
    const app = buildApp(baseDeps({ portfolioRepository: repository }));
    const response = await app.request('/api/portfolios/pf_1', {
      method: 'DELETE',
      headers: { cookie: TEST_USER_SESSION_COOKIE },
    });
    expect(response.status).toBe(404);
  });

  it('存在しないIDは404', async () => {
    const app = buildApp(baseDeps());
    const response = await app.request('/api/portfolios/pf_does_not_exist', {
      method: 'DELETE',
      headers: { cookie: TEST_USER_SESSION_COOKIE },
    });
    expect(response.status).toBe(404);
  });

  it('正常系: 204', async () => {
    const { repository } = createFakePortfolioRepository({
      portfolios: [{ id: 'pf_1', userId: TEST_USER_USER.id, name: 'メインNISA', createdAt: CREATED_AT }],
    });
    const app = buildApp(baseDeps({ portfolioRepository: repository }));
    const response = await app.request('/api/portfolios/pf_1', {
      method: 'DELETE',
      headers: { cookie: TEST_USER_SESSION_COOKIE },
    });
    expect(response.status).toBe(204);
  });
});

describe('GET /api/portfolios/:id', () => {
  it('未ログインは401', async () => {
    const app = buildApp(baseDeps());
    const response = await app.request('/api/portfolios/pf_1');
    expect(response.status).toBe(401);
  });

  it('他ユーザーのIDは404', async () => {
    const { repository } = createFakePortfolioRepository({
      portfolios: [{ id: 'pf_1', userId: 999, name: '他ユーザー', createdAt: CREATED_AT }],
    });
    const app = buildApp(baseDeps({ portfolioRepository: repository }));
    const response = await app.request('/api/portfolios/pf_1', {
      headers: { cookie: TEST_USER_SESSION_COOKIE },
    });
    expect(response.status).toBe(404);
  });

  it('正常系: 200でmetrics・holdingsを含む', async () => {
    const { repository } = createFakePortfolioRepository({
      portfolios: [{ id: 'pf_1', userId: TEST_USER_USER.id, name: 'メインNISA', createdAt: CREATED_AT }],
      holdings: [
        { portfolioId: 'pf_1', companyCode: '7203', quantity: 100, acquisitionPriceSen: 280_000, createdAt: CREATED_AT, updatedAt: CREATED_AT },
      ],
      companyInfo: {
        '7203': { name: 'トヨタ自動車', currentPriceSen: 314_200, dividendYieldBp: 318, totalScore: 62, effectiveMetricCount: 8 },
      },
    });
    const app = buildApp(baseDeps({ portfolioRepository: repository }));
    const response = await app.request('/api/portfolios/pf_1', {
      headers: { cookie: TEST_USER_SESSION_COOKIE },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      metrics: { totalValueSen: number };
      holdings: { code: string; valueSen: number }[];
    };
    expect(body.metrics.totalValueSen).toBe(31_420_000);
    expect(body.holdings[0]?.code).toBe('7203');
    expect(body.holdings[0]?.valueSen).toBe(31_420_000);
  });
});

describe('POST /api/portfolios/:id/holdings', () => {
  function postRequest(body: unknown, cookie = TEST_USER_SESSION_COOKIE) {
    return {
      method: 'POST' as const,
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify(body),
    };
  }

  it('未ログインは401', async () => {
    const app = buildApp(baseDeps());
    const response = await app.request('/api/portfolios/pf_1/holdings', postRequest({}, ''));
    expect(response.status).toBe(401);
  });

  it('codeの形式不正は400', async () => {
    const app = buildApp(baseDeps());
    const response = await app.request(
      '/api/portfolios/pf_1/holdings',
      postRequest({ code: 'bad', quantity: 100, acquisitionPriceSen: 280_000 }),
    );
    expect(response.status).toBe(400);
  });

  it('quantity<=0は400', async () => {
    const app = buildApp(baseDeps());
    const response = await app.request(
      '/api/portfolios/pf_1/holdings',
      postRequest({ code: '7203', quantity: 0, acquisitionPriceSen: 280_000 }),
    );
    expect(response.status).toBe(400);
  });

  it('quantityが上限（1,000,000株）超過は400', async () => {
    const app = buildApp(baseDeps());
    const response = await app.request(
      '/api/portfolios/pf_1/holdings',
      postRequest({ code: '7203', quantity: MAX_HOLDING_QUANTITY + 1, acquisitionPriceSen: 280_000 }),
    );
    expect(response.status).toBe(400);
  });

  it('acquisitionPriceSenが上限（MAX_PRICE_SEN）超過は400', async () => {
    const app = buildApp(baseDeps());
    const response = await app.request(
      '/api/portfolios/pf_1/holdings',
      postRequest({ code: '7203', quantity: 100, acquisitionPriceSen: MAX_PRICE_SEN + 1 }),
    );
    expect(response.status).toBe(400);
  });

  it('quantity・acquisitionPriceSenとも上限ちょうどは成功する', async () => {
    const { repository } = createFakePortfolioRepository({
      portfolios: [{ id: 'pf_1', userId: TEST_USER_USER.id, name: 'メインNISA', createdAt: CREATED_AT }],
    });
    const app = buildApp(
      baseDeps({ portfolioRepository: repository, companyRepository: fakeCompanyRepository({ '7203': SAMPLE_COMPANY }) }),
    );
    const response = await app.request(
      '/api/portfolios/pf_1/holdings',
      postRequest({ code: '7203', quantity: MAX_HOLDING_QUANTITY, acquisitionPriceSen: MAX_PRICE_SEN }),
    );
    expect(response.status).toBe(201);
  });

  it('他ユーザーのポートフォリオIDは404', async () => {
    const { repository } = createFakePortfolioRepository({
      portfolios: [{ id: 'pf_1', userId: 999, name: '他ユーザー', createdAt: CREATED_AT }],
    });
    const app = buildApp(baseDeps({ portfolioRepository: repository }));
    const response = await app.request(
      '/api/portfolios/pf_1/holdings',
      postRequest({ code: '7203', quantity: 100, acquisitionPriceSen: 280_000 }),
    );
    expect(response.status).toBe(404);
  });

  it('未登録の銘柄コードは404', async () => {
    const { repository } = createFakePortfolioRepository({
      portfolios: [{ id: 'pf_1', userId: TEST_USER_USER.id, name: 'メインNISA', createdAt: CREATED_AT }],
    });
    const app = buildApp(baseDeps({ portfolioRepository: repository, companyRepository: fakeCompanyRepository({}) }));
    const response = await app.request(
      '/api/portfolios/pf_1/holdings',
      postRequest({ code: '7203', quantity: 100, acquisitionPriceSen: 280_000 }),
    );
    expect(response.status).toBe(404);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe('指定された銘柄は登録されていません');
  });

  it('重複追加は409', async () => {
    const { repository } = createFakePortfolioRepository({
      portfolios: [{ id: 'pf_1', userId: TEST_USER_USER.id, name: 'メインNISA', createdAt: CREATED_AT }],
      holdings: [
        { portfolioId: 'pf_1', companyCode: '7203', quantity: 100, acquisitionPriceSen: 280_000, createdAt: CREATED_AT, updatedAt: CREATED_AT },
      ],
    });
    const app = buildApp(
      baseDeps({ portfolioRepository: repository, companyRepository: fakeCompanyRepository({ '7203': SAMPLE_COMPANY }) }),
    );
    const response = await app.request(
      '/api/portfolios/pf_1/holdings',
      postRequest({ code: '7203', quantity: 50, acquisitionPriceSen: 300_000 }),
    );
    expect(response.status).toBe(409);
  });

  it('保有銘柄が既に100件なら403', async () => {
    const holdings: PortfolioHoldingRecord[] = Array.from(
      { length: MAX_HOLDINGS_PER_PORTFOLIO },
      (_, i) => ({
        portfolioId: 'pf_1',
        companyCode: `existing-${i}`,
        quantity: 1,
        acquisitionPriceSen: 1_000,
        createdAt: CREATED_AT,
        updatedAt: CREATED_AT,
      }),
    );
    const { repository } = createFakePortfolioRepository({
      portfolios: [{ id: 'pf_1', userId: TEST_USER_USER.id, name: 'メインNISA', createdAt: CREATED_AT }],
      holdings,
    });
    const app = buildApp(
      baseDeps({ portfolioRepository: repository, companyRepository: fakeCompanyRepository({ '7203': SAMPLE_COMPANY }) }),
    );
    const response = await app.request(
      '/api/portfolios/pf_1/holdings',
      postRequest({ code: '7203', quantity: 100, acquisitionPriceSen: 280_000 }),
    );
    expect(response.status).toBe(403);
  });

  it('正常系: 201で追加した保有銘柄1件を返す', async () => {
    const { repository } = createFakePortfolioRepository({
      portfolios: [{ id: 'pf_1', userId: TEST_USER_USER.id, name: 'メインNISA', createdAt: CREATED_AT }],
      companyInfo: {
        '7203': { name: 'トヨタ自動車', currentPriceSen: 314_200, dividendYieldBp: 318, totalScore: 62, effectiveMetricCount: 8 },
      },
    });
    const app = buildApp(
      baseDeps({ portfolioRepository: repository, companyRepository: fakeCompanyRepository({ '7203': SAMPLE_COMPANY }) }),
    );
    const response = await app.request(
      '/api/portfolios/pf_1/holdings',
      postRequest({ code: '7203', quantity: 100, acquisitionPriceSen: 280_000 }),
    );
    expect(response.status).toBe(201);
    const body = (await response.json()) as { code: string; valueSen: number };
    expect(body.code).toBe('7203');
    expect(body.valueSen).toBe(31_420_000);
  });
});

describe('PATCH /api/portfolios/:id/holdings/:code', () => {
  function patchRequest(body: unknown, cookie = TEST_USER_SESSION_COOKIE) {
    return {
      method: 'PATCH' as const,
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify(body),
    };
  }

  function setupHeldPortfolio() {
    return createFakePortfolioRepository({
      portfolios: [{ id: 'pf_1', userId: TEST_USER_USER.id, name: 'メインNISA', createdAt: CREATED_AT }],
      holdings: [
        { portfolioId: 'pf_1', companyCode: '7203', quantity: 100, acquisitionPriceSen: 280_000, createdAt: CREATED_AT, updatedAt: CREATED_AT },
      ],
      companyInfo: {
        '7203': { name: 'トヨタ自動車', currentPriceSen: 314_200, dividendYieldBp: 318, totalScore: 62, effectiveMetricCount: 8 },
      },
    });
  }

  it('未ログインは401', async () => {
    const app = buildApp(baseDeps());
    const response = await app.request('/api/portfolios/pf_1/holdings/7203', patchRequest({}, ''));
    expect(response.status).toBe(401);
  });

  it('両方省略({})は400（最低1フィールド必須）', async () => {
    const { repository } = setupHeldPortfolio();
    const app = buildApp(baseDeps({ portfolioRepository: repository }));
    const response = await app.request('/api/portfolios/pf_1/holdings/7203', patchRequest({}));
    expect(response.status).toBe(400);
  });

  it('quantity<=0は400', async () => {
    const { repository } = setupHeldPortfolio();
    const app = buildApp(baseDeps({ portfolioRepository: repository }));
    const response = await app.request(
      '/api/portfolios/pf_1/holdings/7203',
      patchRequest({ quantity: 0 }),
    );
    expect(response.status).toBe(400);
  });

  it('quantityが上限超過は400', async () => {
    const { repository } = setupHeldPortfolio();
    const app = buildApp(baseDeps({ portfolioRepository: repository }));
    const response = await app.request(
      '/api/portfolios/pf_1/holdings/7203',
      patchRequest({ quantity: MAX_HOLDING_QUANTITY + 1 }),
    );
    expect(response.status).toBe(400);
  });

  it('acquisitionPriceSenが上限超過は400', async () => {
    const { repository } = setupHeldPortfolio();
    const app = buildApp(baseDeps({ portfolioRepository: repository }));
    const response = await app.request(
      '/api/portfolios/pf_1/holdings/7203',
      patchRequest({ acquisitionPriceSen: MAX_PRICE_SEN + 1 }),
    );
    expect(response.status).toBe(400);
  });

  it('他ユーザーのポートフォリオIDは404', async () => {
    const { repository } = createFakePortfolioRepository({
      portfolios: [{ id: 'pf_1', userId: 999, name: '他ユーザー', createdAt: CREATED_AT }],
    });
    const app = buildApp(baseDeps({ portfolioRepository: repository }));
    const response = await app.request(
      '/api/portfolios/pf_1/holdings/7203',
      patchRequest({ quantity: 150 }),
    );
    expect(response.status).toBe(404);
  });

  it('保有されていない銘柄コードは404', async () => {
    const { repository } = createFakePortfolioRepository({
      portfolios: [{ id: 'pf_1', userId: TEST_USER_USER.id, name: 'メインNISA', createdAt: CREATED_AT }],
    });
    const app = buildApp(baseDeps({ portfolioRepository: repository }));
    const response = await app.request(
      '/api/portfolios/pf_1/holdings/7203',
      patchRequest({ quantity: 150 }),
    );
    expect(response.status).toBe(404);
  });

  it('正常系: 200で更新後の保有銘柄を返す', async () => {
    const { repository } = setupHeldPortfolio();
    const app = buildApp(baseDeps({ portfolioRepository: repository }));
    const response = await app.request(
      '/api/portfolios/pf_1/holdings/7203',
      patchRequest({ quantity: 150, acquisitionPriceSen: 275_000 }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { quantity: number; acquisitionPriceSen: number };
    expect(body.quantity).toBe(150);
    expect(body.acquisitionPriceSen).toBe(275_000);
  });
});

describe('DELETE /api/portfolios/:id/holdings/:code', () => {
  it('未ログインは401', async () => {
    const app = buildApp(baseDeps());
    const response = await app.request('/api/portfolios/pf_1/holdings/7203', { method: 'DELETE' });
    expect(response.status).toBe(401);
  });

  it('codeの形式不正は400', async () => {
    const app = buildApp(baseDeps());
    const response = await app.request('/api/portfolios/pf_1/holdings/bad', {
      method: 'DELETE',
      headers: { cookie: TEST_USER_SESSION_COOKIE },
    });
    expect(response.status).toBe(400);
  });

  it('他ユーザーのポートフォリオIDは404', async () => {
    const { repository } = createFakePortfolioRepository({
      portfolios: [{ id: 'pf_1', userId: 999, name: '他ユーザー', createdAt: CREATED_AT }],
    });
    const app = buildApp(baseDeps({ portfolioRepository: repository }));
    const response = await app.request('/api/portfolios/pf_1/holdings/7203', {
      method: 'DELETE',
      headers: { cookie: TEST_USER_SESSION_COOKIE },
    });
    expect(response.status).toBe(404);
  });

  it('未保有の銘柄コードでも204（冪等）', async () => {
    const { repository } = createFakePortfolioRepository({
      portfolios: [{ id: 'pf_1', userId: TEST_USER_USER.id, name: 'メインNISA', createdAt: CREATED_AT }],
    });
    const app = buildApp(baseDeps({ portfolioRepository: repository }));
    const response = await app.request('/api/portfolios/pf_1/holdings/7203', {
      method: 'DELETE',
      headers: { cookie: TEST_USER_SESSION_COOKIE },
    });
    expect(response.status).toBe(204);
  });

  it('正常系: 保有中の銘柄を204で削除できる', async () => {
    const { repository, state } = createFakePortfolioRepository({
      portfolios: [{ id: 'pf_1', userId: TEST_USER_USER.id, name: 'メインNISA', createdAt: CREATED_AT }],
      holdings: [
        { portfolioId: 'pf_1', companyCode: '7203', quantity: 100, acquisitionPriceSen: 280_000, createdAt: CREATED_AT, updatedAt: CREATED_AT },
      ],
    });
    const app = buildApp(baseDeps({ portfolioRepository: repository }));
    const response = await app.request('/api/portfolios/pf_1/holdings/7203', {
      method: 'DELETE',
      headers: { cookie: TEST_USER_SESSION_COOKIE },
    });
    expect(response.status).toBe(204);
    expect(state.holdings).toHaveLength(0);
  });
});
