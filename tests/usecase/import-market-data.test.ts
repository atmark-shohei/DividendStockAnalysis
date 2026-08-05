import { describe, expect, it } from 'vitest';

import {
  type MarketData,
  type MarketDataError,
  type MarketDataSource,
} from '@/domain/company/market-data-source';
import { type Result, err, ok } from '@/domain/shared/result';
import { importMarketData } from '@/usecase/import-market-data';

/**
 * `importMarketData` は「決算月が分かっているときだけ配当を年度集計する」分岐を持つ。
 * `import-from-irbank.ts`（1行 delegation）と違い、この分岐そのものがロジックなので
 * handler テストに頼らず単体で検証する。
 */

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

function stubSource(
  result: Result<MarketData, MarketDataError>,
): MarketDataSource & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    fetchByCode: (code: string) => {
      calls.push(code);
      return Promise.resolve(result);
    },
  };
}

const FIXED_NOW = () => new Date('2026-04-01T00:00:00.000Z');

describe('fiscalYearEndMonth が null（IRバンク未実施でYahooだけを実行した）', () => {
  it('配当の集計をせず、株価・分割イベントだけを返す', async () => {
    const result = await importMarketData(stubSource(ok(SAMPLE)), '9433', null, FIXED_NOW);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.marketData).toBe(SAMPLE);
    expect(result.value.dividendRecords).toEqual([]);
    expect(result.value.dividendDiagnostics).toEqual([]);
    expect(result.value.dividendAggregated).toBe(false);
  });
});

describe('fiscalYearEndMonth が非 null（IRバンク実施済み）', () => {
  it('配当を決算年度へ集計して返す', async () => {
    const result = await importMarketData(stubSource(ok(SAMPLE)), '9433', 3, FIXED_NOW);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.dividendAggregated).toBe(true);
    expect(result.value.dividendRecords).toEqual([
      { fiscalYear: 2026, kind: 'actual', annualAmountSen: 8_000 },
    ]);
    expect(result.value.dividendDiagnostics).toEqual([]);
  });

  it('現在時刻は注入した now() を使う。Date.now() を直接読まない', async () => {
    // FY2026 が「進行中」に見える現在時刻を注入すると、集計から除外される
    const inProgress = () => new Date('2025-10-01T00:00:00.000Z');
    const result = await importMarketData(stubSource(ok(SAMPLE)), '9433', 3, inProgress);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.dividendRecords).toEqual([]);
    expect(result.value.dividendAggregated).toBe(true); // 集計は実行された（結果が空なだけ）
  });
});

describe('source がエラーを返す', () => {
  it('そのまま伝播する', async () => {
    const error: MarketDataError = { kind: 'source-unreachable', detail: 'boom' };
    const result = await importMarketData(stubSource(err(error)), '9433', 3, FIXED_NOW);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual(error);
  });

  it('決算月が不正（0/13等）でもドメインのエラーがそのまま伝播する', async () => {
    const result = await importMarketData(stubSource(ok(SAMPLE)), '9433', 13, FIXED_NOW);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({ kind: 'invalid-fiscal-year-end-month' });
  });
});

describe('要求した銘柄コードをそのまま MarketDataSource へ渡す', () => {
  it('コードが変わらない', async () => {
    const source = stubSource(ok(SAMPLE));
    await importMarketData(source, '9433', null, FIXED_NOW);
    expect(source.calls).toEqual(['9433']);
  });
});
