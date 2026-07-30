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
  latestForecastRecord,
  seriesOf,
} from '../domain/company/company';
import {
  type DividendSource,
  actualDividendSeries,
  selectAnnualDividend,
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
import { calculatePayoutRatio } from '../domain/scoring/payout-ratio';
import { calculateRevenueCagr } from '../domain/scoring/revenue-cagr';
import { calculateRoeAverage } from '../domain/scoring/roe-average';
import { type ScoreCard, buildScoreCard } from '../domain/scoring/scoring-service';

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
 * 会社の財務データから10指標を採点し、スコアカードを返す。
 *
 * 予想と実績を混ぜないため、平均・CAGR 系には実績だけを渡す（`seriesOf` が
 * 実績に絞る）。③ だけは今期予想を使うので `latestForecastRecord` から取る。
 */
export interface CompanyScoring {
  readonly card: ScoreCard;
  /** ⑩ が採用した配当の出所。画面に「予想」「実績」を併記するため */
  readonly dividendSource: DividendSource | null;
  /** ⑨ PER の出所。保存済みの値をそのまま通す（採点では算出しない） */
  readonly perSource: PerSource | null;
  /** ⑨ PBR の出所 */
  readonly pbrSource: PbrSource | null;
  /** 入力（解析）した日時。画面に必ず出す（`CLAUDE.md`） */
  readonly fetchedAt: string;
}

export function scoreCompany(company: Company): CompanyScoring {
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
    payoutRatio: calculatePayoutRatio({
      forecastDividend: forecastYearsMatch ? forecastDividend.amountSen : null,
      forecastEps: forecastYearsMatch ? forecast.epsSen : null,
    }),
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
    perSource: company.multiples.perSource,
    pbrSource: company.multiples.pbrSource,
    fetchedAt: company.fetchedAt,
  };
}
