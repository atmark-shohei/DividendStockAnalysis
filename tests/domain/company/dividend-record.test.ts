import { describe, expect, it } from 'vitest';

import {
  type DividendRecord,
  actualDividendSeries,
  selectLatestActualDividend,
  selectLatestForecastDividend,
} from '@/domain/company/dividend-record';

/**
 * 配当を `DividendRecord` に一本化したときに要る2つの取り出し方
 * （`docs/adr/0009-dividend-single-source.md`「新たに必要になるもの」）。
 *
 * `actualDividendSeries` は `company.ts` の `seriesOf` と同じ規則で年度に揃える。
 * 観点も `tests/usecase/score-company.test.ts` の `seriesOf` と揃えてある。
 */

function actual(fiscalYear: number, annualAmountSen: number | null): DividendRecord {
  return { fiscalYear, kind: 'actual', annualAmountSen };
}

describe('actualDividendSeries — 実績配当を年度に揃える（添字＝何年前か）', () => {
  it('年度が連続していれば添字がそのまま年数になる', () => {
    const records = [actual(2025, 5_000), actual(2024, 4_000), actual(2023, 3_000)];
    expect(actualDividendSeries(records, 3)).toEqual([5_000, 4_000, 3_000]);
  });

  it('途中の年度が欠けていたら、その位置に null を置いて詰めない', () => {
    // 詰めると ① の「5年前」が実際には7年前になる
    const records = [actual(2025, 5_000), actual(2024, 4_000), actual(2022, 2_000)];
    expect(actualDividendSeries(records, 4)).toEqual([5_000, 4_000, null, 2_000]);
  });

  it('予想・修正は混ぜない。実績だけを使う', () => {
    const records: DividendRecord[] = [
      { fiscalYear: 2026, kind: 'forecast', annualAmountSen: 999_999 },
      { fiscalYear: 2025, kind: 'revised', annualAmountSen: 888_888 },
      actual(2025, 5_000),
      actual(2024, 4_000),
    ];
    expect(actualDividendSeries(records, 2)).toEqual([5_000, 4_000]);
  });

  it('実績が1件も無ければ空', () => {
    const records: DividendRecord[] = [
      { fiscalYear: 2026, kind: 'forecast', annualAmountSen: 8_400 },
    ];
    expect(actualDividendSeries(records, 5)).toEqual([]);
  });

  it('データが尽きた先まで null で埋めない', () => {
    // 埋めると ② が「履歴の末尾」と「欠損」を区別できず判定不能に倒れる
    const records = [actual(2025, 5_000), actual(2024, 4_000)];
    expect(actualDividendSeries(records, 10)).toEqual([5_000, 4_000]);
  });

  it('無配（0円）は欠損にしない', () => {
    const records = [actual(2025, 0), actual(2024, 4_000)];
    expect(actualDividendSeries(records, 2)).toEqual([0, 4_000]);
  });

  it('金額が null の年は null のまま返す（0 に丸めない）', () => {
    const records = [actual(2025, 5_000), actual(2024, null)];
    expect(actualDividendSeries(records, 2)).toEqual([5_000, null]);
  });
});

describe('selectLatestForecastDividend — ③ が使う予想配当', () => {
  it('予想のうち最新年度のものを返す', () => {
    const records: DividendRecord[] = [
      { fiscalYear: 2026, kind: 'forecast', annualAmountSen: 8_000 },
      { fiscalYear: 2027, kind: 'forecast', annualAmountSen: 8_400 },
      actual(2025, 5_000),
    ];
    expect(selectLatestForecastDividend(records)).toEqual({
      fiscalYear: 2027,
      amountSen: 8_400,
    });
  });

  it('同一年度に予想と修正が並んだら修正を採る（修正は予想の更新版）', () => {
    const records: DividendRecord[] = [
      { fiscalYear: 2027, kind: 'forecast', annualAmountSen: 8_400 },
      { fiscalYear: 2027, kind: 'revised', annualAmountSen: 9_000 },
    ];
    expect(selectLatestForecastDividend(records)).toEqual({
      fiscalYear: 2027,
      amountSen: 9_000,
    });
  });

  it('実績しか無ければ null（実績を予想として使わない）', () => {
    expect(selectLatestForecastDividend([actual(2025, 5_000)])).toBeNull();
  });

  it('レコードが空なら null', () => {
    expect(selectLatestForecastDividend([])).toBeNull();
  });

  it('金額が null の予想は採用しない', () => {
    const records: DividendRecord[] = [
      { fiscalYear: 2027, kind: 'forecast', annualAmountSen: null },
      { fiscalYear: 2026, kind: 'forecast', annualAmountSen: 8_000 },
    ];
    expect(selectLatestForecastDividend(records)).toEqual({
      fiscalYear: 2026,
      amountSen: 8_000,
    });
  });

  it('年度が壊れたレコードは採用しない', () => {
    const records: DividendRecord[] = [
      { fiscalYear: Number.NaN, kind: 'forecast', annualAmountSen: 9_999 },
      { fiscalYear: 2026, kind: 'forecast', annualAmountSen: 8_000 },
    ];
    expect(selectLatestForecastDividend(records)).toEqual({
      fiscalYear: 2026,
      amountSen: 8_000,
    });
  });
});

/**
 * `selectLatestForecastDividend` の対（③ 実績側。ADR-0009 の結合規則を実績側にも
 * 適用。設計書 §2 / §6.4.1）。観点は上の予想側テスト群と揃える。
 */
describe('selectLatestActualDividend — ③ 実績側が使う実績配当', () => {
  it('実績のうち最新年度のものを返す', () => {
    const records: DividendRecord[] = [
      actual(2025, 5_000),
      actual(2026, 5_400),
      { fiscalYear: 2027, kind: 'forecast', annualAmountSen: 8_000 },
    ];
    expect(selectLatestActualDividend(records)).toEqual({
      fiscalYear: 2026,
      amountSen: 5_400,
    });
  });

  it('予想・修正しか無ければ null（予想を実績として使わない）', () => {
    const records: DividendRecord[] = [
      { fiscalYear: 2027, kind: 'forecast', annualAmountSen: 8_400 },
      { fiscalYear: 2027, kind: 'revised', annualAmountSen: 9_000 },
    ];
    expect(selectLatestActualDividend(records)).toBeNull();
  });

  it('レコードが空なら null', () => {
    expect(selectLatestActualDividend([])).toBeNull();
  });

  it('金額が null の実績は採用しない', () => {
    const records: DividendRecord[] = [
      actual(2027, null),
      actual(2026, 5_000),
    ];
    expect(selectLatestActualDividend(records)).toEqual({
      fiscalYear: 2026,
      amountSen: 5_000,
    });
  });

  it('年度が壊れたレコードは採用しない', () => {
    const records: DividendRecord[] = [
      { fiscalYear: Number.NaN, kind: 'actual', annualAmountSen: 9_999 },
      actual(2026, 5_000),
    ];
    expect(selectLatestActualDividend(records)).toEqual({
      fiscalYear: 2026,
      amountSen: 5_000,
    });
  });
});
