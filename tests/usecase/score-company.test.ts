import { describe, expect, it } from 'vitest';

import type { Company, FinancialRecord } from '@/domain/company/company';
import { seriesOf } from '@/domain/company/company';
import type { DividendRecord } from '@/domain/company/dividend-record';
import { type ResolvedScoringBands } from '@/usecase/resolve-scoring-bands';
import { scoreCompany } from '@/usecase/score-company';
import { BANDS_BY_METRIC } from '@/usecase/get-scoring-bands';
import { type ScoreBand } from '@/domain/scoring/score-band';
import { METRIC_KEYS, type MetricKey } from '@/domain/shared/metric-key';

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
    ...overrides,
  };
}

/** ①②③ の入力は `DividendRecord` 側にある（ADR-0009） */
function actualDividend(fiscalYear: number, annualAmountSen: number | null): DividendRecord {
  return { fiscalYear, kind: 'actual', annualAmountSen };
}

function company(
  records: readonly FinancialRecord[],
  dividends: readonly DividendRecord[] = [],
): Company {
  return {
    code: '9999',
    name: 'テスト',
    records,
    dividends,
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
  const flat = (years: readonly number[]) =>
    company(
      years.map((year) => record(year)),
      years.map((year) => actualDividend(year, 5_000)),
    );

  it('履歴が尽きただけなら、そこまでの年数で採点する', () => {
    // 6年分すべて非減配 → 5年 → 3点。判定不能ではない
    const metric = scoreCompany(flat([2025, 2024, 2023, 2022, 2021, 2020])).card.metrics
      .consecutiveYears;
    expect(metric.value).toBe(5);
    expect(metric.score).toBe(3);
  });

  it('途中の年度が欠けていたら判定不能。欠損を 0 とみなして「減配」にしない', () => {
    const metric = scoreCompany(flat([2025, 2024, 2022, 2021])).card.metrics.consecutiveYears;
    expect(metric.score).toBeNull();
    expect(metric.unavailableReason).toBe('input-missing');
  });
});

describe('年度の欠落がスコアに与える影響', () => {
  const doubling = (years: readonly number[]) =>
    company(
      years.map((year) => record(year)),
      years.map((year) => actualDividend(year, 6_400 / 2 ** (2025 - year))),
    );

  /** 6年ぶん連続、配当は毎年 2倍に増える会社 */
  const contiguous = doubling([2025, 2024, 2023, 2022, 2021, 2020]);

  /** 上と同じだが、2022年のレコードだけ欠けている */
  const withGap = doubling([2025, 2024, 2023, 2021, 2020]);

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
    const metric = scoreCompany(doubling([2025, 2024, 2023, 2022, 2021])).card.metrics
      .dividendGrowthRate;
    expect(metric.score).toBeNull();
    expect(metric.unavailableReason).toBe('input-missing');
  });
});

/**
 * ③ 予想配当性向の年度突き合わせ（`docs/adr/0009-dividend-single-source.md`
 * 「決定した結合規則」の受入基準）。
 *
 * 一本化で予想EPSが `FinancialRecord`、予想配当が `DividendRecord` と別の型に
 * 分かれたため、年度で結合する。**揃わなければ判定不能。古い年度へ落とさない。**
 */
describe('③ 予想配当性向は予想EPSと予想配当の年度が揃ったときだけ採点する', () => {
  const forecastEps = (fiscalYear: number, epsSen: number) =>
    record(fiscalYear, { isForecast: true, epsSen });
  const forecastDividend = (
    fiscalYear: number,
    annualAmountSen: number,
    kind: 'forecast' | 'revised' = 'forecast',
  ): DividendRecord => ({ fiscalYear, kind, annualAmountSen });

  const payoutRatioOf = (target: Company) => scoreCompany(target).card.metrics.payoutRatio;

  it('予想EPSと予想配当が同じ年度で揃えばその年度で採点する', () => {
    const metric = payoutRatioOf(
      company([forecastEps(2027, 30_000)], [forecastDividend(2027, 9_000)]),
    );
    // 90円 ÷ 300円 = 30%
    expect(metric.value).toBeCloseTo(30, 6);
    expect(metric.score).not.toBeNull();
  });

  it('予想配当が1年古ければ判定不能。その年度へ落とさない', () => {
    const metric = payoutRatioOf(
      company([forecastEps(2027, 30_000)], [forecastDividend(2026, 9_000)]),
    );
    expect(metric.score).toBeNull();
    expect(metric.unavailableReason).toBe('input-missing');
  });

  it('予想EPSが1年古ければ判定不能', () => {
    const metric = payoutRatioOf(
      company([forecastEps(2026, 30_000)], [forecastDividend(2027, 9_000)]),
    );
    expect(metric.score).toBeNull();
    expect(metric.unavailableReason).toBe('input-missing');
  });

  it('同一年度に予想と修正が並んだら修正を採る', () => {
    const metric = payoutRatioOf(
      company(
        [forecastEps(2027, 30_000)],
        [forecastDividend(2027, 9_000), forecastDividend(2027, 12_000, 'revised')],
      ),
    );
    // 修正の 120円 ÷ 300円 = 40%（予想のままなら 30% になる）
    expect(metric.value).toBeCloseTo(40, 6);
  });

  it('予想がどちらも無ければ予想側は判定不能', () => {
    // record(2026) はデフォルトで isForecast: false なので、ここでは予想データが
    // 一切無い状態を作っている。`record`/`actualDividend` を使うため、実績側は
    // 判定できるデータが揃っている。
    const target = company([record(2026)], [actualDividend(2026, 9_000)]);
    expect(scoreCompany(target).payoutRatioForecast.unavailableReason).toBe('input-missing');
  });

  it(
    '2026-08-06 決定（設計書 §7 決定3）: 予想が判定不能なら実績にフォールバックする。' +
      '既定（useActualForScoring 未指定）の挙動が変わった点',
    () => {
      const target = company([record(2026)], [actualDividend(2026, 9_000)]);
      const scoring = scoreCompany(target);
      expect(scoring.payoutRatioSource).toBe('actual');
      expect(scoring.card.metrics.payoutRatio.score).not.toBeNull();
    },
  );

  it('予想も実績も無ければ判定不能（フォールバック先も無い場合）', () => {
    const metric = payoutRatioOf(company([], []));
    expect(metric.score).toBeNull();
    expect(metric.unavailableReason).toBe('input-missing');
  });
});

/**
 * ③ 実績側の年度突き合わせ（ADR-0009「決定した結合規則」を実績側にも適用。
 * 設計書 §2 / §6.4.1）。予想側の既存 describe と対にする。
 *
 * `useActualForScoring: true` で実績を強制採用し、`card.metrics.payoutRatio` を
 * 直接見ることで実績側の判定結果が採点に反映されることを確認する。
 */
describe('③ 予想配当性向は実績EPSと実績配当の年度が揃ったときだけ採点する（実績側）', () => {
  const actualEps = (fiscalYear: number, epsSen: number) => record(fiscalYear, { epsSen });
  const actualDividendRecord = (fiscalYear: number, annualAmountSen: number): DividendRecord => ({
    fiscalYear,
    kind: 'actual',
    annualAmountSen,
  });

  const payoutRatioOf = (target: Company) => scoreCompany(target, true).card.metrics.payoutRatio;

  it('実績EPSと実績配当が同じ年度で揃えばその年度で採点する', () => {
    const metric = payoutRatioOf(
      company([actualEps(2026, 30_000)], [actualDividendRecord(2026, 9_000)]),
    );
    // 90円 ÷ 300円 = 30%
    expect(metric.value).toBeCloseTo(30, 6);
    expect(metric.score).not.toBeNull();
  });

  it('実績配当が1年古ければ判定不能。その年度へ落とさない', () => {
    const metric = payoutRatioOf(
      company([actualEps(2026, 30_000)], [actualDividendRecord(2025, 9_000)]),
    );
    expect(metric.score).toBeNull();
    expect(metric.unavailableReason).toBe('input-missing');
  });

  it('実績EPSが1年古ければ判定不能', () => {
    const metric = payoutRatioOf(
      company([actualEps(2025, 30_000)], [actualDividendRecord(2026, 9_000)]),
    );
    expect(metric.score).toBeNull();
    expect(metric.unavailableReason).toBe('input-missing');
  });

  it('予想側は揃うが実績側は揃わない → 実績側を強制採用しているので判定不能', () => {
    const target = company(
      [record(2026, { isForecast: true, epsSen: 30_000 }), actualEps(2025, 30_000)],
      [
        { fiscalYear: 2026, kind: 'forecast', annualAmountSen: 9_000 },
        actualDividendRecord(2024, 9_000),
      ],
    );
    expect(payoutRatioOf(target).score).toBeNull();
  });

  it('実績側は揃うが予想側は揃わない → 実績を強制採用しているので実績側の判定結果が採点される', () => {
    const target = company(
      [record(2027, { isForecast: true, epsSen: 30_000 }), actualEps(2026, 30_000)],
      [
        { fiscalYear: 2025, kind: 'forecast', annualAmountSen: 9_000 },
        actualDividendRecord(2026, 9_000),
      ],
    );
    expect(payoutRatioOf(target).score).not.toBeNull();
  });
});

/**
 * ③ のソース選択（`useActualForScoring`。設計書 §5.1・§7）。
 * usecase 経由で `scoreCompany` に渡ったフラグが `calculatePayoutRatio` に届き、
 * `scoring.payoutRatioSource` へ反映されることを確認する（結線の確認。
 * 判定そのものは `tests/domain/scoring/payout-ratio.test.ts` §6.5 で尽くしてある）。
 */
describe('③ 予想配当性向のソース選択（useActualForScoring）', () => {
  const forecastEps = (fiscalYear: number, epsSen: number) =>
    record(fiscalYear, { isForecast: true, epsSen });
  const forecastDividendRecord = (fiscalYear: number, annualAmountSen: number): DividendRecord => ({
    fiscalYear,
    kind: 'forecast',
    annualAmountSen,
  });
  const actualEps = (fiscalYear: number, epsSen: number) => record(fiscalYear, { epsSen });
  const actualDividendRecord = (fiscalYear: number, annualAmountSen: number): DividendRecord => ({
    fiscalYear,
    kind: 'actual',
    annualAmountSen,
  });

  const bothAvailable = () =>
    company(
      [forecastEps(2027, 30_000), actualEps(2026, 30_000)],
      [forecastDividendRecord(2027, 9_000), actualDividendRecord(2026, 12_000)],
    );

  it('useActualForScoring 未指定（既定 false）→ 予想優先', () => {
    const scoring = scoreCompany(bothAvailable());
    expect(scoring.payoutRatioSource).toBe('forecast');
    // 90円 ÷ 300円 = 30%（予想側）
    expect(scoring.card.metrics.payoutRatio.value).toBeCloseTo(30, 6);
  });

  it('useActualForScoring: false かつ予想不能・実績可能 → 実績にフォールバックし、payoutRatioSource が actual になる', () => {
    const target = company([actualEps(2026, 30_000)], [actualDividendRecord(2026, 12_000)]);
    const scoring = scoreCompany(target, false);
    expect(scoring.payoutRatioSource).toBe('actual');
    // 120円 ÷ 300円 = 40%（実績側）
    expect(scoring.card.metrics.payoutRatio.value).toBeCloseTo(40, 6);
  });

  it('useActualForScoring: true → 実績を強制採用。payoutRatioSource が actual', () => {
    const scoring = scoreCompany(bothAvailable(), true);
    expect(scoring.payoutRatioSource).toBe('actual');
    expect(scoring.card.metrics.payoutRatio.value).toBeCloseTo(40, 6);
  });

  it('useActualForScoring: true かつ実績不能 → payoutRatio が null、payoutRatioSource も null（予想へフォールバックしない）', () => {
    const target = company([forecastEps(2027, 30_000)], [forecastDividendRecord(2027, 9_000)]);
    const scoring = scoreCompany(target, true);
    expect(scoring.card.metrics.payoutRatio.score).toBeNull();
    expect(scoring.payoutRatioSource).toBeNull();
  });

  it('予想・実績どちらの内訳も常に返す（表示用）', () => {
    const scoring = scoreCompany(bothAvailable(), false);
    expect(scoring.payoutRatioForecast.score).not.toBeNull();
    expect(scoring.payoutRatioActual.score).not.toBeNull();
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

/**
 * `priceSen`/`per`/`pbr` の配線確認（ブロッカー解消計画 §2.1・§5.1）。
 * 計算はしない。`company.priceSen`/`company.multiples.per`/`company.multiples.pbr` を
 * そのまま転記しているかだけを見る（`perSource`/`pbrSource` と同じ扱い）。
 */
describe('priceSen/per/pbr の配線（company からそのまま転記）', () => {
  it('値がある場合、そのまま転記される', () => {
    const target: Company = {
      ...company([record(2025)]),
      priceSen: 100_000,
      multiples: { per: 9, perSource: 'actual-eps', pbr: 1, pbrSource: 'actual-bps' },
    };
    const scoring = scoreCompany(target);
    expect(scoring.priceSen).toBe(100_000);
    expect(scoring.per).toBe(9);
    expect(scoring.pbr).toBe(1);
  });

  it('境界値: すべて欠損なら null のまま通る（0 に丸めない）', () => {
    const target: Company = {
      ...company([record(2025)]),
      priceSen: null,
      multiples: { per: null, perSource: null, pbr: null, pbrSource: null },
    };
    const scoring = scoreCompany(target);
    expect(scoring.priceSen).toBeNull();
    expect(scoring.per).toBeNull();
    expect(scoring.pbr).toBeNull();
  });

  it('境界値: per だけ算出できて pbr が欠損している場合、独立して転記される', () => {
    const target: Company = {
      ...company([record(2025)]),
      priceSen: 100_000,
      multiples: { per: 9, perSource: 'actual-eps', pbr: null, pbrSource: null },
    };
    const scoring = scoreCompany(target);
    expect(scoring.priceSen).toBe(100_000);
    expect(scoring.per).toBe(9);
    expect(scoring.pbr).toBeNull();
  });
});

/**
 * `company.epsHistoryRestated` / `revenueHistoryRestated` の配線確認
 * （`docs/02_design/logic/edinet-history-import.md` §4.3・§9。判定ロジックそのものは
 * `tests/domain/scoring/eps-cagr.test.ts` / `revenue-cagr.test.ts` で尽くしてある）。
 */
describe('EDINET遡及修正フラグの配線（company.epsHistoryRestated / revenueHistoryRestated）', () => {
  // 6年分そろった、成長率20%ちょうどの系列（判定不能に落ちないための土台）
  const sixYearHistory = (base: number) =>
    [2025, 2024, 2023, 2022, 2021, 2020].map((year, index) =>
      record(year, { epsSen: base * 2 ** (5 - index), revenueSen: base * 2 ** (5 - index) }),
    );

  it('company.epsHistoryRestated: true → ④だけが restated-history、⑦は影響を受けない', () => {
    const target: Company = {
      ...company(sixYearHistory(1_000)),
      epsHistoryRestated: true,
      revenueHistoryRestated: false,
    };
    const scoring = scoreCompany(target);
    expect(scoring.card.metrics.epsCagr.unavailableReason).toBe('restated-history');
    expect(scoring.card.metrics.revenueCagr.unavailableReason).not.toBe('restated-history');
  });

  it('company.revenueHistoryRestated: true → ⑦だけが restated-history、④は影響を受けない', () => {
    const target: Company = {
      ...company(sixYearHistory(1_000)),
      epsHistoryRestated: false,
      revenueHistoryRestated: true,
    };
    const scoring = scoreCompany(target);
    expect(scoring.card.metrics.revenueCagr.unavailableReason).toBe('restated-history');
    expect(scoring.card.metrics.epsCagr.unavailableReason).not.toBe('restated-history');
  });

  it('両方 false（既定）なら通常どおり採点する（回帰確認）', () => {
    const target: Company = {
      ...company(sixYearHistory(1_000)),
      epsHistoryRestated: false,
      revenueHistoryRestated: false,
    };
    const scoring = scoreCompany(target);
    expect(scoring.card.metrics.epsCagr.unavailableReason).toBeNull();
    expect(scoring.card.metrics.revenueCagr.unavailableReason).toBeNull();
  });
});

/**
 * `resolvedBands`（T-101 指標カスタマイズ）の配線確認。
 * 各 `calculate*` への `bands` の伝播・`buildScoreCard` への `selectedKeys` の伝播は
 * domain 側のテストで尽くしてある。ここで見たいのは「usecase層がこの引数を
 * 素通りさせているか」だけ。
 */
describe('resolvedBands（T-101 指標カスタマイズ）', () => {
  const doubling = (years: readonly number[]) =>
    company(
      years.map((year) => record(year)),
      years.map((year) => actualDividend(year, 6_400 / 2 ** (2025 - year))),
    );

  /** 6年ぶん連続、配当は毎年 2倍に増える会社。① は既定 bands なら 100%CAGR → 10点 */
  const contiguous = doubling([2025, 2024, 2023, 2022, 2021, 2020]);

  const ALWAYS_SEVEN: readonly ScoreBand[] = [{ minInclusive: null, maxExclusive: null, points: 7 }];

  function resolvedBandsFor(
    selectedKeys: readonly MetricKey[],
    overrides: Partial<Record<MetricKey, readonly ScoreBand[]>> = {},
  ): ResolvedScoringBands {
    const bandsByMetric = {} as Record<MetricKey, readonly ScoreBand[]>;
    for (const key of METRIC_KEYS) bandsByMetric[key] = overrides[key] ?? BANDS_BY_METRIC[key];
    return { selectedKeys, bandsByMetric };
  }

  it('省略時は現行どおり（全10指標・デフォルト bands）', () => {
    const scoring = scoreCompany(contiguous);
    expect(scoring.card.maxTotalScore).toBe(100);
    expect(scoring.card.totalMetricCount).toBe(10);
    expect(scoring.card.metrics.dividendGrowthRate.score).toBe(10);
  });

  it('カスタム bands を渡すと① の判定が変わる', () => {
    const resolvedBands = resolvedBandsFor(METRIC_KEYS, { dividendGrowthRate: ALWAYS_SEVEN });
    const scoring = scoreCompany(contiguous, false, resolvedBands);
    expect(scoring.card.metrics.dividendGrowthRate.score).toBe(7);
  });

  it('選択指標を5個に絞ると分母が50になり、選択外の指標は総合点に関与しない', () => {
    const selected: readonly MetricKey[] = [
      'dividendGrowthRate',
      'consecutiveYears',
      'roeAverage',
      'operatingMargin',
      'dividendYield',
    ];
    const resolvedBands = resolvedBandsFor(selected);
    const scoring = scoreCompany(contiguous, false, resolvedBands);
    expect(scoring.card.maxTotalScore).toBe(50);
    expect(scoring.card.totalMetricCount).toBe(5);
    // ①（選択に含む）は判定結果を持つが、⑦（選択に含まない）は合算に関与しない
    expect(scoring.card.metrics.dividendGrowthRate.score).toBe(10);
  });

  it('⑨MIX係数はカスタム bands を渡してもデフォルト定数で判定する（設定不可。ADR-0012 D-2）', () => {
    const resolvedBands = resolvedBandsFor(METRIC_KEYS, { mixCoefficient: ALWAYS_SEVEN });
    const withoutOverride = scoreCompany(contiguous);
    const withOverrideAttempt = scoreCompany(contiguous, false, resolvedBands);
    expect(withOverrideAttempt.card.metrics.mixCoefficient.score).toBe(
      withoutOverride.card.metrics.mixCoefficient.score,
    );
  });
});
