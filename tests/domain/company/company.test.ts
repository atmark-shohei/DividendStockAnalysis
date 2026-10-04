import { describe, expect, it } from 'vitest';

import type { Company, FinancialRecord } from '@/domain/company/company';
import { latestActualRecord, latestForecastRecord } from '@/domain/company/company';

/**
 * `latestActualRecord` / `latestForecastRecord` の直接テスト（CR-4）。
 *
 * これまで `tests/usecase/score-company.test.ts` 経由の間接テストしか無かったが、
 * ③ の年度突き合わせ（ADR-0009 §6.4.1）の起点となる関数のため、`isForecast` の
 * フィルタと「同一年度に複数レコード」の挙動を個別に確認する
 * （`.claude/rules/backend.md`「`src/domain/` のロジックは必ずテストを書く」）。
 */

function record(
  fiscalYear: number,
  isForecast: boolean,
  overrides: Partial<FinancialRecord> = {},
): FinancialRecord {
  return {
    fiscalYear,
    isForecast,
    epsSen: 10_000,
    roePercent: 15,
    revenueSen: 1_000_000,
    operatingMarginPercent: 20,
    ...overrides,
  };
}

function company(records: readonly FinancialRecord[]): Company {
  return {
    code: '9999',
    name: 'テスト',
    records,
    dividends: [],
    balanceSheet: {
      currentAssetsSen: null,
      investmentSecuritiesSen: null,
      totalLiabilitiesSen: null,
      previousDividendTotalSen: null,
    },
    multiples: { per: null, perSource: null, pbr: null, pbrSource: null },
    priceSen: null,
    fetchedAt: '2026-07-28T00:00:00.000Z',
    epsHistoryRestated: false,
    revenueHistoryRestated: false,
  };
}

describe('latestActualRecord — ③ 実績側が使う最新の実績レコード', () => {
  it('最新年度の実績レコードを返す', () => {
    const target = company([record(2023, false), record(2025, false), record(2024, false)]);
    expect(latestActualRecord(target)?.fiscalYear).toBe(2025);
  });

  it('予想レコードは無視する（isForecast: true を除外）', () => {
    const target = company([
      record(2026, true, { epsSen: 999_999 }),
      record(2025, false, { epsSen: 10_000 }),
    ]);
    const latest = latestActualRecord(target);
    expect(latest?.fiscalYear).toBe(2025);
    expect(latest?.epsSen).toBe(10_000);
  });

  it('実績レコードが1件も無ければ null', () => {
    const target = company([record(2026, true)]);
    expect(latestActualRecord(target)).toBeNull();
  });

  it('レコードが空でも null', () => {
    expect(latestActualRecord(company([]))).toBeNull();
  });

  it('同一年度に複数の実績レコードがある場合、配列内で先に現れたものを返す（既存実装の挙動）', () => {
    // fiscalYear は「より大きい」ときだけ latest を更新するため、
    // 同じ年度の2件目は latest を上書きしない（重複自体は取り込み層の UNIQUE 制約で防ぐ前提）
    const first = record(2025, false, { epsSen: 1_111 });
    const second = record(2025, false, { epsSen: 2_222 });
    const target = company([first, second]);
    expect(latestActualRecord(target)).toBe(first);
  });
});

describe('latestForecastRecord — ③ 予想側が使う最新の予想レコード', () => {
  it('最新年度の予想レコードを返す', () => {
    const target = company([record(2026, true), record(2027, true), record(2025, false)]);
    expect(latestForecastRecord(target)?.fiscalYear).toBe(2027);
  });

  it('実績レコードは無視する（isForecast: false を除外）', () => {
    const target = company([
      record(2025, false, { epsSen: 10_000 }),
      record(2026, true, { epsSen: 12_000 }),
    ]);
    const latest = latestForecastRecord(target);
    expect(latest?.fiscalYear).toBe(2026);
    expect(latest?.epsSen).toBe(12_000);
  });

  it('予想レコードが1件も無ければ null', () => {
    const target = company([record(2025, false)]);
    expect(latestForecastRecord(target)).toBeNull();
  });

  it('レコードが空でも null', () => {
    expect(latestForecastRecord(company([]))).toBeNull();
  });

  it('同一年度に複数の予想レコードがある場合、配列内で先に現れたものを返す（既存実装の挙動）', () => {
    const first = record(2026, true, { epsSen: 1_111 });
    const second = record(2026, true, { epsSen: 2_222 });
    const target = company([first, second]);
    expect(latestForecastRecord(target)).toBe(first);
  });
});
