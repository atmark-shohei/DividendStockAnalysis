import { describe, expect, it } from 'vitest';

import { type Company } from '@/domain/company/company';
import {
  type CompanyListResult,
  type CompanyRepository,
} from '@/domain/company/company-repository';
import { type EdinetDocumentIndexLookup } from '@/domain/company/edinet-document-index';
import {
  type EdinetHistoryError,
  type EdinetHistoryResult,
  type EdinetHistorySource,
} from '@/domain/company/edinet-history-source';
import { type FinancialSource } from '@/domain/company/financial-source';
import { type MarketDataSource } from '@/domain/company/market-data-source';
import { type Result, err, ok } from '@/domain/shared/result';
import { createApp } from '@/handler/app';

import { buildAuthTestDependencies } from './support/build-app-dependencies';

/**
 * GET /api/edinet/:code の結線テスト。
 * 仕様: docs/02_design/logic/edinet-history-import.md
 *
 * D1 を使わない（このルートはリポジトリに触らない）ので unit プロジェクトで動く。
 * **実 API を叩かない**（`.claude/rules/backend.md`）。`EdinetHistorySource` を差し替える。
 */

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

const stubIndex: EdinetDocumentIndexLookup = {
  findDocId: () => Promise.resolve(null),
  findLatest: () => Promise.resolve(null),
};

function stubSource(
  result: Result<EdinetHistoryResult, EdinetHistoryError>,
): EdinetHistorySource & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    fetchHistory: (code: string) => {
      calls.push(code);
      return Promise.resolve(result);
    },
  };
}

function app(edinetHistorySource: EdinetHistorySource) {
  return createApp({
    repository: unusedRepository(),
    financialSource: unusedFinancialSource(),
    marketDataSource: unusedMarketDataSource(),
    edinetHistorySource,
    edinetDocumentIndexLookup: stubIndex,
    ...buildAuthTestDependencies(),
    now: () => new Date('2026-08-08T00:00:00.000Z'),
  });
}

const SAMPLE_RESULT: EdinetHistoryResult = {
  years: [
    {
      fiscalYear: 2026,
      epsSen: 18_359,
      revenueSen: 607_191_500_000_000,
      roePercent: 13.93,
      sourceDocId: 'S100YKG2',
      // ⑧用。設計書 §7.7 の実測値（9433 FY2026）をそのまま使う
      operatingMarginPercent: 18.1,
    },
    {
      fiscalYear: 2025,
      epsSen: 16_186,
      revenueSen: 583_552_500_000_000,
      roePercent: null,
      sourceDocId: 'S100YKG2',
      // roePercent は null（判定不能）だが operatingMarginPercent は非null、
      // という「指標ごとに独立してnull/非nullが混在する」組み合わせも配線確認する
      operatingMarginPercent: 18.64,
    },
  ],
  epsHistoryRestated: false,
  revenueHistoryRestated: false,
  balanceSheet: {
    currentAssetsSen: 470_650_700_000_000,
    investmentSecuritiesSen: null,
    sourceDocId: 'S100YKG2',
  },
  // 最新有報（S100YKG2）と1年前有報（S100VXGZ）の診断が混ざる。
  // BS項目は年度を持たないので fiscalYear は null（設計書 §5）
  diagnostics: [
    {
      field: 'eps',
      offset: 0,
      fiscalYear: 2026,
      elementId: 'jpcrp_cor:BasicEarningsLossPerShareSummaryOfBusinessResults',
      reason: 'unit-mismatch',
      raw: 'unitId=JPY',
      sourceDocId: 'S100YKG2',
    },
    {
      field: 'currentAssets',
      offset: null,
      fiscalYear: null,
      elementId: 'jppfs_cor:CurrentAssets',
      reason: 'unparsable-value',
      raw: '△123',
      sourceDocId: 'S100YKG2',
    },
    {
      field: 'revenue',
      offset: 4,
      fiscalYear: 2021,
      elementId: 'jpcrp_cor:NetSalesSummaryOfBusinessResults',
      reason: 'unsafe-integer',
      raw: '99999999999999999',
      sourceDocId: 'S100VXGZ',
    },
  ],
};

describe('取得に成功する', () => {
  it('銘柄コードをそのままユースケースへ渡す', async () => {
    const source = stubSource(ok(SAMPLE_RESULT));

    const response = await app(source).request('/api/edinet/9433');

    expect(response.status).toBe(200);
    expect(source.calls).toEqual(['9433']);
  });

  it('取り込んだ結果をそのまま返す（丸めない）', async () => {
    const source = stubSource(ok(SAMPLE_RESULT));

    const response = await app(source).request('/api/edinet/9433');
    const body = await response.json();

    expect(body).toEqual({
      years: [
        {
          fiscalYear: 2026,
          epsSen: 18_359,
          revenueSen: 607_191_500_000_000,
          roePercent: 13.93,
          sourceDocId: 'S100YKG2',
          operatingMarginPercent: 18.1,
        },
        {
          fiscalYear: 2025,
          epsSen: 16_186,
          revenueSen: 583_552_500_000_000,
          roePercent: null,
          sourceDocId: 'S100YKG2',
          operatingMarginPercent: 18.64,
        },
      ],
      epsHistoryRestated: false,
      revenueHistoryRestated: false,
      balanceSheet: {
        currentAssetsSen: 470_650_700_000_000,
        investmentSecuritiesSen: null,
        sourceDocId: 'S100YKG2',
      },
      diagnostics: [
        {
          field: 'eps',
          offset: 0,
          fiscalYear: 2026,
          elementId: 'jpcrp_cor:BasicEarningsLossPerShareSummaryOfBusinessResults',
          reason: 'unit-mismatch',
          raw: 'unitId=JPY',
          sourceDocId: 'S100YKG2',
        },
        {
          field: 'currentAssets',
          offset: null,
          fiscalYear: null,
          elementId: 'jppfs_cor:CurrentAssets',
          reason: 'unparsable-value',
          raw: '△123',
          sourceDocId: 'S100YKG2',
        },
        {
          field: 'revenue',
          offset: 4,
          fiscalYear: 2021,
          elementId: 'jpcrp_cor:NetSalesSummaryOfBusinessResults',
          reason: 'unsafe-integer',
          raw: '99999999999999999',
          sourceDocId: 'S100VXGZ',
        },
      ],
    });
  });

  it('operatingMarginPercent が null でもそのまま返す（0やundefinedに化けない）', async () => {
    const source = stubSource(
      ok({
        ...SAMPLE_RESULT,
        years: [
          { ...SAMPLE_RESULT.years[0]!, operatingMarginPercent: null },
          SAMPLE_RESULT.years[1]!,
        ],
      }),
    );

    const response = await app(source).request('/api/edinet/9433');
    const body = (await response.json()) as {
      years: readonly { operatingMarginPercent: unknown }[];
    };

    expect(body.years[0]?.operatingMarginPercent).toBeNull();
  });

  it('balanceSheet が null でもそのまま返す（判定不能を丸めない）', async () => {
    const source = stubSource(ok({ ...SAMPLE_RESULT, balanceSheet: null }));

    const response = await app(source).request('/api/edinet/9433');
    const body = (await response.json()) as { balanceSheet: unknown };

    expect(body.balanceSheet).toBeNull();
  });

  it('診断が0件でも diagnostics: [] を返す（キーごと消さない）', async () => {
    const source = stubSource(ok({ ...SAMPLE_RESULT, diagnostics: [] }));

    const response = await app(source).request('/api/edinet/9433');
    const body = (await response.json()) as Record<string, unknown>;

    expect(body).toHaveProperty('diagnostics');
    expect(body['diagnostics']).toEqual([]);
  });

  it('診断の順序と件数を変えない（間引かない）', async () => {
    const source = stubSource(ok(SAMPLE_RESULT));

    const response = await app(source).request('/api/edinet/9433');
    const body = (await response.json()) as {
      diagnostics: readonly { sourceDocId: string; field: string }[];
    };

    expect(body.diagnostics.map((diagnostic) => diagnostic.sourceDocId)).toEqual([
      'S100YKG2',
      'S100YKG2',
      'S100VXGZ',
    ]);
    expect(body.diagnostics.map((diagnostic) => diagnostic.field)).toEqual([
      'eps',
      'currentAssets',
      'revenue',
    ]);
  });
});

describe('エラー→HTTPステータス変換', () => {
  const cases: ReadonlyArray<{ name: string; error: EdinetHistoryError; status: number }> = [
    { name: '銘柄コード形式不正 → 400', error: { kind: 'invalid-code', code: 'X' }, status: 400 },
    {
      name: 'docID未検出 → 404',
      error: { kind: 'document-not-found', code: '9433' },
      status: 404,
    },
    {
      name: '通信不能 → 502',
      error: { kind: 'source-unreachable', detail: 'HTTP 401' },
      status: 502,
    },
    {
      name: '応答が壊れている → 502',
      error: { kind: 'malformed-response', detail: 'SyntaxError' },
      status: 502,
    },
  ];

  it.each(cases)('$name', async ({ error, status }) => {
    const response = await app(stubSource(err(error))).request('/api/edinet/9433');
    expect(response.status).toBe(status);
  });

  it('エラー本文に内部情報（detail）を含めない', async () => {
    const response = await app(
      stubSource(err({ kind: 'source-unreachable', detail: 'internal-path-info' })),
    ).request('/api/edinet/9433');
    const body = await response.text();
    expect(body).not.toContain('internal-path-info');
  });
});
