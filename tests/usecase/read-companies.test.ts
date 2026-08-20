import { describe, expect, it } from 'vitest';

import { type Company } from '@/domain/company/company';
import { type CompanyListQuery } from '@/domain/company/company-list-query';
import {
  type CompanyListResult,
  type CompanyRepository,
} from '@/domain/company/company-repository';
import { getCompanyDividendHistory, listCompanies } from '@/usecase/read-companies';

/**
 * `listCompanies` は薄い委譲（ドメイン計算は無い）。
 * ここで見たいのは「渡した `query` がそのまま `repository.listSummaries` へ渡るか」だけ。
 */

function unimplemented(name: string): never {
  throw new Error(`このテストで ${name} が呼ばれるのは想定外`);
}

const SAMPLE_RESULT: CompanyListResult = {
  items: [
    {
      code: '9433',
      name: 'テスト通信',
      totalScore: 74,
      maxTotalScore: 100,
      effectiveMetricCount: 10,
      totalMetricCount: 10,
      fetchedAt: '2026-07-28T00:00:00.000Z',
      priceSen: 425_000,
      dividendYieldValue: 318,
      payoutRatioValue: 32.4,
    },
  ],
  total: 1,
};

function fakeRepository(spy: { received: CompanyListQuery | null }): CompanyRepository {
  return {
    save: (): Promise<void> => unimplemented('CompanyRepository.save'),
    findByCode: (): Promise<Company | null> => unimplemented('CompanyRepository.findByCode'),
    listSummaries: (query: CompanyListQuery): Promise<CompanyListResult> => {
      spy.received = query;
      return Promise.resolve(SAMPLE_RESULT);
    },
    deleteByCode: (): Promise<void> => unimplemented('CompanyRepository.deleteByCode'),
    listFiscalYearEndMonths: (): Promise<readonly number[]> =>
      unimplemented('CompanyRepository.listFiscalYearEndMonths'),
  };
}

describe('listCompanies', () => {
  it('渡した query をそのまま repository.listSummaries へ渡す', async () => {
    const spy: { received: CompanyListQuery | null } = { received: null };
    const query: CompanyListQuery = { q: 'KDDI', sort: 'score_desc', page: 2, perPage: 30 };

    await listCompanies(fakeRepository(spy), query);

    expect(spy.received).toEqual(query);
  });

  it('repository.listSummaries の戻り値をそのまま返す（再計算しない）', async () => {
    const spy: { received: CompanyListQuery | null } = { received: null };
    const query: CompanyListQuery = { q: '', sort: 'created_desc', page: 1, perPage: 15 };

    const result = await listCompanies(fakeRepository(spy), query);

    expect(result).toBe(SAMPLE_RESULT);
  });
});

const SAMPLE_COMPANY: Company = {
  code: '9433',
  name: 'テスト通信',
  records: [],
  dividends: [
    { fiscalYear: 2026, kind: 'forecast', annualAmountSen: 6_000 },
    { fiscalYear: 2025, kind: 'actual', annualAmountSen: 5_800 },
    { fiscalYear: 2024, kind: 'actual', annualAmountSen: 5_600 },
  ],
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

/**
 * `getCompanyDividendHistory` は薄い委譲（ドメイン計算は `dividendHistoryByYear` に任せる）。
 * ここで見たいのは「`findByCode` の結果に domain 関数を適用して返すか」「null の伝播」だけ。
 * 集約ロジックそのもの（優先順位・境界値）は `tests/domain/company/dividend-record.test.ts` で尽くす。
 */
describe('getCompanyDividendHistory', () => {
  function fakeCompanyRepository(company: Company | null): CompanyRepository {
    return {
      save: (): Promise<void> => unimplemented('CompanyRepository.save'),
      findByCode: (): Promise<Company | null> => Promise.resolve(company),
      listSummaries: (): Promise<CompanyListResult> =>
        unimplemented('CompanyRepository.listSummaries'),
      deleteByCode: (): Promise<void> => unimplemented('CompanyRepository.deleteByCode'),
      listFiscalYearEndMonths: (): Promise<readonly number[]> =>
        unimplemented('CompanyRepository.listFiscalYearEndMonths'),
    };
  }

  it('findByCode が Company を返す → dividendHistoryByYear を適用した結果が返る', async () => {
    const result = await getCompanyDividendHistory(fakeCompanyRepository(SAMPLE_COMPANY), '9433');

    expect(result).toEqual([
      { fiscalYear: 2024, amountSen: 5_600, isForecast: false },
      { fiscalYear: 2025, amountSen: 5_800, isForecast: false },
      { fiscalYear: 2026, amountSen: 6_000, isForecast: true },
    ]);
  });

  it('findByCode が null を返す → null を返す（404 への変換は handler の責務）', async () => {
    const result = await getCompanyDividendHistory(fakeCompanyRepository(null), '0000');

    expect(result).toBeNull();
  });
});
