import { describe, expect, it } from 'vitest';

import { type Company } from '@/domain/company/company';
import { type CompanyRepository, type CompanySummary } from '@/domain/company/company-repository';
import {
  type FinancialSource,
  type FinancialSourceError,
  type ImportedFinancials,
} from '@/domain/company/financial-source';
import { type MarketDataSource } from '@/domain/company/market-data-source';
import { type Result, err, ok } from '@/domain/shared/result';
import { createApp } from '@/handler/app';

/**
 * GET /api/irbank/:code の結線テスト。
 * 仕様: docs/02_design/logic/irbank-json-import.md
 *
 * D1 を使わない（このルートはリポジトリに触らない）ので unit プロジェクトで動く。
 * **実 API を叩かない**（`.claude/rules/backend.md`）。`FinancialSource` を差し替える。
 */

/** このルートから呼ばれるはずがないリポジトリ。呼ばれたらテストごと落とす */
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

function stubSource(
  result: Result<ImportedFinancials, FinancialSourceError>,
): FinancialSource & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    fetchByCode: (code: string) => {
      calls.push(code);
      return Promise.resolve(result);
    },
  };
}

/** このテストファイルは Yahoo 取り込みを対象にしないので、呼ばれたら落とす */
function unusedMarketDataSource(): MarketDataSource {
  return {
    fetchByCode: (): never => {
      throw new Error('このテストで MarketDataSource が呼ばれるのは想定外');
    },
  };
}

function app(financialSource: FinancialSource) {
  return createApp({
    repository: unusedRepository(),
    financialSource,
    marketDataSource: unusedMarketDataSource(),
    now: () => new Date('2026-07-28T00:00:00.000Z'),
  });
}

const SAMPLE: ImportedFinancials = {
  code: '9433',
  records: [
    {
      fiscalYear: 2026,
      isForecast: false,
      epsSen: 18_359,
      roePercent: 13.93,
      revenueSen: 607_191_500_000_000,
      operatingMarginPercent: 18.1,
    },
  ],
  dividends: [{ fiscalYear: 2026, kind: 'actual', annualAmountSen: 8_000 }],
  latestForecastEpsSen: null,
  latestActualEpsSen: 18_359,
  latestActualBpsSen: 133_350,
  fiscalYearEndMonth: 3,
  diagnostics: [],
};

describe('GET /api/irbank/:code', () => {
  it('取り込みに成功したら 200 と正規化済みの記録を返す', async () => {
    const response = await app(stubSource(ok(SAMPLE))).request('/api/irbank/9433');
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      code: string;
      records: unknown[];
      latestForecastEpsSen: number | null;
      latestActualEpsSen: number | null;
    };
    expect(body.code).toBe('9433');
    expect(body.records).toHaveLength(1);
    expect(body.latestForecastEpsSen).toBeNull();
    expect(body.latestActualEpsSen).toBe(18_359);
  });

  it('決算月を返す（Yahoo 取り込みのクエリに使う。市場データ取り込み設計書 §3.2）', async () => {
    const response = await app(stubSource(ok(SAMPLE))).request('/api/irbank/9433');
    const body = (await response.json()) as { fiscalYearEndMonth: number | null };
    expect(body.fiscalYearEndMonth).toBe(3);
  });

  it('年度キーの月が定まらない銘柄は決算月を null で返す', async () => {
    const response = await app(
      stubSource(ok({ ...SAMPLE, fiscalYearEndMonth: null })),
    ).request('/api/irbank/9433');
    const body = (await response.json()) as { fiscalYearEndMonth: number | null };
    expect(body.fiscalYearEndMonth).toBeNull();
  });

  it('1株配当は records ではなく dividends で返す（ADR-0009）', async () => {
    const response = await app(stubSource(ok(SAMPLE))).request('/api/irbank/9433');

    const body = (await response.json()) as {
      records: Record<string, unknown>[];
      dividends: { fiscalYear: number; annualAmountSen: number | null }[];
    };
    expect(body.dividends).toEqual([{ fiscalYear: 2026, annualAmountSen: 8_000 }]);
    // 二重管理に戻っていないことを機械的に確かめる
    expect(body.records[0]).not.toHaveProperty('dividendPerShareSen');
  });

  it('要求した銘柄コードをそのまま FinancialSource へ渡す', async () => {
    const source = stubSource(ok(SAMPLE));
    await app(source).request('/api/irbank/9433');
    expect(source.calls).toEqual(['9433']);
  });

  it('診断（読めなかった値）をそのまま返す。捨てない', async () => {
    const withDiagnostics: ImportedFinancials = {
      ...SAMPLE,
      diagnostics: [
        {
          block: '業績',
          fiscalYearKey: '2025/03',
          column: '営業利益',
          reason: 'unparsable-value',
          raw: 'N/A',
        },
      ],
    };
    const response = await app(stubSource(ok(withDiagnostics))).request('/api/irbank/9433');
    const body = (await response.json()) as { diagnostics: unknown[]; cellWarnings: unknown[] };
    expect(body.diagnostics).toHaveLength(1);
    // 画面のセルに解決したものも同梱する（import-review.md §3.1）
    expect(body.cellWarnings).toEqual([
      {
        fiscalYear: 2025,
        fiscalYearKey: '2025/03',
        // 営業利益は画面に列が無い（営業利益率は派生値）ので行外の警告になる
        field: null,
        column: '営業利益',
        reason: 'unparsable-value',
        valueKept: false,
        raw: 'N/A',
      },
    ]);
  });

  it.each([
    ['invalid-code' as const, 400, { kind: 'invalid-code', code: 'abc' } as const],
    ['source-not-found' as const, 404, { kind: 'source-not-found', code: '9999' } as const],
    ['no-usable-year' as const, 422, { kind: 'no-usable-year' } as const],
    ['source-unreachable' as const, 502, { kind: 'source-unreachable', detail: 'boom' } as const],
    [
      'code-mismatch' as const,
      502,
      { kind: 'code-mismatch', expected: '9433', actual: '7203' } as const,
    ],
  ])('%s は %i を返す', async (_kind, status, error) => {
    const response = await app(stubSource(err(error))).request('/api/irbank/9433');
    expect(response.status).toBe(status);
  });

  it('失敗時のエラー本文に内部情報（detail・スタックトレース）を含めない', async () => {
    const response = await app(
      stubSource(err({ kind: 'source-unreachable', detail: 'TimeoutError: secret internal path' })),
    ).request('/api/irbank/9433');

    const body = (await response.json()) as { error: string };
    expect(JSON.stringify(body)).not.toContain('secret internal path');
    expect(JSON.stringify(body)).not.toMatch(/\.ts:\d|node_modules/);
  });

  it('保存しない。リポジトリの save は一度も呼ばれない', async () => {
    // unusedRepository() は save が呼ばれた瞬間に throw するので、
    // 例外にならず 200 が返ることそのものが「保存していない」ことの証拠
    const response = await app(stubSource(ok(SAMPLE))).request('/api/irbank/9433');
    expect(response.status).toBe(200);
  });
});
