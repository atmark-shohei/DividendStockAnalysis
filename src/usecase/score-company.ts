/**
 * ユースケース: 1社ぶんのスコアカードを算出する。
 *
 * **この層は「どのデータをどの指標へ渡すか」だけを決める。**
 * 計算・判定は一切書かない（`.claude/CLAUDE.md`「ドメインロジックを usecase に
 * 書かない」）。ここに `if (value > threshold)` が現れたら設計を間違えている。
 */

import {
  type Company,
  type PbrSource,
  type PerSource,
  latestActualRecord,
  latestForecastRecord,
  seriesOf,
} from '../domain/company/company';
import {
  type DividendSource,
  actualDividendSeries,
  selectAnnualDividend,
  selectLatestActualDividend,
  selectLatestForecastDividend,
} from '../domain/company/dividend-record';
import { calculateConsecutiveYears } from '../domain/scoring/consecutive-years';
import { calculateDividendGrowthRate } from '../domain/scoring/dividend-growth-rate';
import { calculateDividendSustainability } from '../domain/scoring/dividend-sustainability';
import {
  calculateDividendYield,
  dividendYieldToMetricScore,
} from '../domain/scoring/dividend-yield';
import { calculateEpsCagr } from '../domain/scoring/eps-cagr';
import { calculateMixCoefficient } from '../domain/scoring/mix-coefficient';
import { calculateOperatingMargin } from '../domain/scoring/operating-margin';
import { calculatePayoutRatio, payoutRatioToMetricScore } from '../domain/scoring/payout-ratio';
import { calculateRevenueCagr } from '../domain/scoring/revenue-cagr';
import { calculateRoeAverage } from '../domain/scoring/roe-average';
import { type ScoreCard, buildScoreCard } from '../domain/scoring/scoring-service';
import { type MetricScore } from '../domain/shared/metric-score';

/**
 * ①⑦ が比較する「5年前」の添字。`seriesOf` が年度に揃えた系列を返すので、
 * 添字がそのまま「何年前か」になる。
 */
const FIVE_YEARS_AGO_INDEX = 5;

/**
 * 各指標が必要とする系列の長さ。**必要年数より短くしない。**
 * ② が最長（18年前まで遡るので当年込みで19年分）。
 */
const SERIES_YEARS = 19;

/** 系列から添字の値を取り出す。範囲外は `null`（欠損と同じ扱い） */
function at(series: readonly (number | null)[], index: number): number | null {
  return series[index] ?? null;
}

/**
 * 採点結果。予想と実績を混ぜないため、平均・CAGR 系には実績だけを渡す（`seriesOf` が
 * 実績に絞る）。③ だけは今期予想・直近実績の両方を使う（`latestForecastRecord` /
 * `latestActualRecord` から取る）。
 */
export interface CompanyScoring {
  readonly card: ScoreCard;
  /** ⑩ が採用した配当の出所。画面に「予想」「実績」を併記するため */
  readonly dividendSource: DividendSource | null;
  /** ③ が採点に採用した出所。画面に「予想」「実績」を併記するため（設計書 §7） */
  readonly payoutRatioSource: 'forecast' | 'actual' | null;
  /** ③ 予想側の判定結果。採点への採用と無関係に常に持つ（表示用。設計書 §2） */
  readonly payoutRatioForecast: MetricScore;
  /** ③ 実績側の判定結果。同上 */
  readonly payoutRatioActual: MetricScore;
  /** ⑨ PER の出所。保存済みの値をそのまま通す（採点では算出しない） */
  readonly perSource: PerSource | null;
  /** ⑨ PBR の出所 */
  readonly pbrSource: PbrSource | null;
  /** 入力（解析）した日時。画面に必ず出す（`CLAUDE.md`） */
  readonly fetchedAt: string;
}

/**
 * 会社の財務データから10指標を採点し、スコアカードを返す。
 *
 * @param useActualForScoring ③ 予想配当性向で実績を強制採用するか（設計書 §5.1・§7）。
 *   既定 `false`（予想優先。予想が判定不能なら実績にフォールバック）
 */
export function scoreCompany(company: Company, useActualForScoring = false): CompanyScoring {
  // 年度に揃えた系列を作る。添字がそのまま「何年前か」になる（欠損年は null）
  // ①② の配当は `DividendRecord` から取る（ADR-0009）
  const dividendSeries = actualDividendSeries(company.dividends, SERIES_YEARS);
  const epsSeries = seriesOf(company, (record) => record.epsSen, SERIES_YEARS);
  const roeSeries = seriesOf(company, (record) => record.roePercent, SERIES_YEARS);
  const revenueSeries = seriesOf(company, (record) => record.revenueSen, SERIES_YEARS);
  const marginSeries = seriesOf(company, (record) => record.operatingMarginPercent, SERIES_YEARS);

  const forecast = latestForecastRecord(company);
  const selectedDividend = selectAnnualDividend(company.dividends);

  // ③ は予想EPSと予想配当が別の型に分かれたので年度で結合する。**揃わなければ
  // 両方 null。** 古い年度へ落とすと「今期予想EPS ÷ 前期の予想配当」になる（ADR-0009）
  const forecastDividend = selectLatestForecastDividend(company.dividends);
  const forecastYearsMatch =
    forecast !== null &&
    forecastDividend !== null &&
    forecast.fiscalYear === forecastDividend.fiscalYear;

  // ③ 実績側も同じ規則で年度を突き合わせる（設計書 §2 / §6.4.1。実績側にも ADR-0009 の
  // 「決定した結合規則」を適用する）
  const actual = latestActualRecord(company);
  const actualDividend = selectLatestActualDividend(company.dividends);
  const actualYearsMatch =
    actual !== null &&
    actualDividend !== null &&
    actual.fiscalYear === actualDividend.fiscalYear;

  const payoutRatioResult = calculatePayoutRatio({
    forecast: {
      dividendSen: forecastYearsMatch ? forecastDividend.amountSen : null,
      epsSen: forecastYearsMatch ? forecast.epsSen : null,
    },
    actual: {
      dividendSen: actualYearsMatch ? actualDividend.amountSen : null,
      epsSen: actualYearsMatch ? actual.epsSen : null,
    },
    useActualForScoring,
  });

  const yieldResult = calculateDividendYield({
    priceSen: company.priceSen,
    dividend: selectedDividend,
  });

  const card = buildScoreCard({
    // ① 昨年 = 直近の実績（添字0）、5年前 = 添字5
    dividendGrowthRate: calculateDividendGrowthRate({
      dividendLastYear: at(dividendSeries, 0),
      dividendFiveYearsAgo: at(dividendSeries, FIVE_YEARS_AGO_INDEX),
    }),
    consecutiveYears: calculateConsecutiveYears({ dividendHistory: dividendSeries }),
    payoutRatio: payoutRatioToMetricScore(payoutRatioResult),
    epsCagr: calculateEpsCagr({ epsHistory: epsSeries }),
    roeAverage: calculateRoeAverage({ roeHistory: roeSeries }),
    dividendSustainability: calculateDividendSustainability({
      currentAssets: company.balanceSheet.currentAssetsSen,
      investmentSecurities: company.balanceSheet.investmentSecuritiesSen,
      totalLiabilities: company.balanceSheet.totalLiabilitiesSen,
      previousDividendTotal: company.balanceSheet.previousDividendTotalSen,
    }),
    revenueCagr: calculateRevenueCagr({
      revenueCurrent: at(revenueSeries, 0),
      revenueFiveYearsAgo: at(revenueSeries, FIVE_YEARS_AGO_INDEX),
    }),
    operatingMargin: calculateOperatingMargin({ operatingMarginHistory: marginSeries }),
    mixCoefficient: calculateMixCoefficient({
      per: company.multiples.per,
      pbr: company.multiples.pbr,
    }),
    dividendYield: dividendYieldToMetricScore(yieldResult),
  });

  return {
    card,
    dividendSource: yieldResult.dividendSource,
    payoutRatioSource: payoutRatioResult.source,
    payoutRatioForecast: payoutRatioResult.forecast,
    payoutRatioActual: payoutRatioResult.actual,
    perSource: company.multiples.perSource,
    pbrSource: company.multiples.pbrSource,
    fetchedAt: company.fetchedAt,
  };
}
