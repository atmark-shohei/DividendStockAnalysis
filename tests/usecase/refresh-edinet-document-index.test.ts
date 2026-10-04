import { describe, expect, it, vi } from 'vitest';

import { type CompanyRepository } from '@/domain/company/company-repository';
import {
  type EdinetDocumentIndexEntry,
  type EdinetDocumentIndexRepository,
  type EdinetDocumentsListSource,
} from '@/domain/company/edinet-document-index';
import { err, ok } from '@/domain/shared/result';
import { refreshEdinetDocumentIndex } from '@/usecase/refresh-edinet-document-index';

/**
 * `refreshEdinetDocumentIndex` — 日次バッチ本体（usecase 層。DB には触れない）。
 * 仕様: `docs/02_design/logic/edinet-history-import.md` §4.4・§7.3
 */

function companyRepository(
  months: readonly number[],
): Pick<CompanyRepository, 'listFiscalYearEndMonths'> {
  return { listFiscalYearEndMonths: () => Promise.resolve(months) };
}

function indexRepository(): EdinetDocumentIndexRepository & {
  upsertCalls: EdinetDocumentIndexEntry[][];
  refreshCalls: { refreshedAt: string; entryCount: number }[];
} {
  const upsertCalls: EdinetDocumentIndexEntry[][] = [];
  const refreshCalls: { refreshedAt: string; entryCount: number }[] = [];
  return {
    upsertCalls,
    refreshCalls,
    findDocId: () => Promise.resolve(null),
    findLatest: () => Promise.resolve(null),
    upsertMany: (entries) => {
      upsertCalls.push([...entries]);
      return Promise.resolve();
    },
    lastRefreshedAt: () => Promise.resolve(null),
    recordRefresh: (refreshedAt, entryCount) => {
      refreshCalls.push({ refreshedAt, entryCount });
      return Promise.resolve();
    },
  };
}

const SAMPLE_ENTRY: EdinetDocumentIndexEntry = {
  companyCode: '9433',
  fiscalYear: 2026,
  docId: 'S100YKG2',
  submittedAt: '2026-06-25T06:30:00.000Z',
};

describe('refreshEdinetDocumentIndex — 走査対象期間の絞り込み（§4.4）', () => {
  it('3月決算（走査対象は6月）: 6月中の日付なら documents.json を取得する', async () => {
    const documentsListSource: EdinetDocumentsListSource = {
      fetchByDate: () => Promise.resolve(ok([SAMPLE_ENTRY])),
    };
    const repo = indexRepository();

    // now() = 2026-06-26 00:00 JST(UTC+9) → 1日前(JST)は 2026-06-25 → 6月なので走査対象
    const result = await refreshEdinetDocumentIndex({
      documentsListSource,
      indexRepository: repo,
      companyRepository: companyRepository([3]),
      now: () => new Date('2026-06-25T15:00:00.000Z'), // UTC 15:00 = JST 6/26 00:00
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.scanned).toBe(true);
    expect(result.value.entryCount).toBe(1);
    expect(repo.upsertCalls).toEqual([[SAMPLE_ENTRY]]);
    expect(repo.refreshCalls).toHaveLength(1);
  });

  it('3月決算: 走査対象月（6月）以外の日付は documents.json を叩かずスキップする', async () => {
    const fetchByDate = vi.fn(() => Promise.resolve(ok([SAMPLE_ENTRY])));
    const documentsListSource: EdinetDocumentsListSource = { fetchByDate };
    const repo = indexRepository();

    // 1日前(JST)が 2026-07-01（7月）→ 3月決算の走査対象月(6月)に含まれない
    const result = await refreshEdinetDocumentIndex({
      documentsListSource,
      indexRepository: repo,
      companyRepository: companyRepository([3]),
      now: () => new Date('2026-07-01T15:00:00.000Z'), // JST 2026-07-02
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.scanned).toBe(false);
    expect(result.value.entryCount).toBe(0);
    expect(fetchByDate).not.toHaveBeenCalled();
    // スキップした日も「正常終了した」ことは記録する
    expect(repo.refreshCalls).toEqual([{ refreshedAt: expect.any(String), entryCount: 0 }]);
  });

  it('12月決算（走査対象は3月）が登録されていれば3月の日付で走査する', async () => {
    const documentsListSource: EdinetDocumentsListSource = {
      fetchByDate: () => Promise.resolve(ok([])),
    };
    const repo = indexRepository();

    // now=JST 2026-03-15 00:30 の「1日前」= 2026-03-14（3月）
    const result = await refreshEdinetDocumentIndex({
      documentsListSource,
      indexRepository: repo,
      companyRepository: companyRepository([12]),
      now: () => new Date('2026-03-14T15:30:00.000Z'), // JST 2026-03-15 00:30
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.scanned).toBe(true);
  });

  it('複数の決算月が登録されていれば、いずれかの走査対象月に一致すれば走査する', async () => {
    const documentsListSource: EdinetDocumentsListSource = {
      fetchByDate: () => Promise.resolve(ok([])),
    };
    const repo = indexRepository();

    const result = await refreshEdinetDocumentIndex({
      documentsListSource,
      indexRepository: repo,
      companyRepository: companyRepository([3, 12]), // 3月決算(→6月走査) と 12月決算(→3月走査)
      now: () => new Date('2026-03-14T15:30:00.000Z'), // 1日前(JST)は2026-03-14（12月決算の走査対象月）
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.scanned).toBe(true);
  });
});

describe('refreshEdinetDocumentIndex — 日付を明示した過去日バックフィル（§4.4）', () => {
  it('targetDate を渡すと、決算月の絞り込みを行わずその日を走査する', async () => {
    const fetchByDate = vi.fn(() => Promise.resolve(ok([SAMPLE_ENTRY])));
    const documentsListSource: EdinetDocumentsListSource = { fetchByDate };
    const repo = indexRepository();
    // 3月決算のみ登録 → 走査対象月は6月。7月の日付は日次バッチならスキップされる
    const listFiscalYearEndMonths = vi.fn(() => Promise.resolve([3]));

    const result = await refreshEdinetDocumentIndex({
      documentsListSource,
      indexRepository: repo,
      companyRepository: { listFiscalYearEndMonths },
      now: () => new Date('2026-08-09T00:00:00.000Z'),
      targetDate: '2025-07-15',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.scanned).toBe(true);
    expect(result.value.entryCount).toBe(1);
    expect(fetchByDate).toHaveBeenCalledWith('2025-07-15');
    expect(repo.upsertCalls).toEqual([[SAMPLE_ENTRY]]);
    // 決算月の絞り込みを通らないので、登録企業の決算月は引かない
    expect(listFiscalYearEndMonths).not.toHaveBeenCalled();
  });

  it('targetDate の日に有価証券報告書が1件も無くても成功として扱う（土日・休日）', async () => {
    const documentsListSource: EdinetDocumentsListSource = {
      fetchByDate: () => Promise.resolve(ok([])),
    };
    const repo = indexRepository();

    const result = await refreshEdinetDocumentIndex({
      documentsListSource,
      indexRepository: repo,
      companyRepository: companyRepository([3]),
      now: () => new Date('2026-08-09T00:00:00.000Z'),
      targetDate: '2025-06-14', // 土曜
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({ scanned: true, entryCount: 0 });
    expect(repo.refreshCalls).toHaveLength(1);
  });
});

describe('refreshEdinetDocumentIndex — 取得失敗の伝播', () => {
  it('documents.json の取得失敗はそのまま Result で返す。upsertMany は呼ばれない', async () => {
    const documentsListSource: EdinetDocumentsListSource = {
      fetchByDate: () => Promise.resolve(err({ kind: 'source-unreachable', detail: 'HTTP 500' })),
    };
    const repo = indexRepository();

    const result = await refreshEdinetDocumentIndex({
      documentsListSource,
      indexRepository: repo,
      companyRepository: companyRepository([3]),
      now: () => new Date('2026-06-25T15:00:00.000Z'),
    });

    expect(result.ok).toBe(false);
    expect(repo.upsertCalls).toEqual([]);
    // 失敗した回は lastRefreshedAt を進めない
    expect(repo.refreshCalls).toEqual([]);
  });
});
