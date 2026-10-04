/**
 * 指標⑦ 売上高の5年 CAGR。
 *
 * 仕様: `docs/02_design/logic/revenue-cagr-scoring.md`
 */

import { type MetricScore, unavailable } from '../shared/metric-score';
import { REVENUE_CAGR_BANDS } from './bands';
import { scoreByBands, zeroOrBelowScoresZero } from './metric-lookup';
import { type ScoreBand } from './score-band';
import { cagrPercent } from './series';

/** 成長率を測る期間。指標名（5年CAGR）と原典の計算式に従い固定 */
export const REVENUE_CAGR_YEARS = 5;

export interface RevenueCagrInput {
  /** 現在の売上高（銭） */
  readonly revenueCurrent: number | null;
  /** 5年前の売上高（銭） */
  readonly revenueFiveYearsAgo: number | null;
  /**
   * EDINET取り込みの重複4期突き合わせで遡及修正が検出されたか
   * （`docs/02_design/logic/edinet-history-import.md` §4.3）。`true` なら
   * 系列の連続性が保証できないため判定不能に倒す。
   */
  readonly historyRestated: boolean;
}

/**
 * 売上高の年平均成長率を採点する。
 *
 * 設計書 §5 の区別を守る:
 * - 5年前が 0 → **ゼロ除算で判定不能**（0点ではない）
 * - 5年前が負 → **成長率を定義できないので判定不能**（0点ではない）
 * - 成長率が 0% 以下（減収）→ **0点**
 *
 * @param bands 判定に使う区分表。省略時は `bands.ts` のデフォルト定数（T-101で追加）
 */
export function calculateRevenueCagr(
  input: RevenueCagrInput,
  bands: readonly ScoreBand[] = REVENUE_CAGR_BANDS,
): MetricScore {
  const { revenueCurrent, revenueFiveYearsAgo } = input;

  if (revenueCurrent === null || revenueFiveYearsAgo === null) {
    return unavailable('input-missing');
  }
  // 6期そろわない銘柄は input-missing が先に返る（設計書 §4.3・§7.2 と同じ順序を④に揃える）
  if (input.historyRestated) return unavailable('restated-history');
  if (revenueFiveYearsAgo === 0) return unavailable('division-by-zero');
  if (revenueFiveYearsAgo < 0) return unavailable('undefined-growth');
  if (revenueCurrent < 0) return unavailable('undefined-growth');

  const growth = cagrPercent(revenueCurrent, revenueFiveYearsAgo, REVENUE_CAGR_YEARS);
  if (growth === null) return unavailable('input-invalid');

  return zeroOrBelowScoresZero(growth) ?? scoreByBands(bands, growth);
}
