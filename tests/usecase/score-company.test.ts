import { describe, expect, it } from 'vitest';

import type { Company, FinancialRecord } from '@/domain/company/company';
import { seriesOf } from '@/domain/company/company';
import { scoreCompany } from '@/usecase/score-company';

/**
 * ユースケース層。**計算そのものは domain 側のテストで尽くしてある。**
 * ここで見たいのは「どのデータをどの指標へ渡しているか」だけ。
 */

function record(fiscalYear: number, overrides: Partial<FinancialRecord> = {}): FinancialRecord {
  return {
    fiscalYear,
    isForecast: false,
    epsSen: 10_000,
    roePercent: 15,
    revenueSen: 1_000_000,
    operatingMarginPercent: 20,
    dividendPerShareSen: 5_000,
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
  };
}

describe('系列は年度に揃える（添字＝何年前か）', () => {
  it('年度が連続していれば添字がそのまま年数になる', () => {
    const target = company([2025, 2024, 2023].map((year) => record(year, { epsSen: year })));
    expect(seriesOf(target, (r) => r.epsSen, 3)).toEqual([2025, 2024, 2023]);
  });

  it('途中の年度が欠けていたら、その位置に null を置いて詰めない', () => {
    // 2023年が無い会社。詰めると「2年前」が 2022 になり、成長率がずれる
    const target = company([2025, 2024, 2022].map((year) => record(year, { epsSen: year })));
    expect(seriesOf(target, (r) => r.epsSen, 4)).toEqual([2025, 2024, null, 2022]);
  });

  it('予想は混ぜない。平均・CAGR 系は実績だけを使う', () => {
    const target = company([
      record(2026, { isForecast: true, epsSen: 999_999 }),
      record(2025, { epsSen: 2025 }),
      record(2024, { epsSen: 2024 }),
    ]);
    expect(seriesOf(target, (r) => r.epsSen, 2)).toEqual([2025, 2024]);
  });

  it('実績が1件も無ければ空', () => {
    const target = company([record(2026, { isForecast: true })]);
    expect(seriesOf(target, (r) => r.epsSen, 5)).toEqual([]);
  });

  it('データが尽きた先まで null で埋めない', () => {
    // 埋めると「途中の年度が欠けている」と「履歴がそこで終わっている」が
    // 区別できなくなり、② 連続非減配年数が判定不能に倒れる
    const target = company([2025, 2024].map((year) => record(year, { epsSen: year })));
    expect(seriesOf(target, (r) => r.epsSen, 10)).toEqual([2025, 2024]);
  });
});

describe('履歴の末尾と欠損の区別（② 連続非減配年数）', () => {
  const decreasing = (year: number, sen: number) => record(year, { dividendPerShareSen: sen });

  it('履歴が尽きただけなら、そこまでの年数で採点する', () => {
    // 6年分すべて非減配 → 5年 → 3点。判定不能ではない
    const target = company([2025, 2024, 2023, 2022, 2021, 2020].map((y) => decreasing(y, 5_000)));
    const metric = scoreCompany(target).card.metrics.consecutiveYears;
    expect(metric.value).toBe(5);
    expect(metric.score).toBe(3);
  });

  it('途中の年度が欠けていたら判定不能。欠損を 0 とみなして「減配」にしない', () => {
    const target = company([2025, 2024, 2022, 2021].map((y) => decreasing(y, 5_000)));
    const metric = scoreCompany(target).card.metrics.consecutiveYears;
    expect(metric.score).toBeNull();
    expect(metric.unavailableReason).toBe('input-missing');
  });
});

describe('年度の欠落がスコアに与える影響', () => {
  /** 6年ぶん連続、配当は毎年 2倍に増える会社 */
  const contiguous = company(
    [2025, 2024, 2023, 2022, 2021, 2020].map((year, index) =>
      record(year, { dividendPerShareSen: 6_400 / 2 ** index }),
    ),
  );

  /** 上と同じだが、2022年のレコードだけ欠けている */
  const withGap = company(
    [2025, 2024, 2023, 2021, 2020].map((year) =>
      record(year, { dividendPerShareSen: 6_400 / 2 ** (2025 - year) }),
    ),
  );

  it('連続していれば ① は 5年前と比較する', () => {
    const metric = scoreCompany(contiguous).card.metrics.dividendGrowthRate;
    // 6400 → 200 の逆、つまり 5年で 32倍。CAGR = 100%
    expect(metric.value).toBeCloseTo(100, 6);
    expect(metric.score).toBe(10);
  });

  it('年度が欠けていても「5年前」の位置がずれない', () => {
    // 2020年（5年前）は存在するので、欠落があっても同じ結果になる
    const metric = scoreCompany(withGap).card.metrics.dividendGrowthRate;
    expect(metric.value).toBeCloseTo(100, 6);
    expect(metric.score).toBe(10);
  });

  it('5年前そのものが欠けていれば判定不能。0 を返さない', () => {
    const missingBase = company(
      [2025, 2024, 2023, 2022, 2021].map((year) =>
        record(year, { dividendPerShareSen: 6_400 / 2 ** (2025 - year) }),
      ),
    );
    const metric = scoreCompany(missingBase).card.metrics.dividendGrowthRate;
    expect(metric.score).toBeNull();
    expect(metric.unavailableReason).toBe('input-missing');
  });
});

describe('スコアカードの組み立て', () => {
  it('10指標すべてを返す', () => {
    const scoring = scoreCompany(company([record(2025)]));
    expect(Object.keys(scoring.card.metrics)).toHaveLength(10);
  });

  it('入力日時をそのまま返す（画面に出すため）', () => {
    const scoring = scoreCompany(company([record(2025)]));
    expect(scoring.fetchedAt).toBe('2026-07-28T00:00:00.000Z');
  });

  it('配当履歴が空なら ⑩ は判定不能で、採用元も null', () => {
    const scoring = scoreCompany(company([record(2025)]));
    expect(scoring.card.metrics.dividendYield.score).toBeNull();
    expect(scoring.dividendSource).toBeNull();
  });

  it('データが何も無くても総合点は 0/100・有効 0/10 になる（落ちない）', () => {
    const scoring = scoreCompany(company([]));
    expect(scoring.card.totalScore).toBe(0);
    expect(scoring.card.maxTotalScore).toBe(100);
    expect(scoring.card.effectiveMetricCount).toBe(0);
  });
});
