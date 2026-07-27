/**
 * 指標⑦ 売上高の5年 CAGR。
 *
 * 仕様: `docs/02_design/logic/revenue-cagr-scoring.md`
 */

import { type MetricScore, unavailable } from '../shared/metric-score';
import { REVENUE_CAGR_BANDS } from './bands';
import { scoreByBands, zeroOrBelowScoresZero } from './metric-lookup';
import { cagrPercent } from './series';

/** 成長率を測る期間。指標名（5年CAGR）と原典の計算式に従い固定 */
export const REVENUE_CAGR_YEARS = 5;

export interface RevenueCagrInput {
  /** 現在の売上高（銭） */
  readonly revenueCurrent: number | null;
  /** 5年前の売上高（銭） */
  readonly revenueFiveYearsAgo: number | null;
}

/**
 * 売上高の年平均成長率を採点する。
 *
 * 設計書 §5 の区別を守る:
 * - 5年前が 0 → **ゼロ除算で判定不能**（0点ではない）
 * - 5年前が負 → **成長率を定義できないので判定不能**（0点ではない）
 * - 成長率が 0% 以下（減収）→ **0点**
 */
export function calculateRevenueCagr(input: RevenueCagrInput): MetricScore {
  const { revenueCurrent, revenueFiveYearsAgo } = input;

  if (revenueCurrent === null || revenueFiveYearsAgo === null) {
    return unavailable('input-missing');
  }
  if (revenueFiveYearsAgo === 0) return unavailable('division-by-zero');
  if (revenueFiveYearsAgo < 0) return unavailable('undefined-growth');
  if (revenueCurrent < 0) return unavailable('undefined-growth');

  const growth = cagrPercent(revenueCurrent, revenueFiveYearsAgo, REVENUE_CAGR_YEARS);
  if (growth === null) return unavailable('input-invalid');

  return zeroOrBelowScoresZero(growth) ?? scoreByBands(REVENUE_CAGR_BANDS, growth);
}
