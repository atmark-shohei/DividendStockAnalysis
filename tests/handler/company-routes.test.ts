import { describe, expect, it } from 'vitest';

import { type Company } from '@/domain/company/company';
import {
  type CompanyListResult,
  type CompanyRepository,
} from '@/domain/company/company-repository';
import { type UserIndicatorSettings } from '@/domain/scoring/user-indicator-settings';
import { type UserIndicatorSettingsRepository } from '@/domain/scoring/user-indicator-settings-repository';
import { type EdinetDocumentIndexLookup } from '@/domain/company/edinet-document-index';
import { type EdinetHistorySource } from '@/domain/company/edinet-history-source';
import { type FinancialSource } from '@/domain/company/financial-source';
import { type MarketDataSource } from '@/domain/company/market-data-source';
import { createApp } from '@/handler/app';
import type { ScoringResponse } from '@/handler/dto/company-input';

import {
  TEST_USER_SESSION_COOKIE,
  TEST_USER_USER,
  fakePasswordHasher,
  fakeSessionRepository,
  fakeSessionTokenGenerator,
  fakeUserRepository,
} from './support/build-app-dependencies';

/**
 * `GET /api/companies/:code` — 指標カスタマイズ（T-101）のユーザー設定反映の結線テスト。
 *
 * 「無認証でも閲覧できる既存仕様を変えない」「ログイン中ユーザーの設定を反映する」を
 * `resolveOptionalUser`/`getCompanyScoring` の結線として確認する。採点そのものの
 * 計算は `tests/usecase/score-company.test.ts` / domain 側テストで尽くしてある。
 */

function unusedFinancialSource(): FinancialSource {
  return {
    fetchByCode: (): never => {
      throw new Error('このテストで FinancialSource が呼ばれるのは想定外');
    },
  };
}

function unusedMarketDataSource(): MarketDataSource {
  return {
    fetchByCode: (): never => {
      throw new Error('このテストで MarketDataSource が呼ばれるのは想定外');
    },
  };
}

function unusedEdinetHistorySource(): EdinetHistorySource {
  return {
    fetchHistory: (): never => {
      throw new Error('このテストで EdinetHistorySource が呼ばれるのは想定外');
    },
  };
}

function unusedEdinetDocumentIndexLookup(): EdinetDocumentIndexLookup {
  const fail = (): never => {
    throw new Error('このテストで EdinetDocumentIndexLookup が呼ばれるのは想定外');
  };
  return { findDocId: fail, findLatest: fail };
}

/** 6年ぶん配当が毎年2倍に増える会社。① は常に10点になる土台 */
const SAMPLE_COMPANY: Company = {
  code: '9433',
  name: 'テスト通信',
  records: [2025, 2024, 2023, 2022, 2021, 2020].map((fiscalYear) => ({
    fiscalYear,
    isForecast: false,
    epsSen: 10_000,
    roePercent: 15,
    revenueSen: 1_000_000,
    operatingMarginPercent: 20,
  })),
  dividends: [2025, 2024, 2023, 2022, 2021, 2020].map((fiscalYear) => ({
    fiscalYear,
    kind: 'actual' as const,
    annualAmountSen: 6_400 / 2 ** (2025 - fiscalYear),
  })),
  balanceSheet: {
    currentAssetsSen: null,
    investmentSecuritiesSen: null,
    totalLiabilitiesSen: null,
    previousDividendTotalSen: null,
  },
  multiples: { per: null, perSource: null, pbr: null, pbrSource: null },
  priceSen: null,
  fetchedAt: '2026-07-28T00:00:00.000Z',
  epsHistoryRestated: false,
  revenueHistoryRestated: false,
};

function fakeCompanyRepository(): CompanyRepository {
  const fail = (): never => {
    throw new Error('このテストで CompanyRepository の想定外メソッドが呼ばれた');
  };
  return {
    save: (): Promise<void> => fail(),
    findByCode: (code: string): Promise<Company | null> =>
      Promise.resolve(code === SAMPLE_COMPANY.code ? SAMPLE_COMPANY : null),
    listSummaries: (): Promise<CompanyListResult> => fail(),
    deleteByCode: (): Promise<void> => fail(),
    listFiscalYearEndMonths: (): Promise<readonly number[]> => fail(),
  };
}

function fakeUserIndicatorSettingsRepository(
  settingsByUserId: Readonly<Record<number, UserIndicatorSettings>>,
): UserIndicatorSettingsRepository {
  return {
    findByUserId: (userId: number) => Promise.resolve(settingsByUserId[userId] ?? null),
    replaceAll: (): Promise<void> => {
      throw new Error('このテストで replaceAll が呼ばれるのは想定外');
    },
  };
}

function app(userIndicatorSettingsRepository: UserIndicatorSettingsRepository) {
  return createApp({
    repository: fakeCompanyRepository(),
    userIndicatorSettingsRepository,
    financialSource: unusedFinancialSource(),
    marketDataSource: unusedMarketDataSource(),
    edinetHistorySource: unusedEdinetHistorySource(),
    edinetDocumentIndexLookup: unusedEdinetDocumentIndexLookup(),
    userRepository: fakeUserRepository(),
    sessionRepository: fakeSessionRepository(),
    passwordHasher: fakePasswordHasher(),
    sessionTokenGenerator: fakeSessionTokenGenerator(),
    signupEnabled: false,
    maxUsers: 0,
    cookieSecure: true,
    now: () => new Date('2026-08-22T00:00:00.000Z'),
  });
}

describe('GET /api/companies/:code — 指標カスタマイズの反映（T-101）', () => {
  it('ゲスト（Cookie無し）は常に全10指標・満点100で採点する', async () => {
    const repository = fakeUserIndicatorSettingsRepository({});
    const response = await app(repository).request('/api/companies/9433');
    expect(response.status).toBe(200);

    const body = (await response.json()) as ScoringResponse;
    expect(body.maxTotalScore).toBe(100);
    expect(body.totalMetricCount).toBe(10);
  });

  it('未設定ユーザーはログイン済みでもゲストと同じ全10指標・満点100', async () => {
    const repository = fakeUserIndicatorSettingsRepository({});
    const response = await app(repository).request('/api/companies/9433', {
      headers: { cookie: TEST_USER_SESSION_COOKIE },
    });
    const body = (await response.json()) as ScoringResponse;
    expect(body.maxTotalScore).toBe(100);
    expect(body.totalMetricCount).toBe(10);
  });

  it('カスタム設定を持つログイン済みユーザーは、選択指標数に応じて満点が変わる', async () => {
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
    const repository = fakeUserIndicatorSettingsRepository({ [TEST_USER_USER.id]: settings });

    const response = await app(repository).request('/api/companies/9433', {
      headers: { cookie: TEST_USER_SESSION_COOKIE },
    });
    const body = (await response.json()) as ScoringResponse;
    expect(body.maxTotalScore).toBe(50);
    expect(body.totalMetricCount).toBe(5);
    expect(body.metrics.find((m) => m.key === 'dividendGrowthRate')?.score).toBe(10);
  });

  it('不正なセッションCookieは401にならず、ゲスト扱いで200を返す（既存の無認証閲覧仕様を変えない）', async () => {
    const repository = fakeUserIndicatorSettingsRepository({});
    const response = await app(repository).request('/api/companies/9433', {
      headers: { cookie: 'session_id=no-such-session' },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as ScoringResponse;
    expect(body.maxTotalScore).toBe(100);
  });

  it('存在しない銘柄は404（従来どおり）', async () => {
    const repository = fakeUserIndicatorSettingsRepository({});
    const response = await app(repository).request('/api/companies/0000');
    expect(response.status).toBe(404);
  });
});
