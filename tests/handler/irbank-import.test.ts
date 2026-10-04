import { describe, expect, it } from 'vitest';

import { type Company } from '@/domain/company/company';
import {
  type CompanyListResult,
  type CompanyRepository,
} from '@/domain/company/company-repository';
import { type EdinetDocumentIndexLookup } from '@/domain/company/edinet-document-index';
import { type EdinetHistorySource } from '@/domain/company/edinet-history-source';
import {
  type FinancialSource,
  type FinancialSourceError,
  type ImportedFinancials,
} from '@/domain/company/financial-source';
import { type MarketDataSource } from '@/domain/company/market-data-source';
import { type Result, err, ok } from '@/domain/shared/result';
import { createApp } from '@/handler/app';

import {
  TEST_ADMIN_SESSION_COOKIE,
  TEST_USER_SESSION_COOKIE,
  buildAuthTestDependencies,
} from './support/build-app-dependencies';

/**
 * GET /api/irbank/:code の結線テスト。
 * 仕様: docs/02_design/logic/irbank-json-import.md
 *
 * D1 を使わない（このルートはリポジトリに触らない）ので unit プロジェクトで動く。
 * **実 API を叩かない**（`.claude/rules/backend.md`）。`FinancialSource` を差し替える。
 *
 * admin限定（T-107）。データ取得成功系のテストは admin セッションCookieを付けて呼ぶ。
 * ロールガード自体の確認は末尾の describe（`GET /api/irbank/:code — ロールガード`）で行う。
 */

/** このファイルの正常系テストで共通して使う admin セッションのリクエストヘッダ */
const ADMIN_HEADERS = { cookie: TEST_ADMIN_SESSION_COOKIE };

/** このルートから呼ばれるはずがないリポジトリ。呼ばれたらテストごと落とす */
function unusedRepository(): CompanyRepository {
  const fail = (): never => {
    throw new Error('このテストでリポジトリが呼ばれるのは想定外');
  };
  return {
    save: (): Promise<void> => fail(),
    findByCode: (): Promise<Company | null> => fail(),
    listSummaries: (): Promise<CompanyListResult> => fail(),
    deleteByCode: (): Promise<void> => fail(),
    listFiscalYearEndMonths: (): Promise<readonly number[]> => fail(),
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

/** このテストファイルは EDINET 取り込みを対象にしないので、呼ばれたら落とす */
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

function rawApp(financialSource: FinancialSource) {
  return createApp({
    repository: unusedRepository(),
    financialSource,
    marketDataSource: unusedMarketDataSource(),
    edinetHistorySource: unusedEdinetHistorySource(),
    edinetDocumentIndexLookup: unusedEdinetDocumentIndexLookup(),
    ...buildAuthTestDependencies(),
    now: () => new Date('2026-07-28T00:00:00.000Z'),
  });
}

/**
 * 正常系・エラー変換のテストは取り込みロジックの検証が主眼であり、ロールガードは
 * 対象外（末尾の describe で別途尽くす）。そのため `request()` に admin セッション
 * Cookie を自動付与するラッパーにし、既存の呼び出し箇所を1つずつ書き換えない。
 */
function app(financialSource: FinancialSource) {
  const honoApp = rawApp(financialSource);
  return {
    request: (input: string, init?: RequestInit) =>
      honoApp.request(input, {
        ...init,
        headers: { ...ADMIN_HEADERS, ...(init?.headers as Record<string, string> | undefined) },
      }),
  };
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
  // ⑥ の入力（docs/02_design/logic/balance-sheet-derivation.md §2.3）
  totalLiabilities: { valueSen: 1_347_067_400_000_000, fiscalYear: 2026 },
  previousDividendTotal: { valueSen: 30_154_700_000_000, fiscalYear: 2026 },
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
    const response = await app(stubSource(ok({ ...SAMPLE, fiscalYearEndMonth: null }))).request(
      '/api/irbank/9433',
    );
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

  it('⑥ 用の負債総額・前期末配当総額を決算年度つきで返す（balance-sheet-derivation.md §2.3）', async () => {
    const response = await app(stubSource(ok(SAMPLE))).request('/api/irbank/9433');

    const body = (await response.json()) as {
      totalLiabilities: { valueSen: number; fiscalYear: number } | null;
      previousDividendTotal: { valueSen: number; fiscalYear: number } | null;
    };
    expect(body.totalLiabilities).toEqual({ valueSen: 1_347_067_400_000_000, fiscalYear: 2026 });
    expect(body.previousDividendTotal).toEqual({ valueSen: 30_154_700_000_000, fiscalYear: 2026 });
  });

  it('算出できなかった欄は null で返す。0 に丸めない（無借金・無配と区別する）', async () => {
    const response = await app(
      stubSource(ok({ ...SAMPLE, totalLiabilities: null, previousDividendTotal: null })),
    ).request('/api/irbank/9433');

    const body = (await response.json()) as {
      totalLiabilities: unknown;
      previousDividendTotal: unknown;
    };
    expect(body.totalLiabilities).toBeNull();
    expect(body.previousDividendTotal).toBeNull();
  });

  it('無借金（0 銭）・無配（0 銭）は 0 のまま返す。null にしない', async () => {
    const response = await app(
      stubSource(
        ok({
          ...SAMPLE,
          totalLiabilities: { valueSen: 0, fiscalYear: 2026 },
          previousDividendTotal: { valueSen: 0, fiscalYear: 2026 },
        }),
      ),
    ).request('/api/irbank/9433');

    const body = (await response.json()) as {
      totalLiabilities: { valueSen: number } | null;
      previousDividendTotal: { valueSen: number } | null;
    };
    expect(body.totalLiabilities?.valueSen).toBe(0);
    expect(body.previousDividendTotal?.valueSen).toBe(0);
  });

  it('inconsistent-value の診断も画面のセル解決つきでそのまま返す', async () => {
    const response = await app(
      stubSource(
        ok({
          ...SAMPLE,
          diagnostics: [
            {
              block: '財務',
              fiscalYearKey: '2026/03',
              column: '総資産',
              reason: 'inconsistent-value',
              raw: '1000 - 1001',
            },
          ],
        }),
      ),
    ).request('/api/irbank/9433');

    const body = (await response.json()) as { cellWarnings: { valueKept: boolean }[] };
    // 財務ブロックは画面のセルに対応しないので行外の警告になる（import-review.md §5.3）
    expect(body.cellWarnings).toEqual([
      {
        fiscalYear: 2026,
        fiscalYearKey: '2026/03',
        field: null,
        column: '総資産',
        reason: 'inconsistent-value',
        valueKept: false,
        raw: '1000 - 1001',
      },
    ]);
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

/**
 * ロールガード（T-107）。外部データ源を実際に呼び出すこのエンドポイントは、
 * `POST/DELETE /api/companies` と同じ `adminOnly` で保護する
 * （`docs/03_tasks/design-mock-alignment.md` T-107）。
 */
describe('GET /api/irbank/:code — ロールガード（admin限定）', () => {
  it('未ログイン（Cookie無し）は401', async () => {
    const response = await rawApp(stubSource(ok(SAMPLE))).request('/api/irbank/9433');
    expect(response.status).toBe(401);
  });

  it('role=user は403（adminではない）', async () => {
    const response = await rawApp(stubSource(ok(SAMPLE))).request('/api/irbank/9433', {
      headers: { cookie: TEST_USER_SESSION_COOKIE },
    });
    expect(response.status).toBe(403);
  });

  it('role=admin は通過する（200）', async () => {
    const response = await rawApp(stubSource(ok(SAMPLE))).request('/api/irbank/9433', {
      headers: ADMIN_HEADERS,
    });
    expect(response.status).toBe(200);
  });
});
