import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

import { type Session } from '@/domain/auth/session';
import { type SessionRepository } from '@/domain/auth/session-repository';
import { type User } from '@/domain/auth/user';
import { type UserRepository } from '@/domain/auth/user-repository';
import { type EdinetDocumentIndexLookup } from '@/domain/company/edinet-document-index';
import { type EdinetHistorySource } from '@/domain/company/edinet-history-source';
import { type FinancialSource } from '@/domain/company/financial-source';
import { type MarketDataSource } from '@/domain/company/market-data-source';
import { createApp } from '@/handler/app';
import { WebCryptoPasswordHasher } from '@/infra/auth/webcrypto-password-hasher';
import { WebCryptoSessionTokenGenerator } from '@/infra/auth/webcrypto-session-token-generator';
import { D1CompanyRepository } from '@/infra/d1/company-repository';
import { D1PortfolioRepository } from '@/infra/d1/portfolio-repository';
import { D1SessionRepository } from '@/infra/d1/session-repository';
import { D1UserIndicatorSettingsRepository } from '@/infra/d1/user-indicator-settings-repository';
import { D1UserRepository } from '@/infra/d1/user-repository';
import { WebCryptoPortfolioIdGenerator } from '@/infra/portfolio/webcrypto-portfolio-id-generator';
import type { AnalyzeCompanyRequest, ScoringResponse } from '@/handler/dto/company-input';
import type { IndicatorSettingsResponse } from '@/handler/dto/indicator-settings';

import {
  TEST_ADMIN_SESSION_COOKIE,
  buildAuthTestDependencies,
  fakePasswordHasher,
  fakeSessionTokenGenerator,
} from '../handler/support/build-app-dependencies';

/**
 * handler → usecase → domain → infra(D1) の結線を通しで確認する。
 *
 * 計算そのものは domain 側のテストで尽くしてある。ここで見たいのは
 * **層をまたいだときに値が壊れないか**（銭が丸められない、`null` が 0 にならない、
 * 年度の並びが崩れない）。
 */

const FIXED_NOW = new Date('2026-07-28T00:00:00.000Z');

/** このテストファイルは IRバンク取り込みを対象にしないので、呼ばれたら落とす */
const unusedFinancialSource: FinancialSource = {
  fetchByCode: () => {
    throw new Error('このテストで FinancialSource が呼ばれるのは想定外');
  },
};

/** このテストファイルは Yahoo 取り込みを対象にしないので、呼ばれたら落とす */
const unusedMarketDataSource: MarketDataSource = {
  fetchByCode: () => {
    throw new Error('このテストで MarketDataSource が呼ばれるのは想定外');
  },
};

/** このテストファイルは EDINET 取り込みを対象にしないので、呼ばれたら落とす */
const unusedEdinetHistorySource: EdinetHistorySource = {
  fetchHistory: () => {
    throw new Error('このテストで EdinetHistorySource が呼ばれるのは想定外');
  },
};

const unusedEdinetDocumentIndexLookup: EdinetDocumentIndexLookup = {
  findDocId: () => {
    throw new Error('このテストで EdinetDocumentIndexLookup が呼ばれるのは想定外');
  },
  findLatest: () => {
    throw new Error('このテストで EdinetDocumentIndexLookup が呼ばれるのは想定外');
  },
};

function app() {
  return createApp({
    repository: new D1CompanyRepository(env.DB),
    financialSource: unusedFinancialSource,
    marketDataSource: unusedMarketDataSource,
    edinetHistorySource: unusedEdinetHistorySource,
    edinetDocumentIndexLookup: unusedEdinetDocumentIndexLookup,
    ...buildAuthTestDependencies(),
    portfolioRepository: new D1PortfolioRepository(env.DB),
    portfolioIdGenerator: new WebCryptoPortfolioIdGenerator(),
    now: () => FIXED_NOW,
  });
}

/** ROE 15%（10点）・営業利益率 20%（10点）が5年続く会社 */
function samplePayload(overrides: Partial<AnalyzeCompanyRequest> = {}): AnalyzeCompanyRequest {
  const years = [2025, 2024, 2023, 2022, 2021, 2020];
  return {
    code: '9433',
    name: 'サンプル通信',
    records: [
      {
        fiscalYear: 2026,
        isForecast: true,
        epsSen: 30_000,
        roePercent: null,
        revenueSen: null,
        operatingMarginPercent: null,
      },
      ...years.map((fiscalYear, index) => ({
        fiscalYear,
        isForecast: false,
        // 直近ほど大きい。増配・増収を作る
        epsSen: 30_000 - index * 2_000,
        roePercent: 15,
        revenueSen: 1_000_000_000 - index * 50_000_000,
        operatingMarginPercent: 20,
      })),
    ],
    dividends: [
      { fiscalYear: 2026, kind: 'forecast', annualAmountSen: 6_000 },
      ...years.map((fiscalYear, index) => ({
        fiscalYear,
        kind: 'actual' as const,
        annualAmountSen: 6_000 - index * 400,
      })),
    ],
    balanceSheet: {
      currentAssetsSen: 10_000_000,
      investmentSecuritiesSen: 0,
      totalLiabilitiesSen: 0,
      previousDividendTotalSen: 250_000,
    },
    multiples: { per: 9, perSource: 'manual', pbr: 1, pbrSource: 'manual' },
    // 株価 1,000 円、予想配当 60 円 → 利回り 6.00% → 10点
    priceSen: 100_000,
    ...overrides,
  };
}

/** `POST /api/companies` は `requireRole(['admin'])` で保護される。admin セッションで叩く */
async function post(payload: AnalyzeCompanyRequest) {
  return app().request('/api/companies', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: TEST_ADMIN_SESSION_COOKIE },
    body: JSON.stringify(payload),
  });
}

beforeEach(async () => {
  // テスト間で保存済みデータを持ち越さない
  await env.DB.exec('DELETE FROM portfolio_holdings');
  await env.DB.exec('DELETE FROM portfolios');
  await env.DB.exec('DELETE FROM transformed_metrics');
  await env.DB.exec('DELETE FROM score_cards');
  await env.DB.exec('DELETE FROM dividend_records');
  await env.DB.exec('DELETE FROM financial_records');
  await env.DB.exec('DELETE FROM companies');
  await env.DB.exec('DELETE FROM user_indicator_settings');
  // portfolios.user_id のFK用に実ユーザーを作るテスト（CR-3）があるため、持ち越さない
  await env.DB.exec('DELETE FROM users');
});

describe('POST /api/companies', () => {
  it('採点して保存し、総合点と有効指標数を返す', async () => {
    const response = await post(samplePayload());
    expect(response.status).toBe(201);

    const body = (await response.json()) as ScoringResponse;
    expect(body.metrics).toHaveLength(10);
    expect(body.maxTotalScore).toBe(100);
    expect(body.totalMetricCount).toBe(10);
    expect(body.effectiveMetricCount).toBeGreaterThan(0);
    expect(body.totalScore).toBeLessThanOrEqual(100);
    // 入力日時は注入した時計から来る
    expect(body.fetchedAt).toBe(FIXED_NOW.toISOString());
  });

  it('⑩ は予想配当を採用し、その旨を返す（§2.1）', async () => {
    const body = (await (await post(samplePayload())).json()) as ScoringResponse;
    const dividendYield = body.metrics.find((metric) => metric.key === 'dividendYield');
    expect(body.dividendSource).toBe('forecast');
    // 60円 / 1000円 = 6.00% → 1/100% 単位で 600
    expect(dividendYield?.value).toBe(600);
    expect(dividendYield?.score).toBe(10);
  });

  it('⑤ ROE 15% は 10点、⑧ 営業利益率 20% は 10点', async () => {
    const body = (await (await post(samplePayload())).json()) as ScoringResponse;
    expect(body.metrics.find((metric) => metric.key === 'roeAverage')?.score).toBe(10);
    expect(body.metrics.find((metric) => metric.key === 'operatingMargin')?.score).toBe(10);
  });

  it('判定不能の指標は score も value も null で返る。0 にしない（§0.5）', async () => {
    const payload = samplePayload({
      multiples: { per: null, perSource: null, pbr: null, pbrSource: null },
    });
    const body = (await (await post(payload)).json()) as ScoringResponse;
    const mix = body.metrics.find((metric) => metric.key === 'mixCoefficient');
    expect(mix?.score).toBeNull();
    expect(mix?.value).toBeNull();
    expect(mix?.unavailableReason).toBe('input-missing');
  });

  it('銭が丸められずに往復する', async () => {
    // 1 銭差で利回りの区分が変わる境界を通す
    const payload = samplePayload({ priceSen: 100_001 });
    const body = (await (await post(payload)).json()) as ScoringResponse;
    expect(body.metrics.find((metric) => metric.key === 'dividendYield')?.value).toBe(600);
    expect(body.priceSen).toBe(100_001);

    const stored = await env.DB.prepare('SELECT price_sen FROM companies WHERE code = ?')
      .bind('9433')
      .first<{ price_sen: number }>();
    expect(stored?.price_sen).toBe(100_001);
  });

  it('priceSen/per/pbr が採点結果に数値のまま返る（ブロッカー解消計画 §5.3）', async () => {
    const postBody = (await (await post(samplePayload())).json()) as ScoringResponse;
    expect(postBody.priceSen).toBe(100_000);
    expect(postBody.per).toBe(9);
    expect(postBody.pbr).toBe(1);

    // GET 側（再採点後）でも同じ値が返ることを確認する
    const getBody = (await (await app().request('/api/companies/9433')).json()) as ScoringResponse;
    expect(getBody.priceSen).toBe(100_000);
    expect(getBody.per).toBe(9);
    expect(getBody.pbr).toBe(1);
  });

  it('⑨ PER/PBR の出所が D1 を往復し、詳細取得の応答にも出る（2026-07-29 追加）', async () => {
    await post(
      samplePayload({
        multiples: { per: 9, perSource: 'forecast-eps', pbr: 1, pbrSource: 'actual-bps' },
      }),
    );

    const stored = await env.DB.prepare(
      'SELECT per_source, pbr_source FROM companies WHERE code = ?',
    )
      .bind('9433')
      .first<{ per_source: string; pbr_source: string }>();
    expect(stored?.per_source).toBe('forecast-eps');
    expect(stored?.pbr_source).toBe('actual-bps');

    const body = (await (await app().request('/api/companies/9433')).json()) as ScoringResponse;
    expect(body.perSource).toBe('forecast-eps');
    expect(body.pbrSource).toBe('actual-bps');
  });

  it('PER/PBR が null なら出所も null（データなしと混同しない）', async () => {
    const payload = samplePayload({
      multiples: { per: null, perSource: null, pbr: null, pbrSource: null },
    });
    const body = (await (await post(payload)).json()) as ScoringResponse;
    expect(body.perSource).toBeNull();
    expect(body.pbrSource).toBeNull();
    expect(body.per).toBeNull();
    expect(body.pbr).toBeNull();
  });

  it('priceSen が未入力（null）なら null のまま返る。0 にしない（境界値）', async () => {
    const payload = samplePayload({ priceSen: null });
    const body = (await (await post(payload)).json()) as ScoringResponse;
    expect(body.priceSen).toBeNull();
  });

  it('入力が不正なら 400。内部情報は返さない', async () => {
    const response = await app().request('/api/companies', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: TEST_ADMIN_SESSION_COOKIE },
      body: JSON.stringify({ code: 'あ', name: '' }),
    });
    expect(response.status).toBe(400);

    const body = (await response.json()) as { error: string; issues: unknown[] };
    expect(body.error).toContain('入力が不正');
    expect(JSON.stringify(body)).not.toMatch(/SELECT|INSERT|node_modules|\.ts:/);
  });

  it('株価が業務上限（1株 1,000,000 円）を超えたら 400', async () => {
    const response = await post(samplePayload({ priceSen: 100_000_001 }));
    expect(response.status).toBe(400);
  });

  it('同じ銘柄を2回送っても行が重複しない（自然キーの UNIQUE が効く）', async () => {
    await post(samplePayload());
    await post(samplePayload({ name: 'サンプル通信（更新後）' }));

    const companies = await env.DB.prepare('SELECT COUNT(*) AS count FROM companies').first<{
      count: number;
    }>();
    const records = await env.DB.prepare('SELECT COUNT(*) AS count FROM financial_records').first<{
      count: number;
    }>();
    expect(companies?.count).toBe(1);
    expect(records?.count).toBe(7);
  });

  it('整形指標を計算バージョン付きで保存する（再監査用）', async () => {
    await post(samplePayload());
    const card = await env.DB.prepare('SELECT calc_version, total_score FROM score_cards').first<{
      calc_version: string;
      total_score: number;
    }>();
    expect(card?.calc_version).toBeTruthy();

    const metrics = await env.DB.prepare(
      'SELECT COUNT(*) AS count FROM transformed_metrics',
    ).first<{
      count: number;
    }>();
    expect(metrics?.count).toBe(10);
  });
});

/**
 * ③ 予想配当性向のソース切替（`useActualForScoring`。設計書 §5.1・§7）の結線確認。
 * 判定そのものは domain/usecase 側のテストで尽くしてある。ここでは
 * POST ボディ・GET クエリの両経路でフラグが usecase まで届くことだけを見る。
 *
 * `samplePayload()` の予想EPSを 20,000銭・予想配当を 5,000銭に上書きして性向 25%
 * （9点）にし、最新実績年度（2025）の配当を 9,000銭に上書きして実績EPS 30,000銭との
 * 性向を 30%（8点）にする。予想・実績で区分（点数）が変わるようにして、
 * `payoutRatioSource` の切り替わりが採点結果にも反映されることを確認する。
 */
function payoutRatioSamplePayload(
  overrides: Partial<AnalyzeCompanyRequest> = {},
): AnalyzeCompanyRequest {
  const base = samplePayload();
  return {
    ...base,
    records: [
      {
        fiscalYear: 2026,
        isForecast: true,
        epsSen: 20_000,
        roePercent: null,
        revenueSen: null,
        operatingMarginPercent: null,
      },
      ...base.records.filter((r) => !r.isForecast),
    ],
    dividends: [
      { fiscalYear: 2026, kind: 'forecast', annualAmountSen: 5_000 },
      { fiscalYear: 2025, kind: 'actual', annualAmountSen: 9_000 },
      ...base.dividends.filter((d) => d.fiscalYear !== 2025 && d.fiscalYear !== 2026),
    ],
    ...overrides,
  };
}

const NON_ADMIN_USER_ID = 2;
const NON_ADMIN_SESSION_ID = 'test-user-session-id';
const NON_ADMIN_SESSION_COOKIE = `session_id=${NON_ADMIN_SESSION_ID}`;

const nonAdminUser: User = {
  id: NON_ADMIN_USER_ID,
  email: 'user@example.com',
  passwordHash: 'unused',
  passwordSalt: 'unused',
  passwordIterations: 10_000,
  role: 'user',
  failedLoginCount: 0,
  lockedUntil: null,
  createdAt: '2026-01-01T00:00:00.000Z',
};

const nonAdminUserRepository: UserRepository = {
  findByEmail: () => Promise.resolve(null),
  findById: (id) => Promise.resolve(id === NON_ADMIN_USER_ID ? nonAdminUser : null),
  count: () => Promise.resolve(2),
  insert: () => {
    throw new Error('このテストで UserRepository.insert が呼ばれるのは想定外');
  },
  updateLoginAttempt: () => Promise.resolve(),
  updatePasswordHash: () => Promise.resolve(),
};

const nonAdminSessionRepository: SessionRepository = {
  insert: () => Promise.resolve(),
  findById: (id) =>
    Promise.resolve(
      id === NON_ADMIN_SESSION_ID
        ? ({
            id: NON_ADMIN_SESSION_ID,
            userId: NON_ADMIN_USER_ID,
            expiresAt: '2099-01-01T00:00:00.000Z',
            createdAt: '2026-01-01T00:00:00.000Z',
          } satisfies Session)
        : null,
    ),
  deleteById: () => Promise.resolve(),
};

/**
 * `role: 'user'` のセッションを持つ app（`requireRole(['admin'])` の 403 経路の確認用）。
 * `docs/02_design/ui/screen-list.md` §2「保護は API 側でも必ず行う」・
 * ADR-0013 制約1（現状、銘柄の登録・更新・削除は誰でも実行できる）の解消確認（T-091計画 §4.5・§7）。
 */
function appWithNonAdminSession() {
  return createApp({
    repository: new D1CompanyRepository(env.DB),
    userIndicatorSettingsRepository: new D1UserIndicatorSettingsRepository(env.DB),
    portfolioRepository: new D1PortfolioRepository(env.DB),
    portfolioIdGenerator: new WebCryptoPortfolioIdGenerator(),
    financialSource: unusedFinancialSource,
    marketDataSource: unusedMarketDataSource,
    edinetHistorySource: unusedEdinetHistorySource,
    edinetDocumentIndexLookup: unusedEdinetDocumentIndexLookup,
    userRepository: nonAdminUserRepository,
    sessionRepository: nonAdminSessionRepository,
    passwordHasher: fakePasswordHasher(),
    sessionTokenGenerator: fakeSessionTokenGenerator(),
    signupEnabled: false,
    maxUsers: 0,
    cookieSecure: true,
    now: () => FIXED_NOW,
  });
}

describe('POST/DELETE /api/companies — ロールガード（admin限定）', () => {
  it('POST: 未ログイン（Cookie無し）は401', async () => {
    const response = await appWithNonAdminSession().request('/api/companies', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(samplePayload()),
    });
    expect(response.status).toBe(401);
  });

  it('POST: role=user は403（adminではない）', async () => {
    const response = await appWithNonAdminSession().request('/api/companies', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: NON_ADMIN_SESSION_COOKIE,
      },
      body: JSON.stringify(samplePayload()),
    });
    expect(response.status).toBe(403);
  });

  it('POST: role=admin は通過する（201）', async () => {
    const response = await post(samplePayload());
    expect(response.status).toBe(201);
  });

  it('DELETE: role=user は403', async () => {
    await post(samplePayload());
    const response = await appWithNonAdminSession().request('/api/companies/9433', {
      method: 'DELETE',
      headers: { cookie: NON_ADMIN_SESSION_COOKIE },
    });
    expect(response.status).toBe(403);
  });
});

describe('POST /api/companies — useActualForScoring', () => {
  it('未指定なら予想を採用する（既定 false）', async () => {
    const body = (await (await post(payoutRatioSamplePayload())).json()) as ScoringResponse;
    // 5,000銭 ÷ 20,000銭 = 25% → 9点
    expect(body.payoutRatioSource).toBe('forecast');
    expect(body.metrics.find((m) => m.key === 'payoutRatio')?.score).toBe(9);
  });

  it('true を渡すと実績を強制採用する', async () => {
    const body = (await (
      await post(payoutRatioSamplePayload({ useActualForScoring: true }))
    ).json()) as ScoringResponse;
    // 9,000銭 ÷ 30,000銭 = 30% → 8点。予想の25%（9点）とは別区分になる
    expect(body.payoutRatioSource).toBe('actual');
    expect(body.metrics.find((m) => m.key === 'payoutRatio')?.score).toBe(8);
  });
});

describe('GET /api/companies/:code — useActualForScoring', () => {
  it('?useActualForScoring=true クエリで実績を強制採用できる', async () => {
    await post(payoutRatioSamplePayload());

    const withActual = (await (
      await app().request('/api/companies/9433?useActualForScoring=true')
    ).json()) as ScoringResponse;
    expect(withActual.payoutRatioSource).toBe('actual');

    const withoutActual = (await (
      await app().request('/api/companies/9433')
    ).json()) as ScoringResponse;
    expect(withoutActual.payoutRatioSource).toBe('forecast');
  });

  it('不正なクエリ値（true/false 以外）は 400', async () => {
    await post(payoutRatioSamplePayload());
    const response = await app().request('/api/companies/9433?useActualForScoring=abc');
    expect(response.status).toBe(400);
  });
});

describe('GET /api/companies', () => {
  it('保存済みの一覧を返す', async () => {
    await post(samplePayload());
    const response = await app().request('/api/companies');
    expect(response.status).toBe(200);

    const body = (await response.json()) as { companies: { code: string; totalScore: number }[] };
    expect(body.companies).toHaveLength(1);
    expect(body.companies[0]?.code).toBe('9433');
  });

  it('空でも 200 と空配列を返す', async () => {
    const body = (await (await app().request('/api/companies')).json()) as { companies: unknown[] };
    expect(body.companies).toEqual([]);
  });

  /**
   * 検索・ソート・サーバサイドページング（T-093。`docs/02_design/api/company-api.md`
   * §GET /api/companies）。JOIN・ORDER BY・LIMIT/OFFSET そのものの網羅は
   * `tests/integration/company-list-search.test.ts`（実D1、リポジトリ直叩き）で行う。
   * ここでは **handler → usecase → infra の結線**（POST で保存 → GET で検索できるか）だけを見る。
   */
  it('page/perPage/total を応答に同梱する', async () => {
    await post(samplePayload());
    const response = await app().request('/api/companies');
    expect(response.status).toBe(200);

    const body = (await response.json()) as { page: number; perPage: number; total: number };
    expect(body.page).toBe(1);
    expect(body.perPage).toBe(15);
    expect(body.total).toBe(1);
  });

  it('q（銘柄コード・銘柄名の部分一致）で絞り込める', async () => {
    await post(samplePayload());
    await post(samplePayload({ code: '7203', name: 'トヨタ自動車' }));

    const response = await app().request('/api/companies?q=トヨタ');
    const body = (await response.json()) as { companies: { code: string }[]; total: number };
    expect(body.companies.map((c) => c.code)).toEqual(['7203']);
    expect(body.total).toBe(1);
  });

  it('未知の sort・範囲外の page/perPage は 400 にならず既定値へ丸まる', async () => {
    await post(samplePayload());
    const response = await app().request('/api/companies?sort=unknown&page=0&perPage=9999');
    expect(response.status).toBe(200);

    const body = (await response.json()) as { page: number; perPage: number };
    expect(body.page).toBe(1);
    expect(body.perPage).toBe(15);
  });
});

describe('GET /api/companies/:code', () => {
  it('保存済みの生データから採点し直して返す', async () => {
    const posted = (await (await post(samplePayload())).json()) as ScoringResponse;
    const response = await app().request('/api/companies/9433');
    expect(response.status).toBe(200);

    const body = (await response.json()) as ScoringResponse;
    // 保存→読み出しで値が変わらない（銭も年度の並びも壊れていない）
    expect(body.totalScore).toBe(posted.totalScore);
    expect(body.metrics).toEqual(posted.metrics);
  });

  it('未保存の銘柄は 404', async () => {
    const response = await app().request('/api/companies/1234');
    expect(response.status).toBe(404);
  });

  it('コードの形式が不正なら 400', async () => {
    const response = await app().request('/api/companies/abc');
    expect(response.status).toBe(400);
  });
});

/**
 * handler → usecase → domain → infra(D1) の結線確認（①配当推移の折れ線グラフ・
 * ②連続非減配年数のリストが使う）。年度別集約の境界値（優先順位の総当り等）は
 * `tests/domain/company/dividend-record.test.ts` で尽くしてあるので、ここでは
 * **層をまたいだときに順序・優先順位が壊れないか**だけを見る。
 */
describe('GET /api/companies/:code/dividends', () => {
  it('200: 保存済みの配当履歴を年度昇順で返す。予想年だけ isForecast: true', async () => {
    // samplePayload(): 2020〜2025 実績 + 2026 予想
    await post(samplePayload());
    const response = await app().request('/api/companies/9433/dividends');
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      dividends: { fiscalYear: number; amountSen: number | null; isForecast: boolean }[];
    };
    expect(body.dividends.map((d) => d.fiscalYear)).toEqual([
      2020, 2021, 2022, 2023, 2024, 2025, 2026,
    ]);
    expect(
      body.dividends.every((d) => (d.fiscalYear === 2026 ? d.isForecast : !d.isForecast)),
    ).toBe(true);
  });

  it('未保存コードは 404', async () => {
    const response = await app().request('/api/companies/1234/dividends');
    expect(response.status).toBe(404);
  });

  it('コード形式が不正なら 400', async () => {
    const response = await app().request('/api/companies/abc/dividends');
    expect(response.status).toBe(400);
  });

  it('同一年度に forecast と actual が混在しても actual を採用する（層をまたいでも優先順位が壊れない）', async () => {
    const payload = samplePayload({
      dividends: [
        { fiscalYear: 2025, kind: 'forecast', annualAmountSen: 9_999 },
        { fiscalYear: 2025, kind: 'actual', annualAmountSen: 6_000 },
        { fiscalYear: 2024, kind: 'actual', annualAmountSen: 5_600 },
      ],
    });
    await post(payload);
    const response = await app().request('/api/companies/9433/dividends');
    const body = (await response.json()) as {
      dividends: { fiscalYear: number; amountSen: number | null; isForecast: boolean }[];
    };

    const fy2025 = body.dividends.find((d) => d.fiscalYear === 2025);
    expect(fy2025).toEqual({ fiscalYear: 2025, amountSen: 6_000, isForecast: false });
  });
});

describe('DELETE /api/companies/:code', () => {
  it('削除すると一覧からも明細からも消える', async () => {
    await post(samplePayload());
    const response = await app().request('/api/companies/9433', {
      method: 'DELETE',
      headers: { cookie: TEST_ADMIN_SESSION_COOKIE },
    });
    expect(response.status).toBe(204);

    const remaining = await env.DB.prepare(
      'SELECT COUNT(*) AS count FROM financial_records',
    ).first<{
      count: number;
    }>();
    expect(remaining?.count).toBe(0);
    expect((await app().request('/api/companies/9433')).status).toBe(404);
  });

  it('保有されているポートフォリオがある場合は409で削除を拒否する（CR-3: 実D1結線確認）', async () => {
    await post(samplePayload());
    // portfolios.user_id は users.id への外部キー。`buildAuthTestDependencies()` の
    // ユーザーはインメモリのフェイクで D1 には無いため、FK制約を満たす実ユーザーを1件作る
    const userRepository = new D1UserRepository(env.DB);
    const insertedUser = await userRepository.insert({
      email: 'portfolio-owner@example.com',
      passwordHash: 'unused',
      passwordSalt: 'unused',
      passwordIterations: 10_000,
      role: 'user',
      createdAt: '2026-07-28T00:00:00.000Z',
    });
    if (!insertedUser.ok) throw new Error('setup failed: user insert');

    const portfolioRepository = new D1PortfolioRepository(env.DB);
    const inserted = await portfolioRepository.insert({
      id: 'pf_1',
      userId: insertedUser.value.id,
      name: 'メインNISA',
      createdAt: '2026-07-28T00:00:00.000Z',
    });
    if (!inserted.ok) throw new Error('setup failed: portfolio insert');
    await portfolioRepository.insertHolding({
      portfolioId: 'pf_1',
      companyCode: '9433',
      quantity: 100,
      acquisitionPriceSen: 100_000,
      createdAt: '2026-07-28T00:00:00.000Z',
      updatedAt: '2026-07-28T00:00:00.000Z',
    });

    const response = await app().request('/api/companies/9433', {
      method: 'DELETE',
      headers: { cookie: TEST_ADMIN_SESSION_COOKIE },
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: 'この銘柄は誰かのポートフォリオに保有されているため削除できません',
    });

    const remaining = await env.DB.prepare(
      'SELECT COUNT(*) AS count FROM companies WHERE code = ?',
    )
      .bind('9433')
      .first<{ count: number }>();
    expect(remaining?.count).toBe(1);
  });
});

describe('GET /api/health', () => {
  it('疎通確認に使える', async () => {
    const response = await app().request('/api/health');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
  });
});

/**
 * `AppDependencies` に `marketDataSource` を追加したことによる結線の回帰確認。
 * **実ネットワークは叩かない**（`.claude/rules/backend.md`）。スタブを注入するだけ。
 * 計算そのものは `tests/domain/company/dividend-fiscal-year.test.ts` /
 * `tests/handler/market-data-import.test.ts` で尽くしてある。
 */
describe('GET /api/market-data/:code', () => {
  function appWithMarketData(marketDataSource: MarketDataSource) {
    return createApp({
      repository: new D1CompanyRepository(env.DB),
      financialSource: unusedFinancialSource,
      marketDataSource,
      edinetHistorySource: unusedEdinetHistorySource,
      edinetDocumentIndexLookup: unusedEdinetDocumentIndexLookup,
      ...buildAuthTestDependencies(),
      now: () => FIXED_NOW,
    });
  }

  it('結線されている。スタブの結果がそのまま応答に出る', async () => {
    const stub: MarketDataSource = {
      fetchByCode: () =>
        Promise.resolve({
          ok: true,
          value: {
            code: '9433',
            name: 'KDDI Corporation',
            priceSen: 290_300,
            priceAsOf: '2026-08-03T06:30:00.000Z',
            dividendPayments: [],
            splits: [],
            diagnostics: [],
          },
        }),
    };
    // admin限定（T-107）。ロールガード自体は tests/handler/market-data-import.test.ts で尽くす
    const response = await appWithMarketData(stub).request('/api/market-data/9433', {
      headers: { cookie: TEST_ADMIN_SESSION_COOKIE },
    });
    expect(response.status).toBe(200);

    const body = (await response.json()) as { code: string; dividendAggregated: boolean };
    expect(body.code).toBe('9433');
    // fiscalYearEndMonth 未指定なので集計は行われない
    expect(body.dividendAggregated).toBe(false);
  });

  it('保存しない。リポジトリに一切触れない', async () => {
    const stub: MarketDataSource = {
      fetchByCode: () =>
        Promise.resolve({
          ok: true,
          value: {
            code: '9433',
            name: null,
            priceSen: null,
            priceAsOf: null,
            dividendPayments: [],
            splits: [],
            diagnostics: [],
          },
        }),
    };
    const before = await env.DB.prepare('SELECT COUNT(*) AS count FROM companies').first<{
      count: number;
    }>();
    await appWithMarketData(stub).request('/api/market-data/9433', {
      headers: { cookie: TEST_ADMIN_SESSION_COOKIE },
    });
    const after = await env.DB.prepare('SELECT COUNT(*) AS count FROM companies').first<{
      count: number;
    }>();
    expect(after?.count).toBe(before?.count);
  });
});

/**
 * 指標カスタマイズ（T-101）の結合シナリオ。**実 D1・実セッションで通しに検証する**
 * （`auth-flow.test.ts` と同じ「フェイクを使わない」方針）。
 *
 * `role: 'admin'` のユーザーで検証する。最初の signup が admin になる仕様
 * （ADR-0013 §決定2）のため、role の違いは `tests/handler/indicator-settings-routes.test.ts`
 * （フェイク・role='user' で 200 になることを確認）でカバーする。ここで見たいのは
 * 「GET → PUT → GET → GET /api/companies/:code」という層をまたいだ結線が壊れないこと。
 */
describe('指標カスタマイズ: GET/PUT /api/indicator-settings、GET /api/companies/:code への反映', () => {
  function appWithRealAuth() {
    return createApp({
      repository: new D1CompanyRepository(env.DB),
      userIndicatorSettingsRepository: new D1UserIndicatorSettingsRepository(env.DB),
      portfolioRepository: new D1PortfolioRepository(env.DB),
      portfolioIdGenerator: new WebCryptoPortfolioIdGenerator(),
      financialSource: unusedFinancialSource,
      marketDataSource: unusedMarketDataSource,
      edinetHistorySource: unusedEdinetHistorySource,
      edinetDocumentIndexLookup: unusedEdinetDocumentIndexLookup,
      userRepository: new D1UserRepository(env.DB),
      sessionRepository: new D1SessionRepository(env.DB),
      passwordHasher: new WebCryptoPasswordHasher(),
      sessionTokenGenerator: new WebCryptoSessionTokenGenerator(),
      signupEnabled: true,
      maxUsers: 5,
      cookieSecure: true,
      now: () => FIXED_NOW,
    });
  }

  function extractSessionCookie(response: Response): string {
    const setCookie = response.headers.get('set-cookie');
    expect(setCookie).toBeTruthy();
    const match = setCookie?.match(/session_id=[^;]+/);
    expect(match).not.toBeNull();
    return match![0];
  }

  async function signUp(email: string): Promise<string> {
    const response = await appWithRealAuth().request('/api/auth/signup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'correct-horse-battery' }),
    });
    expect(response.status).toBe(201);
    return extractSessionCookie(response);
  }

  beforeEach(async () => {
    // このdescribe専用のテーブルは、他のdescribeのbeforeEachでは掃除していない
    await env.DB.exec('DELETE FROM sessions');
    await env.DB.exec('DELETE FROM users');
  });

  it('GET: 未ログイン（Cookie無し）は401', async () => {
    const response = await appWithRealAuth().request('/api/indicator-settings');
    expect(response.status).toBe(401);
  });

  it('GET: 未設定ユーザーは全10指標選択・デフォルト基準値相当を返す（404にしない）', async () => {
    const cookie = await signUp('t101-get-default@example.com');
    const response = await appWithRealAuth().request('/api/indicator-settings', {
      headers: { cookie },
    });
    expect(response.status).toBe(200);

    const body = (await response.json()) as IndicatorSettingsResponse;
    expect(body.selected).toHaveLength(10);
    // ⑩配当利回りのデフォルト基準値は `%` 小数（5.5%）。DBと同じ単位系（BE計画 §4）
    expect(body.basisValues.dividendYield).toBe(5.5);
    // ⑨MIX係数は設定不可なので basisValues に現れない
    expect((body.basisValues as Record<string, number | undefined>)['mixCoefficient']).toBeUndefined();
  });

  it('PUT → GET で保存内容が往復する。5指標に絞ると GET /api/companies/:code の満点も50になる', async () => {
    const cookie = await signUp('t101-put-get@example.com');

    const putResponse = await appWithRealAuth().request('/api/indicator-settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        selected: [
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
      }),
    });
    expect(putResponse.status).toBe(200);

    const getResponse = await appWithRealAuth().request('/api/indicator-settings', {
      headers: { cookie },
    });
    const body = (await getResponse.json()) as IndicatorSettingsResponse;
    expect([...body.selected].sort()).toEqual(
      [
        'dividendGrowthRate',
        'consecutiveYears',
        'roeAverage',
        'operatingMargin',
        'dividendYield',
      ].sort(),
    );
    expect(body.basisValues.dividendYield).toBe(4);

    // 会社を登録し、ログインユーザーの権限で採点する（admin=このセッションのユーザー）
    const postResponse = await appWithRealAuth().request('/api/companies', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify(samplePayload()),
    });
    expect(postResponse.status).toBe(201);

    const scoring = (await (
      await appWithRealAuth().request('/api/companies/9433', { headers: { cookie } })
    ).json()) as ScoringResponse;
    expect(scoring.maxTotalScore).toBe(50);
    expect(scoring.totalMetricCount).toBe(5);

    // 同じ会社を無認証（ゲスト）で見ると、常に全10指標・満点100のまま
    const guestScoring = (await (
      await appWithRealAuth().request('/api/companies/9433')
    ).json()) as ScoringResponse;
    expect(guestScoring.maxTotalScore).toBe(100);
    expect(guestScoring.totalMetricCount).toBe(10);
  });

  it('PUT: 選択件数が4件（5未満）は400', async () => {
    const cookie = await signUp('t101-too-few@example.com');
    const response = await appWithRealAuth().request('/api/indicator-settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        selected: ['dividendGrowthRate', 'consecutiveYears', 'roeAverage', 'operatingMargin'],
        basisValues: {
          dividendGrowthRate: 20,
          consecutiveYears: 10,
          roeAverage: 10,
          operatingMargin: 15,
        },
      }),
    });
    expect(response.status).toBe(400);
  });

  it('PUT: ⑨MIX係数に基準値を指定すると400（専用メッセージ）', async () => {
    const cookie = await signUp('t101-mix-basis@example.com');
    const response = await appWithRealAuth().request('/api/indicator-settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        selected: [
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
          mixCoefficient: 1,
        },
      }),
    });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe('MIX係数の基準値は指定できません');
  });
});
