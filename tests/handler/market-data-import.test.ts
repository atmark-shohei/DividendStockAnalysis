import { describe, expect, it } from 'vitest';

import { type Company } from '@/domain/company/company';
import { type CompanyRepository, type CompanySummary } from '@/domain/company/company-repository';
import { type FinancialSource } from '@/domain/company/financial-source';
import {
  type MarketData,
  type MarketDataError,
  type MarketDataSource,
} from '@/domain/company/market-data-source';
import { type Result, err, ok } from '@/domain/shared/result';
import { createApp } from '@/handler/app';

/**
 * GET /api/market-data/:code の結線テスト。
 * 仕様: docs/02_design/logic/market-data-source.md
 *
 * D1 を使わない（このルートはリポジトリに触らない）ので unit プロジェクトで動く。
 * **実 API を叩かない**（`.claude/rules/backend.md`）。`MarketDataSource` を差し替える。
 */

function unusedRepository(): CompanyRepository {
  const fail = (): never => {
    throw new Error('このテストでリポジトリが呼ばれるのは想定外');
  };
  return {
    save: (): Promise<void> => fail(),
    findByCode: (): Promise<Company | null> => fail(),
    listSummaries: (): Promise<readonly CompanySummary[]> => fail(),
    deleteByCode: (): Promise<void> => fail(),
  };
}

function unusedFinancialSource(): FinancialSource {
  return {
    fetchByCode: (): never => {
      throw new Error('このテストで FinancialSource が呼ばれるのは想定外');
    },
  };
}

function stubSource(
  result: Result<MarketData, MarketDataError>,
): MarketDataSource & { calls: { code: string; query: unknown }[] } {
  const calls: { code: string; query: unknown }[] = [];
  return {
    calls,
    fetchByCode: (code: string) => {
      calls.push({ code, query: undefined });
      return Promise.resolve(result);
    },
  };
}

function app(marketDataSource: MarketDataSource) {
  return createApp({
    repository: unusedRepository(),
    financialSource: unusedFinancialSource(),
    marketDataSource,
    now: () => new Date('2026-08-03T00:00:00.000Z'),
  });
}

const SAMPLE: MarketData = {
  code: '9433',
  name: 'KDDI Corporation',
  priceSen: 290_300,
  priceAsOf: '2026-08-03T06:30:00.000Z',
  dividendPayments: [
    { exDividendDate: '2025-09-29', amountYenText: '40' },
    { exDividendDate: '2026-03-30', amountYenText: '40' },
  ],
  splits: [{ date: '2025-03-28', numerator: 2, denominator: 1 }],
  diagnostics: [],
};

describe('GET /api/market-data/:code', () => {
  it('fiscalYearEndMonth 未指定なら 200。配当は集計しない', async () => {
    const response = await app(stubSource(ok(SAMPLE))).request('/api/market-data/9433');
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      code: string;
      name: string | null;
      priceSen: number | null;
      dividendRecords: unknown[];
      dividendAggregated: boolean;
      splits: unknown[];
    };
    expect(body.code).toBe('9433');
    expect(body.name).toBe('KDDI Corporation');
    expect(body.priceSen).toBe(290_300);
    expect(body.dividendRecords).toEqual([]);
    expect(body.dividendAggregated).toBe(false);
    expect(body.splits).toEqual([{ date: '2025-03-28', numerator: 2, denominator: 1 }]);
  });

  it('fiscalYearEndMonth=3 を指定すると配当を決算年度へ集計する', async () => {
    const response = await app(stubSource(ok(SAMPLE))).request(
      '/api/market-data/9433?fiscalYearEndMonth=3',
    );
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      dividendRecords: { fiscalYear: number; annualAmountSen: number | null }[];
      dividendAggregated: boolean;
    };
    expect(body.dividendAggregated).toBe(true);
    expect(body.dividendRecords).toEqual([{ fiscalYear: 2026, annualAmountSen: 8_000 }]);
  });

  it('fiscalYearEndMonth が範囲外（13）なら 400', async () => {
    const response = await app(stubSource(ok(SAMPLE))).request(
      '/api/market-data/9433?fiscalYearEndMonth=13',
    );
    expect(response.status).toBe(400);
  });

  it('fiscalYearEndMonth が数値でないなら 400', async () => {
    const response = await app(stubSource(ok(SAMPLE))).request(
      '/api/market-data/9433?fiscalYearEndMonth=abc',
    );
    expect(response.status).toBe(400);
  });

  it('要求した銘柄コードをそのまま MarketDataSource へ渡す', async () => {
    const source = stubSource(ok(SAMPLE));
    await app(source).request('/api/market-data/9433');
    expect(source.calls.map((c) => c.code)).toEqual(['9433']);
  });

  it('診断（パース・集計の両方）をそのまま返す。捨てない', async () => {
    const withDiagnostics: MarketData = {
      ...SAMPLE,
      diagnostics: [
        {
          block: '株価',
          fiscalYearKey: '',
          column: '株価',
          reason: 'unparsable-value',
          raw: 'N/A',
        },
      ],
    };
    const response = await app(stubSource(ok(withDiagnostics))).request(
      '/api/market-data/9433?fiscalYearEndMonth=3',
    );
    const body = (await response.json()) as {
      diagnostics: unknown[];
      dividendDiagnostics: unknown[];
    };
    expect(body.diagnostics).toHaveLength(1);
    expect(Array.isArray(body.dividendDiagnostics)).toBe(true);
  });

  it.each([
    ['invalid-code' as const, 400, { kind: 'invalid-code', code: 'abc' } as const],
    ['source-not-found' as const, 404, { kind: 'source-not-found', code: '9999' } as const],
    ['source-unreachable' as const, 502, { kind: 'source-unreachable', detail: 'boom' } as const],
    ['malformed-response' as const, 502, { kind: 'malformed-response', detail: 'boom' } as const],
    ['unexpected-shape' as const, 502, { kind: 'unexpected-shape', detail: 'boom' } as const],
  ])('%s は %i を返す', async (_kind, status, error) => {
    const response = await app(stubSource(err(error))).request('/api/market-data/9433');
    expect(response.status).toBe(status);
  });

  it('失敗時のエラー本文に内部情報（detail・スタックトレース）を含めない', async () => {
    const response = await app(
      stubSource(err({ kind: 'source-unreachable', detail: 'TimeoutError: secret internal path' })),
    ).request('/api/market-data/9433');

    const body = (await response.json()) as { error: string };
    expect(JSON.stringify(body)).not.toContain('secret internal path');
    expect(JSON.stringify(body)).not.toMatch(/\.ts:\d|node_modules/);
  });

  it('保存しない。リポジトリの save は一度も呼ばれない', async () => {
    // unusedRepository() は save が呼ばれた瞬間に throw するので、
    // 例外にならず 200 が返ることそのものが「保存していない」ことの証拠
    const response = await app(stubSource(ok(SAMPLE))).request('/api/market-data/9433');
    expect(response.status).toBe(200);
  });
});
