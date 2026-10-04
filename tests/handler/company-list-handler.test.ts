import { describe, expect, it } from 'vitest';

import { type Company } from '@/domain/company/company';
import { type CompanyListQuery } from '@/domain/company/company-list-query';
import {
  type CompanyListResult,
  type CompanyRepository,
  type CompanySummary,
} from '@/domain/company/company-repository';
import { type EdinetDocumentIndexLookup } from '@/domain/company/edinet-document-index';
import { type EdinetHistorySource } from '@/domain/company/edinet-history-source';
import { type FinancialSource } from '@/domain/company/financial-source';
import { type MarketDataSource } from '@/domain/company/market-data-source';
import { createApp } from '@/handler/app';

import { buildAuthTestDependencies } from './support/build-app-dependencies';

/**
 * `GET /api/companies` の結線テスト。
 *
 * D1 を使わない（モックリポジトリで `listSummaries` の呼び出しを検証する）ので unit プロジェクトで動く。
 * ここで見たいのは「クエリパラメータの丸め込みが正しく handler → usecase → repository へ届くか」
 * と「応答形（`companies`/`page`/`perPage`/`total`）」だけ。JOIN・ソート・件数計算そのものは
 * `tests/integration/company-list-search.test.ts`（実D1）で検証する。
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

const SAMPLE_SUMMARY: CompanySummary = {
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
};

function stubRepository(
  result: CompanyListResult,
): CompanyRepository & { calls: CompanyListQuery[] } {
  const calls: CompanyListQuery[] = [];
  const fail = (): never => {
    throw new Error('このテストでリポジトリの想定外メソッドが呼ばれた');
  };
  return {
    calls,
    save: (): Promise<void> => fail(),
    findByCode: (): Promise<Company | null> => fail(),
    listSummaries: (query: CompanyListQuery): Promise<CompanyListResult> => {
      calls.push(query);
      return Promise.resolve(result);
    },
    deleteByCode: (): Promise<void> => fail(),
    listFiscalYearEndMonths: (): Promise<readonly number[]> => fail(),
  };
}

function app(repository: CompanyRepository) {
  return createApp({
    repository,
    financialSource: unusedFinancialSource(),
    marketDataSource: unusedMarketDataSource(),
    edinetHistorySource: unusedEdinetHistorySource(),
    edinetDocumentIndexLookup: unusedEdinetDocumentIndexLookup(),
    ...buildAuthTestDependencies(),
    now: () => new Date('2026-08-18T00:00:00.000Z'),
  });
}

describe('GET /api/companies — 応答形', () => {
  it('companies/page/perPage/total を同梱する', async () => {
    const repository = stubRepository({ items: [SAMPLE_SUMMARY], total: 42 });
    const response = await app(repository).request('/api/companies?page=2&perPage=10');
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      companies: CompanySummary[];
      page: number;
      perPage: number;
      total: number;
    };
    expect(body.companies).toEqual([SAMPLE_SUMMARY]);
    expect(body.page).toBe(2);
    expect(body.perPage).toBe(10);
    expect(body.total).toBe(42);
  });

  it('priceSen/dividendYieldValue/payoutRatioValue が null でもそのまま null で返す（0に丸めない）', async () => {
    const unavailable: CompanySummary = {
      ...SAMPLE_SUMMARY,
      priceSen: null,
      dividendYieldValue: null,
      payoutRatioValue: null,
    };
    const repository = stubRepository({ items: [unavailable], total: 1 });
    const response = await app(repository).request('/api/companies');
    const body = (await response.json()) as { companies: CompanySummary[] };

    expect(body.companies[0]?.priceSen).toBeNull();
    expect(body.companies[0]?.dividendYieldValue).toBeNull();
    expect(body.companies[0]?.payoutRatioValue).toBeNull();
  });

  it('保存が0件でも 200 と空配列・total=0 を返す', async () => {
    const repository = stubRepository({ items: [], total: 0 });
    const response = await app(repository).request('/api/companies');
    expect(response.status).toBe(200);

    const body = (await response.json()) as { companies: unknown[]; total: number };
    expect(body.companies).toEqual([]);
    expect(body.total).toBe(0);
  });
});

describe('GET /api/companies — q の既定値・トリム', () => {
  it('未指定なら空文字（絞り込まない）で repository へ渡る', async () => {
    const repository = stubRepository({ items: [], total: 0 });
    await app(repository).request('/api/companies');
    expect(repository.calls[0]?.q).toBe('');
  });

  it('前後空白はトリムされて repository へ渡る', async () => {
    const repository = stubRepository({ items: [], total: 0 });
    await app(repository).request('/api/companies?q=%20%20KDDI%20%20');
    expect(repository.calls[0]?.q).toBe('KDDI');
  });
});

describe('GET /api/companies — sort（未知値・未指定は既定へ丸める。400にしない）', () => {
  const cases: ReadonlyArray<{ name: string; query: string; expected: string }> = [
    { name: '未指定 → created_desc', query: '', expected: 'created_desc' },
    {
      name: '未知値 unknown → created_desc へ丸める',
      query: '?sort=unknown',
      expected: 'created_desc',
    },
    { name: 'score_desc はそのまま', query: '?sort=score_desc', expected: 'score_desc' },
    { name: 'score_asc はそのまま', query: '?sort=score_asc', expected: 'score_asc' },
    { name: 'code_asc はそのまま', query: '?sort=code_asc', expected: 'code_asc' },
  ];

  it.each(cases)('$name', async ({ query, expected }) => {
    const repository = stubRepository({ items: [], total: 0 });
    const response = await app(repository).request(`/api/companies${query}`);
    expect(response.status).toBe(200);
    expect(repository.calls[0]?.sort).toBe(expected);
  });
});

describe('GET /api/companies — page（境界値。400にしない）', () => {
  const cases: ReadonlyArray<{ name: string; query: string; expected: number }> = [
    { name: 'page=0 → 既定 1 へ丸める', query: '?page=0', expected: 1 },
    { name: 'page=-1（負値） → 既定 1 へ丸める', query: '?page=-1', expected: 1 },
    { name: 'page=abc（非数値） → 既定 1 へ丸める', query: '?page=abc', expected: 1 },
    { name: 'page=3 はそのまま', query: '?page=3', expected: 3 },
  ];

  it.each(cases)('$name', async ({ query, expected }) => {
    const repository = stubRepository({ items: [], total: 0 });
    const response = await app(repository).request(`/api/companies${query}`);
    expect(response.status).toBe(200);
    expect(repository.calls[0]?.page).toBe(expected);
  });
});

describe('GET /api/companies — perPage（境界値。400にしない）', () => {
  const cases: ReadonlyArray<{ name: string; query: string; expected: number }> = [
    { name: 'perPage=0 → 既定 15 へ丸める', query: '?perPage=0', expected: 15 },
    { name: 'perPage=101（上限超え） → 既定 15 へ丸める', query: '?perPage=101', expected: 15 },
    { name: 'perPage=100（上限ちょうど） → そのまま通す', query: '?perPage=100', expected: 100 },
  ];

  it.each(cases)('$name', async ({ query, expected }) => {
    const repository = stubRepository({ items: [], total: 0 });
    const response = await app(repository).request(`/api/companies${query}`);
    expect(response.status).toBe(200);
    expect(repository.calls[0]?.perPage).toBe(expected);
  });
});

describe('GET /api/companies — 認証不要（公開画面が使うため admin ガード無し）', () => {
  it('セッション Cookie 無しでも 200', async () => {
    const repository = stubRepository({ items: [], total: 0 });
    const response = await app(repository).request('/api/companies');
    expect(response.status).toBe(200);
  });
});
