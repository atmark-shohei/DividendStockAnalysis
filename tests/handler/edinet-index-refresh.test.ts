import { describe, expect, it, vi } from 'vitest';

import { type Company } from '@/domain/company/company';
import {
  type CompanyListResult,
  type CompanyRepository,
} from '@/domain/company/company-repository';
import {
  type EdinetDocumentIndexEntry,
  type EdinetDocumentIndexLookup,
  type EdinetDocumentIndexRepository,
  type EdinetDocumentsListSource,
} from '@/domain/company/edinet-document-index';
import { type EdinetHistorySource } from '@/domain/company/edinet-history-source';
import { type FinancialSource } from '@/domain/company/financial-source';
import { type MarketDataSource } from '@/domain/company/market-data-source';
import { err, ok } from '@/domain/shared/result';
import { type AppDependencies, createApp } from '@/handler/app';

import { buildAuthTestDependencies } from './support/build-app-dependencies';

/**
 * POST /api/admin/edinet/index/refresh の結線テスト。
 * 仕様: docs/02_design/logic/edinet-history-import.md §4.4「過去日の一括バックフィル」
 *
 * D1 を使わない（リポジトリは差し替える）ので unit プロジェクトで動く。
 * **実 API を叩かない**（`.claude/rules/backend.md`）。
 */

const TOKEN = 'test-admin-token';

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

function indexRepository(): EdinetDocumentIndexRepository & {
  upsertCalls: EdinetDocumentIndexEntry[][];
} {
  const upsertCalls: EdinetDocumentIndexEntry[][] = [];
  return {
    upsertCalls,
    findDocId: () => Promise.resolve(null),
    findLatest: () => Promise.resolve(null),
    upsertMany: (entries) => {
      upsertCalls.push([...entries]);
      return Promise.resolve();
    },
    lastRefreshedAt: () => Promise.resolve(null),
    recordRefresh: () => Promise.resolve(),
  };
}

const SAMPLE_ENTRY: EdinetDocumentIndexEntry = {
  companyCode: '9433',
  fiscalYear: 2025,
  docId: 'S100VXGZ',
  submittedAt: '2025-06-20T06:30:00.000Z',
};

function app(options: {
  documentsListSource?: EdinetDocumentsListSource;
  indexRepository?: EdinetDocumentIndexRepository;
  token?: string | undefined;
  withAdmin?: boolean;
}) {
  const admin =
    options.withAdmin === false
      ? undefined
      : {
          documentsListSource: options.documentsListSource ?? {
            fetchByDate: () => Promise.resolve(ok([SAMPLE_ENTRY])),
          },
          indexRepository: options.indexRepository ?? indexRepository(),
          token: 'token' in options ? options.token : TOKEN,
        };

  return createApp({
    repository: unusedRepository(),
    ...unusedSources(),
    ...buildAuthTestDependencies(),
    now: () => new Date('2026-08-09T00:00:00.000Z'),
    edinetIndexAdmin: admin,
  });
}

function refresh(target: ReturnType<typeof app>, date: string, token: string | null = TOKEN) {
  return target.request(`/api/admin/edinet/index/refresh?date=${date}`, {
    method: 'POST',
    headers: token === null ? {} : { 'X-Admin-Token': token },
  });
}

describe('管理用トークンによる保護', () => {
  it('EDINET_ADMIN_TOKEN が未設定なら 503 を返し、EDINET を叩かない', async () => {
    const fetchByDate = vi.fn(() => Promise.resolve(ok([SAMPLE_ENTRY])));

    const response = await refresh(
      app({ documentsListSource: { fetchByDate }, token: undefined }),
      '2025-06-20',
    );

    expect(response.status).toBe(503);
    expect(fetchByDate).not.toHaveBeenCalled();
  });

  it('依存そのものが渡されていなければ 503 を返す', async () => {
    const response = await refresh(app({ withAdmin: false }), '2025-06-20');

    expect(response.status).toBe(503);
  });

  it('トークンが一致しなければ 401 を返し、EDINET を叩かない', async () => {
    const fetchByDate = vi.fn(() => Promise.resolve(ok([SAMPLE_ENTRY])));

    const response = await refresh(
      app({ documentsListSource: { fetchByDate } }),
      '2025-06-20',
      'wrong-token',
    );

    expect(response.status).toBe(401);
    expect(fetchByDate).not.toHaveBeenCalled();
  });

  it('トークンヘッダが無ければ 401 を返す', async () => {
    const response = await refresh(app({}), '2025-06-20', null);

    expect(response.status).toBe(401);
  });
});

describe('date の検証', () => {
  it.each([
    ['形式違い', '2025/06/20'],
    ['桁足らず', '2025-6-2'],
    ['実在しない日', '2026-06-31'],
    ['実在しない月', '2026-13-01'],
    ['空', ''],
  ])('%s（%s）は 400 を返し、EDINET を叩かない', async (_label, date) => {
    const fetchByDate = vi.fn(() => Promise.resolve(ok([SAMPLE_ENTRY])));

    const response = await refresh(app({ documentsListSource: { fetchByDate } }), date);

    expect(response.status).toBe(400);
    expect(fetchByDate).not.toHaveBeenCalled();
  });

  it('うるう日（2024-02-29）は実在するので受け付ける', async () => {
    const fetchByDate = vi.fn(() => Promise.resolve(ok([])));

    const response = await refresh(app({ documentsListSource: { fetchByDate } }), '2024-02-29');

    expect(response.status).toBe(200);
    expect(fetchByDate).toHaveBeenCalledWith('2024-02-29');
  });
});

describe('取り込みに成功する', () => {
  it('指定した日付をそのままユースケースへ渡し、件数を返す', async () => {
    const fetchByDate = vi.fn(() => Promise.resolve(ok([SAMPLE_ENTRY])));
    const repo = indexRepository();

    const response = await refresh(
      app({ documentsListSource: { fetchByDate }, indexRepository: repo }),
      '2025-06-20',
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ date: '2025-06-20', scanned: true, entryCount: 1 });
    expect(fetchByDate).toHaveBeenCalledWith('2025-06-20');
    expect(repo.upsertCalls).toEqual([[SAMPLE_ENTRY]]);
  });

  it('有価証券報告書が1件も無い日でも 200・0件で返す（土日を潰さない）', async () => {
    const response = await refresh(
      app({ documentsListSource: { fetchByDate: () => Promise.resolve(ok([])) } }),
      '2025-06-21',
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ date: '2025-06-21', scanned: true, entryCount: 0 });
  });
});

describe('取り込みに失敗する', () => {
  it('EDINET へ到達できなければ 502 を返し、内部情報を漏らさない', async () => {
    const response = await refresh(
      app({
        documentsListSource: {
          fetchByDate: () =>
            Promise.resolve(err({ kind: 'source-unreachable', detail: 'HTTP 500' })),
        },
      }),
      '2025-06-20',
    );

    expect(response.status).toBe(502);
    const body = await response.json();
    expect(JSON.stringify(body)).not.toContain('HTTP 500');
  });

  it('認証失敗は「再試行してください」ではなく設定を確認する案内を返す', async () => {
    const response = await refresh(
      app({
        documentsListSource: {
          fetchByDate: () => Promise.resolve(err({ kind: 'authentication-failed' })),
        },
      }),
      '2025-06-20',
    );

    expect(response.status).toBe(502);
    const body = (await response.json()) as { error: string };
    expect(body.error).toContain('EDINET_API_KEY');
    // 時間をおいても直らないので、再試行を促さない
    expect(body.error).not.toContain('時間をおいて');
  });

  it('応答が壊れていれば 502 を返す', async () => {
    const response = await refresh(
      app({
        documentsListSource: {
          fetchByDate: () =>
            Promise.resolve(err({ kind: 'malformed-response', detail: 'results が配列でない' })),
        },
      }),
      '2025-06-20',
    );

    expect(response.status).toBe(502);
  });
});
