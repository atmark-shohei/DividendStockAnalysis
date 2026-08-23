import { describe, expect, it } from 'vitest';

import { type Company } from '@/domain/company/company';
import { type CompanyListResult, type CompanyRepository } from '@/domain/company/company-repository';
import { MAX_HOLDINGS_PER_PORTFOLIO } from '@/domain/portfolio/portfolio';
import { type PortfolioHoldingRecord } from '@/domain/portfolio/portfolio-holding';
import { addHolding } from '@/usecase/add-holding';
import { createFakePortfolioRepository } from './support/fake-portfolio-repository';

const NOW = () => new Date('2026-08-23T00:00:00.000Z');

function unimplemented(name: string): never {
  throw new Error(`このテストで ${name} が呼ばれるのは想定外`);
}

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
  fetchedAt: NOW().toISOString(),
  epsHistoryRestated: false,
  revenueHistoryRestated: false,
};

function fakeCompanyRepository(companies: Readonly<Record<string, Company>>): CompanyRepository {
  return {
    save: (): Promise<void> => unimplemented('CompanyRepository.save'),
    findByCode: (code: string): Promise<Company | null> =>
      Promise.resolve(companies[code] ?? null),
    listSummaries: (): Promise<CompanyListResult> => unimplemented('CompanyRepository.listSummaries'),
    deleteByCode: (): Promise<void> => unimplemented('CompanyRepository.deleteByCode'),
    listFiscalYearEndMonths: (): Promise<readonly number[]> =>
      unimplemented('CompanyRepository.listFiscalYearEndMonths'),
  };
}

/**
 * `addHolding`（POST /api/portfolios/:id/holdings。T-103）。
 * ①ポートフォリオ所有権②銘柄存在③重複④上限、の順にエラーを検証する。
 */
describe('addHolding', () => {
  it('portfolio-not-found: 他ユーザーのポートフォリオIDは404相当', async () => {
    const { repository: portfolioRepository } = createFakePortfolioRepository({
      portfolios: [{ id: 'pf_1', userId: 2, name: '他ユーザー', createdAt: NOW().toISOString() }],
    });
    const companyRepository = fakeCompanyRepository({ '7203': SAMPLE_COMPANY });

    const result = await addHolding(
      { portfolioRepository, companyRepository },
      1,
      'pf_1',
      { code: '7203', quantity: 100, acquisitionPriceSen: 280_000 },
      NOW,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('portfolio-not-found');
  });

  it('company-not-found: 未登録の銘柄コード', async () => {
    const { repository: portfolioRepository } = createFakePortfolioRepository({
      portfolios: [{ id: 'pf_1', userId: 1, name: 'メインNISA', createdAt: NOW().toISOString() }],
    });
    const companyRepository = fakeCompanyRepository({});

    const result = await addHolding(
      { portfolioRepository, companyRepository },
      1,
      'pf_1',
      { code: '9999', quantity: 100, acquisitionPriceSen: 280_000 },
      NOW,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('company-not-found');
  });

  it('duplicate-holding: 同じポートフォリオに同じ銘柄コードを重複追加', async () => {
    const now = NOW().toISOString();
    const { repository: portfolioRepository } = createFakePortfolioRepository({
      portfolios: [{ id: 'pf_1', userId: 1, name: 'メインNISA', createdAt: now }],
      holdings: [
        { portfolioId: 'pf_1', companyCode: '7203', quantity: 100, acquisitionPriceSen: 280_000, createdAt: now, updatedAt: now },
      ],
      companyInfo: { '7203': { name: 'トヨタ自動車', currentPriceSen: null, dividendYieldBp: null, totalScore: 0, effectiveMetricCount: 0 } },
    });
    const companyRepository = fakeCompanyRepository({ '7203': SAMPLE_COMPANY });

    const result = await addHolding(
      { portfolioRepository, companyRepository },
      1,
      'pf_1',
      { code: '7203', quantity: 50, acquisitionPriceSen: 300_000 },
      NOW,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('duplicate-holding');
  });

  it('境界値: 保有99件(上限未到達) → 100件目の追加に成功する', async () => {
    const now = NOW().toISOString();
    const holdings: PortfolioHoldingRecord[] = Array.from(
      { length: MAX_HOLDINGS_PER_PORTFOLIO - 1 },
      (_, i) => ({
        portfolioId: 'pf_1',
        companyCode: `existing-${i}`,
        quantity: 1,
        acquisitionPriceSen: 1_000,
        createdAt: now,
        updatedAt: now,
      }),
    );
    const { repository: portfolioRepository, state } = createFakePortfolioRepository({
      portfolios: [{ id: 'pf_1', userId: 1, name: 'メインNISA', createdAt: now }],
      holdings,
    });
    const companyRepository = fakeCompanyRepository({ '7203': SAMPLE_COMPANY });

    const result = await addHolding(
      { portfolioRepository, companyRepository },
      1,
      'pf_1',
      { code: '7203', quantity: 100, acquisitionPriceSen: 280_000 },
      NOW,
    );

    expect(result.ok).toBe(true);
    expect(state.holdings).toHaveLength(MAX_HOLDINGS_PER_PORTFOLIO);
  });

  it('境界値: 保有100件(上限到達) → 追加は拒否される(holding-limit-reached)', async () => {
    const now = NOW().toISOString();
    const holdings: PortfolioHoldingRecord[] = Array.from(
      { length: MAX_HOLDINGS_PER_PORTFOLIO },
      (_, i) => ({
        portfolioId: 'pf_1',
        companyCode: `existing-${i}`,
        quantity: 1,
        acquisitionPriceSen: 1_000,
        createdAt: now,
        updatedAt: now,
      }),
    );
    const { repository: portfolioRepository, state } = createFakePortfolioRepository({
      portfolios: [{ id: 'pf_1', userId: 1, name: 'メインNISA', createdAt: now }],
      holdings,
    });
    const companyRepository = fakeCompanyRepository({ '7203': SAMPLE_COMPANY });

    const result = await addHolding(
      { portfolioRepository, companyRepository },
      1,
      'pf_1',
      { code: '7203', quantity: 100, acquisitionPriceSen: 280_000 },
      NOW,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('holding-limit-reached');
    expect(state.holdings).toHaveLength(MAX_HOLDINGS_PER_PORTFOLIO);
  });

  it('成功: 追加後の保有銘柄詳細をそのまま返す(GETのholdings[]要素と同じ形)', async () => {
    const { repository: portfolioRepository } = createFakePortfolioRepository({
      portfolios: [{ id: 'pf_1', userId: 1, name: 'メインNISA', createdAt: NOW().toISOString() }],
      companyInfo: { '7203': { name: 'トヨタ自動車', currentPriceSen: 314_200, dividendYieldBp: 318, totalScore: 62, effectiveMetricCount: 8 } },
    });
    const companyRepository = fakeCompanyRepository({ '7203': SAMPLE_COMPANY });

    const result = await addHolding(
      { portfolioRepository, companyRepository },
      1,
      'pf_1',
      { code: '7203', quantity: 100, acquisitionPriceSen: 280_000 },
      NOW,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.code).toBe('7203');
      expect(result.value.quantity).toBe(100);
      expect(result.value.valueSen).toBe(31_420_000);
      expect(result.value.dividendYieldPercent).toBe(3.18);
    }
  });
});
