import { describe, expect, it } from 'vitest';

import type { Company, FinancialRecord } from '@/domain/company/company';
import type { DividendRecord } from '@/domain/company/dividend-record';
import { PAYOUT_RATIO_BANDS } from '@/domain/scoring/bands';
import { type ScoreBand } from '@/domain/scoring/score-band';
import { METRIC_KEYS } from '@/domain/shared/metric-key';
import { toScoringResponse } from '@/handler/dto/company-input';
import { BANDS_BY_METRIC } from '@/usecase/get-scoring-bands';
import { type ResolvedScoringBands } from '@/usecase/resolve-scoring-bands';
import { scoreCompany } from '@/usecase/score-company';

/**
 * `toScoringResponse` の③計算根拠の詰め替え（T-108 / company-api.md「T-108」ブロック）。
 *
 * domain の `PayoutRatioSideResult`（`metric` / `evidence` をネスト）を、DTO
 * `PayoutRatioSideView` では**同じ階層に平らに並べる**。丸めない・`null` を 0 にしない。
 * 判定そのものは domain テストで尽くしてあるので、ここでは写し方だけを見る。
 */

function forecastEps(fiscalYear: number, epsSen: number): FinancialRecord {
  return {
    fiscalYear,
    isForecast: true,
    epsSen,
    roePercent: null,
    revenueSen: null,
    operatingMarginPercent: null,
  };
}

function forecastDividend(fiscalYear: number, annualAmountSen: number): DividendRecord {
  return { fiscalYear, kind: 'forecast', annualAmountSen };
}

function company(
  records: readonly FinancialRecord[],
  dividends: readonly DividendRecord[],
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
    fetchedAt: '2026-09-23T00:00:00.000Z',
    epsHistoryRestated: false,
    revenueHistoryRestated: false,
  };
}

const SIDE_VIEW_KEYS = [
  'dividendFiscalYear',
  'dividendSen',
  'epsFiscalYear',
  'epsSen',
  'fiscalYearMismatch',
  'matchedBandIndex',
  'score',
  'unavailableReason',
  'value',
  'zeroScoreRule',
];

describe('toScoringResponse — ③ 片側の内訳を平らにする', () => {
  it('通常判定: 10 フィールドが同じ階層に並び、metric / evidence キーは存在しない', () => {
    // 予想 EPS 300円・予想配当 75円 → 25% → 9点（添字1）
    const response = toScoringResponse(
      scoreCompany(company([forecastEps(2027, 30_000)], [forecastDividend(2027, 7_500)])),
    );
    expect(Object.keys(response.payoutRatioForecast).sort()).toEqual(SIDE_VIEW_KEYS);
    expect(response.payoutRatioForecast).toEqual({
      score: 9,
      value: 25,
      unavailableReason: null,
      dividendSen: 7_500,
      dividendFiscalYear: 2027,
      epsSen: 30_000,
      epsFiscalYear: 2027,
      fiscalYearMismatch: false,
      zeroScoreRule: null,
      matchedBandIndex: 1,
    });
    expect(Object.keys(response.payoutRatioActual).sort()).toEqual(SIDE_VIEW_KEYS);
  });

  it('年度の食い違い: score null・fiscalYearMismatch true・値と年度はそのまま', () => {
    const response = toScoringResponse(
      scoreCompany(company([forecastEps(2027, 30_000)], [forecastDividend(2026, 7_500)])),
    );
    expect(response.payoutRatioForecast).toEqual({
      score: null,
      value: null,
      unavailableReason: 'input-missing',
      dividendSen: 7_500,
      dividendFiscalYear: 2026,
      epsSen: 30_000,
      epsFiscalYear: 2027,
      fiscalYearMismatch: true,
      zeroScoreRule: null,
      matchedBandIndex: null,
    });
  });

  it('無配: dividendSen は 0 のまま（null にしない）・zeroScoreRule が透過する', () => {
    const response = toScoringResponse(
      scoreCompany(company([forecastEps(2027, 30_000)], [forecastDividend(2027, 0)])),
    );
    expect(response.payoutRatioForecast.dividendSen).toBe(0);
    expect(response.payoutRatioForecast.score).toBe(0);
    expect(response.payoutRatioForecast.zeroScoreRule).toBe('no-dividend');
    expect(response.payoutRatioForecast.matchedBandIndex).toBeNull();
  });

  it('赤字: epsSen は負のまま・zeroScoreRule negative-eps が透過する', () => {
    const response = toScoringResponse(
      scoreCompany(company([forecastEps(2027, -10_000)], [forecastDividend(2027, 2_000)])),
    );
    expect(response.payoutRatioForecast.epsSen).toBe(-10_000);
    expect(response.payoutRatioForecast.score).toBe(0);
    expect(response.payoutRatioForecast.zeroScoreRule).toBe('negative-eps');
  });

  it('レコードが無い側は計算根拠がすべて null（0 にしない）', () => {
    const response = toScoringResponse(scoreCompany(company([], [])));
    expect(response.payoutRatioActual).toMatchObject({
      score: null,
      dividendSen: null,
      dividendFiscalYear: null,
      epsSen: null,
      epsFiscalYear: null,
      fiscalYearMismatch: false,
      matchedBandIndex: null,
    });
  });

  it('metrics[] の③は採用側の値のまま（回帰）', () => {
    const response = toScoringResponse(
      scoreCompany(company([forecastEps(2027, 30_000)], [forecastDividend(2027, 7_500)])),
    );
    const payoutRatio = response.metrics.find((metric) => metric.key === 'payoutRatio');
    expect(payoutRatio?.score).toBe(9);
    expect(payoutRatio?.value).toBe(25);
    expect(response.payoutRatioSource).toBe('forecast');
  });
});

describe('toScoringResponse — payoutRatioBands', () => {
  const target = company([forecastEps(2027, 30_000)], [forecastDividend(2027, 7_500)]);

  it('既定では PAYOUT_RATIO_BANDS と同じ内容で、要素のキーは 3 つだけ', () => {
    const response = toScoringResponse(scoreCompany(target));
    expect(response.payoutRatioBands).toEqual(PAYOUT_RATIO_BANDS);
    for (const band of response.payoutRatioBands) {
      expect(Object.keys(band).sort()).toEqual(['maxExclusive', 'minInclusive', 'points']);
    }
  });

  it('上書き表で採点した場合はその表を写し、matchedBandIndex はその表の添字', () => {
    const custom: readonly ScoreBand[] = [
      { minInclusive: 0, maxExclusive: 50, points: 6 },
      { minInclusive: 50, maxExclusive: null, points: 1 },
    ];
    const bandsByMetric = { ...BANDS_BY_METRIC, payoutRatio: custom };
    const resolvedBands: ResolvedScoringBands = { selectedKeys: METRIC_KEYS, bandsByMetric };

    const response = toScoringResponse(scoreCompany(target, false, resolvedBands));
    expect(response.payoutRatioBands).toEqual(custom);
    expect(response.payoutRatioForecast.matchedBandIndex).toBe(0);
    expect(response.payoutRatioForecast.score).toBe(6);
  });
});
