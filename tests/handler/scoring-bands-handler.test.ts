import { describe, expect, it } from 'vitest';

import {
  type CompanyListResult,
  type CompanyRepository,
} from '@/domain/company/company-repository';
import { type EdinetDocumentIndexLookup } from '@/domain/company/edinet-document-index';
import { type EdinetHistorySource } from '@/domain/company/edinet-history-source';
import { type FinancialSource } from '@/domain/company/financial-source';
import { type MarketDataSource } from '@/domain/company/market-data-source';
import { METRIC_KEYS } from '@/domain/shared/metric-key';
import { createApp } from '@/handler/app';

import { buildAuthTestDependencies } from './support/build-app-dependencies';

/**
 * `GET /api/scoring/bands` の結線テスト。
 *
 * D1・CompanyRepository を一切使わないエンドポイントのため、渡す依存はすべて
 * 「呼ばれたら失敗する」スタブでよい（`company-dividends-handler.test.ts` と同型の
 * 最小依存パターン）。ここで見たいのは「handler → usecase → DTO」の結線と応答形だけ。
 * 区分表そのものの健全性は `tests/domain/scoring/bands.test.ts`、
 * usecase の値の一致は `tests/usecase/get-scoring-bands.test.ts` で確認済み。
 */

function unusedRepository(): CompanyRepository {
  const fail = (): never => {
    throw new Error('このテストで CompanyRepository が呼ばれるのは想定外');
  };
  return {
    save: fail,
    findByCode: fail,
    listSummaries: (): Promise<CompanyListResult> => fail(),
    deleteByCode: fail,
    listFiscalYearEndMonths: (): Promise<readonly number[]> => fail(),
  };
}

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

function app() {
  return createApp({
    repository: unusedRepository(),
    financialSource: unusedFinancialSource(),
    marketDataSource: unusedMarketDataSource(),
    edinetHistorySource: unusedEdinetHistorySource(),
    edinetDocumentIndexLookup: unusedEdinetDocumentIndexLookup(),
    ...buildAuthTestDependencies(),
    now: () => new Date('2026-08-22T00:00:00.000Z'),
  });
}

describe('GET /api/scoring/bands', () => {
  it('200: 10指標分の区分表を METRIC_KEYS の順で返す（認証なしでアクセスできる）', async () => {
    const response = await app().request('/api/scoring/bands');
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      metrics: {
        key: string;
        number: number;
        label: string;
        unit: string;
        bands: { minInclusive: number | null; maxExclusive: number | null; points: number }[];
      }[];
    };
    expect(body.metrics).toHaveLength(10);
    expect(body.metrics.map((metric) => metric.key)).toEqual(METRIC_KEYS);
    expect(body.metrics[0]?.key).toBe('dividendGrowthRate');
    expect(body.metrics[0]?.number).toBe(1);
    expect(body.metrics[0]?.label).toBe('増配率（5年CAGR）');
    expect(body.metrics[0]?.unit).toBe('%');
  });

  it('③予想配当性向は10段のまま返る（段数を揃えない）', async () => {
    const response = await app().request('/api/scoring/bands');
    const body = (await response.json()) as {
      metrics: { key: string; bands: { points: number }[] }[];
    };
    const payoutRatio = body.metrics.find((metric) => metric.key === 'payoutRatio');
    expect(payoutRatio?.bands).toHaveLength(10);
  });
});
