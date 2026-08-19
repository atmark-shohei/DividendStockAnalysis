import { describe, expect, it } from 'vitest';

import { type Company } from '@/domain/company/company';
import { type CompanyListQuery } from '@/domain/company/company-list-query';
import {
  type CompanyListResult,
  type CompanyRepository,
} from '@/domain/company/company-repository';
import { listCompanies } from '@/usecase/read-companies';

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
