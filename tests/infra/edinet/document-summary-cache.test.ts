import { describe, expect, it } from 'vitest';

import {
  type EdinetDocumentSummary,
  fromCacheEntry,
  toCacheEntry,
} from '@/infra/edinet/document-summary-cache';
import { type ParsedSummaryCsv } from '@/infra/edinet/parse-summary-csv';

const parsed: ParsedSummaryCsv = {
  epsSenByOffset: [18_359, 15_001, null, null, null],
  revenueSenByOffset: [607_191_500_000_000, null, null, null, null],
  roePercentByOffset: [13.93, null, null, null, null],
  operatingIncomeSenByOffset: [109_912_500_000_000, 108_746_800_000_000],
  balanceSheet: { currentAssetsSen: 470_650_700_000_000, investmentSecuritiesSen: null },
  diagnostics: [
    {
      field: 'eps',
      offset: 0,
      elementId: 'jpcrp_cor:BasicEarningsLossPerShareSummaryOfBusinessResults',
      reason: 'unit-mismatch',
      raw: 'unitId=JPY',
    },
  ],
};

const summary: EdinetDocumentSummary = parsed; // 現時点で構造は一致

describe('toCacheEntry / fromCacheEntry — 明示的な変換のラウンドトリップ（CR-3）', () => {
  it('toCacheEntry: ParsedSummaryCsv の全フィールドが1:1でコピーされる', () => {
    expect(toCacheEntry(parsed)).toEqual(summary);
  });

  it('fromCacheEntry: EdinetDocumentSummary の全フィールドが1:1でコピーされる', () => {
    expect(fromCacheEntry(summary)).toEqual(parsed);
  });

  it('ラウンドトリップで値が保たれる（diagnostics の空配列を含む）', () => {
    const empty: ParsedSummaryCsv = { ...parsed, diagnostics: [] };
    expect(fromCacheEntry(toCacheEntry(empty))).toEqual(empty);
  });

  it('balanceSheet が両方 null でもラウンドトリップする（境界値）', () => {
    const bothNull: ParsedSummaryCsv = {
      ...parsed,
      balanceSheet: { currentAssetsSen: null, investmentSecuritiesSen: null },
    };
    expect(fromCacheEntry(toCacheEntry(bothNull))).toEqual(bothNull);
  });

  it('operatingIncomeSenByOffset が [null, null]（両方欠損）でもラウンドトリップする（境界値）', () => {
    const bothNull: ParsedSummaryCsv = {
      ...parsed,
      operatingIncomeSenByOffset: [null, null],
    };
    expect(fromCacheEntry(toCacheEntry(bothNull))).toEqual(bothNull);
  });
});
