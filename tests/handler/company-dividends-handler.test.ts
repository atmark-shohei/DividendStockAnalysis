import { describe, expect, it } from 'vitest';

import { type Company } from '@/domain/company/company';
import {
  type CompanyListResult,
  type CompanyRepository,
} from '@/domain/company/company-repository';
import { type EdinetDocumentIndexLookup } from '@/domain/company/edinet-document-index';
import { type EdinetHistorySource } from '@/domain/company/edinet-history-source';
import { type FinancialSource } from '@/domain/company/financial-source';
import { type MarketDataSource } from '@/domain/company/market-data-source';
import { createApp } from '@/handler/app';

import { buildAuthTestDependencies } from './support/build-app-dependencies';

/**
 * `GET /api/companies/:code/dividends` の結線テスト。
 *
 * D1 を使わない（モックリポジトリの `findByCode` を差し替える）ので unit プロジェクトで動く。
 * 集約ロジック（区分の優先順位・null の扱い等）そのものは
 * `tests/domain/company/dividend-record.test.ts` で尽くしてある。ここで見たいのは
 * 「handler → usecase → repository の結線」「404/400 の分岐」「応答形」だけ。
 * 実D1経由の結線は `tests/integration/api.test.ts` で追加確認する。
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

const SAMPLE_COMPANY: Company = {
  code: '9433',
  name: 'テスト通信',
  records: [],
  dividends: [
    { fiscalYear: 2026, kind: 'forecast', annualAmountSen: 6_000 },
    { fiscalYear: 2025, kind: 'actual', annualAmountSen: 5_800 },
    { fiscalYear: 2024, kind: 'forecast', annualAmountSen: 5_500 },
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

/** `findByCode` の応答だけを差し替えるスタブ。それ以外のメソッドが呼ばれたら落とす */
function stubRepository(
  company: Company | null,
): CompanyRepository & { calls: string[] } {
  const calls: string[] = [];
  const fail = (): never => {
    throw new Error('このテストでリポジトリの想定外メソッドが呼ばれた');
  };
  return {
    calls,
    save: (): Promise<void> => fail(),
    findByCode: (code: string): Promise<Company | null> => {
      calls.push(code);
      return Promise.resolve(company);
    },
    listSummaries: (): Promise<CompanyListResult> => fail(),
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
    now: () => new Date('2026-08-20T00:00:00.000Z'),
  });
}

describe('GET /api/companies/:code/dividends', () => {
  it('200: 年度昇順・区分優先順位を適用した配当履歴を返す', async () => {
    const repository = stubRepository(SAMPLE_COMPANY);
    const response = await app(repository).request('/api/companies/9433/dividends');
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      dividends: { fiscalYear: number; amountSen: number | null; isForecast: boolean }[];
    };
    expect(body.dividends).toEqual([
      { fiscalYear: 2024, amountSen: 5_600, isForecast: false },
      { fiscalYear: 2025, amountSen: 5_800, isForecast: false },
      { fiscalYear: 2026, amountSen: 6_000, isForecast: true },
    ]);
    expect(repository.calls).toEqual(['9433']);
  });

  it('404: 未保存の銘柄コードなら見つからない', async () => {
    const repository = stubRepository(null);
    const response = await app(repository).request('/api/companies/9433/dividends');
    expect(response.status).toBe(404);

    const body = (await response.json()) as { error: string };
    expect(body.error).toBe('指定された銘柄は保存されていません');
  });

  it('400: 銘柄コードの形式が不正なら repository を呼ばずに弾く', async () => {
    const repository = stubRepository(SAMPLE_COMPANY);
    const response = await app(repository).request('/api/companies/abc/dividends');
    expect(response.status).toBe(400);
    expect(repository.calls).toEqual([]);
  });

  it('認証不要（GET /api/companies/:code と同じ可視性）', async () => {
    const repository = stubRepository(SAMPLE_COMPANY);
    const response = await app(repository).request('/api/companies/9433/dividends');
    expect(response.status).toBe(200);
  });
});
