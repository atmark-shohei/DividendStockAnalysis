import { describe, expect, it, vi } from 'vitest';

import { type Company } from '@/domain/company/company';
import { type CompanyRepository, type CompanySummary } from '@/domain/company/company-repository';
import { type EdinetDocumentIndexLookup } from '@/domain/company/edinet-document-index';
import { type EdinetHistorySource } from '@/domain/company/edinet-history-source';
import { type FinancialSource } from '@/domain/company/financial-source';
import { type MarketDataSource } from '@/domain/company/market-data-source';
import { type AppDependencies, createApp } from '@/handler/app';

/**
 * POST /api/admin/edinet/document-summary-cache/clear の結線テスト。
 * 仕様: `docs/02_design/logic/edinet-history-import.md` §4.8.3
 *
 * D1 を使わない（リポジトリは Fake に差し替える）ので unit プロジェクトで動く。
 * `tests/handler/edinet-index-refresh.test.ts` と同型。**実 API を叩かない**
 * （`.claude/rules/backend.md`）。
 */

const TOKEN = 'test-admin-token';

function unusedRepository(): CompanyRepository {
  const fail = (): never => {
    throw new Error('このテストでリポジトリが呼ばれるのは想定外');
  };
  return {
    save: (): Promise<void> => fail(),
    findByCode: (): Promise<Company | null> => fail(),
    listSummaries: (): Promise<readonly CompanySummary[]> => fail(),
    deleteByCode: (): Promise<void> => fail(),
    listFiscalYearEndMonths: (): Promise<readonly number[]> => fail(),
  };
}

function unusedSources(): Pick<
  AppDependencies,
  'financialSource' | 'marketDataSource' | 'edinetHistorySource' | 'edinetDocumentIndexLookup'
> {
  const fail = (): never => {
    throw new Error('このテストで外部データ源が呼ばれるのは想定外');
  };
  const financialSource: FinancialSource = { fetchByCode: fail };
  const marketDataSource: MarketDataSource = { fetchByCode: fail };
  const edinetHistorySource: EdinetHistorySource = { fetchHistory: fail };
  const edinetDocumentIndexLookup: EdinetDocumentIndexLookup = {
    findDocId: () => Promise.resolve(null),
    findLatest: () => Promise.resolve(null),
  };
  return { financialSource, marketDataSource, edinetHistorySource, edinetDocumentIndexLookup };
}

function fakeRepository(clearAllResult = 0): {
  repository: { clearAll(): Promise<number> };
  clearAllCalls: number;
} {
  let clearAllCalls = 0;
  return {
    repository: {
      clearAll: () => {
        clearAllCalls += 1;
        return Promise.resolve(clearAllResult);
      },
    },
    get clearAllCalls() {
      return clearAllCalls;
    },
  };
}

function app(options: {
  repository?: { clearAll(): Promise<number> };
  token?: string | undefined;
  withAdmin?: boolean;
}) {
  const admin =
    options.withAdmin === false
      ? undefined
      : {
          repository: options.repository ?? fakeRepository().repository,
          token: 'token' in options ? options.token : TOKEN,
        };

  return createApp({
    repository: unusedRepository(),
    ...unusedSources(),
    now: () => new Date('2026-08-15T00:00:00.000Z'),
    edinetSummaryCacheAdmin: admin,
  });
}

function clearRequest(target: ReturnType<typeof app>, token: string | null = TOKEN) {
  return target.request('/api/admin/edinet/document-summary-cache/clear', {
    method: 'POST',
    headers: token === null ? {} : { 'X-Admin-Token': token },
  });
}

describe('管理用トークンによる保護', () => {
  it('EDINET_ADMIN_TOKEN が未設定なら 503 を返し、clearAll を呼ばない', async () => {
    const { repository, clearAllCalls: before } = fakeRepository();
    const clearAll = vi.spyOn(repository, 'clearAll');

    const response = await clearRequest(app({ repository, token: undefined }));

    expect(response.status).toBe(503);
    expect(clearAll).not.toHaveBeenCalled();
    expect(before).toBe(0);
  });

  it('edinetSummaryCacheAdmin 自体が未注入なら 503 を返す', async () => {
    const response = await clearRequest(app({ withAdmin: false }));

    expect(response.status).toBe(503);
  });

  it('トークンが一致しなければ 401 を返し、clearAll を呼ばない', async () => {
    const { repository } = fakeRepository();
    const clearAll = vi.spyOn(repository, 'clearAll');

    const response = await clearRequest(app({ repository }), 'wrong-token');

    expect(response.status).toBe(401);
    expect(clearAll).not.toHaveBeenCalled();
  });

  it('トークンヘッダが無ければ 401 を返す', async () => {
    const response = await clearRequest(app({}), null);

    expect(response.status).toBe(401);
  });
});

describe('トークン一致 — 全行削除に成功する', () => {
  it('clearAll が呼ばれ、削除件数を { cleared } で返す', async () => {
    const { repository } = fakeRepository(3);
    const clearAll = vi.spyOn(repository, 'clearAll');

    const response = await clearRequest(app({ repository }));

    expect(response.status).toBe(200);
    expect(clearAll).toHaveBeenCalledTimes(1);
    expect(await response.json()).toEqual({ cleared: 3 });
  });

  it('削除対象が0件でも 200・{ cleared: 0 } を返す', async () => {
    const response = await clearRequest(app({ repository: fakeRepository(0).repository }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ cleared: 0 });
  });
});
