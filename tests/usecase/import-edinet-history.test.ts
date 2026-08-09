import { describe, expect, it } from 'vitest';

import { type EdinetDocumentIndexLookup } from '@/domain/company/edinet-document-index';
import {
  type EdinetHistoryError,
  type EdinetHistoryResult,
  type EdinetHistorySource,
} from '@/domain/company/edinet-history-source';
import { type Result, err, ok } from '@/domain/shared/result';
import { importEdinetHistory } from '@/usecase/import-edinet-history';

/**
 * `importEdinetHistory` — `EdinetHistorySource` への薄い委譲の確認
 * （`import-from-irbank.ts` と同型。判定ロジックは持たない）。
 */

const stubIndex: EdinetDocumentIndexLookup = {
  findDocId: () => Promise.resolve(null),
  findLatest: () => Promise.resolve(null),
};

function stubSource(
  result: Result<EdinetHistoryResult, EdinetHistoryError>,
): EdinetHistorySource & { calls: { code: string; index: EdinetDocumentIndexLookup }[] } {
  const calls: { code: string; index: EdinetDocumentIndexLookup }[] = [];
  return {
    calls,
    fetchHistory: (code: string, index: EdinetDocumentIndexLookup) => {
      calls.push({ code, index });
      return Promise.resolve(result);
    },
  };
}

const SAMPLE_RESULT: EdinetHistoryResult = {
  years: [
    { fiscalYear: 2026, epsSen: 18_359, revenueSen: 607_191_500_000_000, sourceDocId: 'S100YKG2' },
  ],
  epsHistoryRestated: false,
  revenueHistoryRestated: false,
  balanceSheet: null,
  diagnostics: [
    {
      field: 'revenue',
      offset: 2,
      fiscalYear: 2024,
      elementId: 'jpcrp_cor:NetSalesSummaryOfBusinessResults',
      reason: 'unit-mismatch',
      raw: 'unit=千円',
      sourceDocId: 'S100YKG2',
    },
  ],
};

describe('importEdinetHistory', () => {
  it('銘柄コードとインデックスをそのまま source.fetchHistory へ渡す', async () => {
    const source = stubSource(ok(SAMPLE_RESULT));

    await importEdinetHistory(source, '9433', stubIndex);

    expect(source.calls).toHaveLength(1);
    expect(source.calls[0]?.code).toBe('9433');
    expect(source.calls[0]?.index).toBe(stubIndex);
  });

  it('source の戻り値をそのまま返す（成功）', async () => {
    const source = stubSource(ok(SAMPLE_RESULT));

    const result = await importEdinetHistory(source, '9433', stubIndex);

    expect(result).toEqual(ok(SAMPLE_RESULT));
  });

  it('source の戻り値をそのまま返す（失敗）。判定・変換を挟まない', async () => {
    const source = stubSource(err({ kind: 'document-not-found', code: '9433' }));

    const result = await importEdinetHistory(source, '9433', stubIndex);

    expect(result).toEqual(err({ kind: 'document-not-found', code: '9433' }));
  });
});
