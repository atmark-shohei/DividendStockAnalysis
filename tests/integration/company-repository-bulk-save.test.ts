import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

import { type EdinetDocumentIndexLookup } from '@/domain/company/edinet-document-index';
import { type EdinetHistorySource } from '@/domain/company/edinet-history-source';
import { type FinancialSource } from '@/domain/company/financial-source';
import { type MarketDataSource } from '@/domain/company/market-data-source';
import { createApp } from '@/handler/app';
import {
  D1CompanyRepository,
  D1_MAX_BOUND_PARAMETERS,
  maxRowsPerInsert,
} from '@/infra/d1/company-repository';
import type { AnalyzeCompanyRequest } from '@/handler/dto/company-input';

import {
  TEST_ADMIN_SESSION_COOKIE,
  buildAuthTestDependencies,
} from '../handler/support/build-app-dependencies';

/**
 * 明細の一括 INSERT が D1 のバインド変数上限（1文あたり100個）で落ちた回帰の再現テスト。
 *
 * 実測（2026-08-05, dev サーバーへ合成データを POST）:
 * - `dividend_records`（4列）: 25件(100 param)→201 / **26件(104 param)→500**
 * - `financial_records`（7列）: 14件(98 param)→201 / **15件(105 param)→500**
 *
 * 引き金は Yahoo 取り込みで配当が20〜28年ぶん入るようになったこと。
 * zod（`company-input.ts`）は 60件まで許可しているので、**60件で通ることまでを契約**とする。
 */

const FIXED_NOW = new Date('2026-07-28T00:00:00.000Z');

/** このテストファイルは外部取り込みを対象にしないので、呼ばれたら落とす */
const unusedFinancialSource: FinancialSource = {
  fetchByCode: () => {
    throw new Error('このテストで FinancialSource が呼ばれるのは想定外');
  },
};

const unusedMarketDataSource: MarketDataSource = {
  fetchByCode: () => {
    throw new Error('このテストで MarketDataSource が呼ばれるのは想定外');
  },
};

const unusedEdinetHistorySource: EdinetHistorySource = {
  fetchHistory: () => {
    throw new Error('このテストで EdinetHistorySource が呼ばれるのは想定外');
  },
};

const unusedEdinetDocumentIndexLookup: EdinetDocumentIndexLookup = {
  findDocId: () => {
    throw new Error('このテストで EdinetDocumentIndexLookup が呼ばれるのは想定外');
  },
  findLatest: () => {
    throw new Error('このテストで EdinetDocumentIndexLookup が呼ばれるのは想定外');
  },
};

function app() {
  return createApp({
    repository: new D1CompanyRepository(env.DB),
    financialSource: unusedFinancialSource,
    marketDataSource: unusedMarketDataSource,
    edinetHistorySource: unusedEdinetHistorySource,
    edinetDocumentIndexLookup: unusedEdinetDocumentIndexLookup,
    ...buildAuthTestDependencies(),
    now: () => FIXED_NOW,
  });
}

/** 直近年度から `count` 年ぶんの実績を作る（年度は降順・重複なし） */
function financialRecords(count: number): AnalyzeCompanyRequest['records'] {
  return Array.from({ length: count }, (_unused, index) => ({
    fiscalYear: 2025 - index,
    isForecast: false,
    epsSen: 30_000 - index * 100,
    roePercent: 15,
    revenueSen: 1_000_000_000 - index * 1_000_000,
    operatingMarginPercent: 20,
  }));
}

/** 直近年度から `count` 年ぶんの配当実績を作る（Yahoo 取り込みで20年超になる） */
function dividendRecords(count: number): AnalyzeCompanyRequest['dividends'] {
  return Array.from({ length: count }, (_unused, index) => ({
    fiscalYear: 2025 - index,
    kind: 'actual' as const,
    annualAmountSen: 6_000 - index * 10,
  }));
}

function payload(overrides: Partial<AnalyzeCompanyRequest> = {}): AnalyzeCompanyRequest {
  return {
    code: '8424',
    name: 'サンプルリース',
    records: financialRecords(6),
    dividends: dividendRecords(6),
    balanceSheet: {
      currentAssetsSen: 10_000_000,
      investmentSecuritiesSen: 0,
      totalLiabilitiesSen: 0,
      previousDividendTotalSen: 250_000,
    },
    multiples: { per: 9, perSource: 'manual', pbr: 1, pbrSource: 'manual' },
    priceSen: 100_000,
    ...overrides,
  };
}

/** `POST /api/companies` は `requireRole(['admin'])` で保護される。admin セッションで叩く */
async function post(request: AnalyzeCompanyRequest) {
  return app().request('/api/companies', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: TEST_ADMIN_SESSION_COOKIE },
    body: JSON.stringify(request),
  });
}

async function countOf(table: 'financial_records' | 'dividend_records' | 'transformed_metrics') {
  const row = await env.DB.prepare(`SELECT COUNT(*) AS count FROM ${table}`).first<{
    count: number;
  }>();
  return row?.count;
}

beforeEach(async () => {
  await env.DB.exec('DELETE FROM transformed_metrics');
  await env.DB.exec('DELETE FROM score_cards');
  await env.DB.exec('DELETE FROM dividend_records');
  await env.DB.exec('DELETE FROM financial_records');
  await env.DB.exec('DELETE FROM companies');
});

describe('明細の一括 INSERT は D1 のバインド変数上限（100個/文）で落ちない', () => {
  const cases: ReadonlyArray<{
    name: string;
    recordCount: number;
    dividendCount: number;
  }> = [
    // 旧実装が落ちた実測境界のちょうど1件手前（回帰の対照）
    { name: '配当25件 / 年度別14件: 旧実装でも通る境界', recordCount: 14, dividendCount: 25 },
    // 旧実装が 500 になった件数
    { name: '配当26件（104 param）: 旧実装で落ちた件数', recordCount: 6, dividendCount: 26 },
    { name: '年度別15件（105 param）: 旧実装で落ちた件数', recordCount: 15, dividendCount: 6 },
    // Yahoo 取り込みの実データ規模
    { name: '配当28件: Yahoo 取り込みの実データ規模', recordCount: 6, dividendCount: 28 },
    // zod（`company-input.ts`）が許可する上限。API の契約
    { name: '配当60件 / 年度別60件: zod が許可する上限', recordCount: 60, dividendCount: 60 },
  ];

  it.each(cases)('$name', async ({ recordCount, dividendCount }) => {
    const response = await post(
      payload({
        records: financialRecords(recordCount),
        dividends: dividendRecords(dividendCount),
      }),
    );

    expect(response.status).toBe(201);
    expect(await countOf('financial_records')).toBe(recordCount);
    expect(await countOf('dividend_records')).toBe(dividendCount);
  });

  it('60件を保存して読み戻すと、件数も内容も一致する（分割で行が欠落・重複しない）', async () => {
    const records = financialRecords(60);
    const dividends = dividendRecords(60);
    expect((await post(payload({ records, dividends }))).status).toBe(201);

    const stored = await new D1CompanyRepository(env.DB).findByCode('8424');
    expect(stored).not.toBeNull();
    // 保存側は年度降順で渡しているので、そのままの並びで戻る
    expect(stored?.records).toEqual(records);
    expect(stored?.dividends).toEqual(dividends);
  });

  it('整形指標は分割しても10件のまま（同じ構造の潜在バグ）', async () => {
    expect((await post(payload({ dividends: dividendRecords(60) }))).status).toBe(201);
    expect(await countOf('transformed_metrics')).toBe(10);
  });

  it('「全消し→入れ直し」は維持される。年度が減ったら古い行は残らない', async () => {
    expect((await post(payload({ dividends: dividendRecords(60) }))).status).toBe(201);
    expect(await countOf('dividend_records')).toBe(60);

    expect((await post(payload({ dividends: dividendRecords(3) }))).status).toBe(201);
    expect(await countOf('dividend_records')).toBe(3);

    const stored = await new D1CompanyRepository(env.DB).findByCode('8424');
    expect(stored?.dividends).toEqual(dividendRecords(3));
  });
});

describe('epsHistoryRestated/revenueHistoryRestated（CR-11。EDINET取り込みの遡及修正フラグ）', () => {
  it('epsHistoryRestated/revenueHistoryRestated が保存・再取得後も維持される', async () => {
    const response = await post(
      payload({ epsHistoryRestated: true, revenueHistoryRestated: true }),
    );
    expect(response.status).toBe(201);

    const stored = await new D1CompanyRepository(env.DB).findByCode('8424');
    expect(stored?.epsHistoryRestated).toBe(true);
    expect(stored?.revenueHistoryRestated).toBe(true);
  });

  it('epsHistoryRestated/revenueHistoryRestated 未指定時は false のまま保存・再取得される', async () => {
    const response = await post(payload());
    expect(response.status).toBe(201);

    const stored = await new D1CompanyRepository(env.DB).findByCode('8424');
    expect(stored?.epsHistoryRestated).toBe(false);
    expect(stored?.revenueHistoryRestated).toBe(false);
  });
});

describe('maxRowsPerInsert', () => {
  const cases: ReadonlyArray<{ name: string; columnCount: number; expected: number }> = [
    { name: 'dividend_records（4列）は 25行', columnCount: 4, expected: 25 },
    { name: 'transformed_metrics（5列）は 20行', columnCount: 5, expected: 20 },
    { name: 'financial_records（7列）は 14行', columnCount: 7, expected: 14 },
    { name: '上限ちょうど（100列）は 1行', columnCount: 100, expected: 1 },
    { name: '1行で上限を超える列数でも 0 行にしない', columnCount: 101, expected: 1 },
  ];

  it.each(cases)('$name', ({ columnCount, expected }) => {
    expect(maxRowsPerInsert(columnCount)).toBe(expected);
  });

  it('導出した行数は 1文あたり100 param を超えない', () => {
    for (let columnCount = 1; columnCount <= 100; columnCount += 1) {
      expect(maxRowsPerInsert(columnCount) * columnCount).toBeLessThanOrEqual(
        D1_MAX_BOUND_PARAMETERS,
      );
    }
  });
});
