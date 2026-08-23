/**
 * 指標① 直近5年間の増配率（配当の5年 CAGR）。
 *
 * 仕様: `docs/02_design/logic/dividend-growth-rate-scoring.md`
 *
 * **「分割調整」列の値を使う。** 生の配当額を使うと株式分割の年に増配率が壊れる
 * （`scoring-requirements.md` §2.2）。調整済みの値を渡すのは取り込み層の責務。
 */

import { type MetricScore, scored, unavailable } from '../shared/metric-score';
import { scoreFromValidatedBand } from '../shared/score';
import { isSen } from '../shared/sen';
import { DIVIDEND_GROWTH_RATE_BANDS } from './bands';
import { scoreByBands, zeroOrBelowScoresZero } from './metric-lookup';
import { type ScoreBand } from './score-band';
import { cagrPercent } from './series';

export const DIVIDEND_GROWTH_YEARS = 5;

export interface DividendGrowthRateInput {
  /** 昨年の配当金（銭）。分割調整後 */
  readonly dividendLastYear: number | null;
  /** 5年前の配当金（銭）。分割調整後 */
  readonly dividendFiveYearsAgo: number | null;
}

/**
 * 配当の年平均成長率を採点する。
 *
 * 設計書 §5 の区別を守る:
 * - 5年前が 0（当時無配）→ **ゼロ除算で判定不能**。0点ではない
 * - 昨年が 0（減配して無配）→ **-100% で 0点**。判定不能ではない
 * - CAGR が 0% 以下（減配）→ **0点**
 *
 * 配当額が負になるのは制度上ありえないため、負は**データ不良として判定不能**にする。
 * ⑩ が負の配当を 0点に倒しているのは「利回り 0%」という意味が立つからで、
 * 増配率には対応する意味が無い。
 *
 * @param bands 判定に使う区分表。省略時は `bands.ts` のデフォルト定数（T-101で追加。
 *   ユーザーが指標カスタマイズで基準値を設定していない場合は必ず省略された状態で
 *   呼ばれ、既存の挙動と完全に一致する）
 */
export function calculateDividendGrowthRate(
  input: DividendGrowthRateInput,
  bands: readonly ScoreBand[] = DIVIDEND_GROWTH_RATE_BANDS,
): MetricScore {
  const { dividendLastYear, dividendFiveYearsAgo } = input;

  if (dividendLastYear === null || dividendFiveYearsAgo === null) {
    return unavailable('input-missing');
  }
  if (!isSen(dividendLastYear) || !isSen(dividendFiveYearsAgo)) {
    return unavailable('input-invalid');
  }
  if (dividendLastYear < 0 || dividendFiveYearsAgo < 0) return unavailable('input-invalid');
  if (dividendFiveYearsAgo === 0) return unavailable('division-by-zero');

  // 減配して無配になった場合。CAGR = 0^(1/5) - 1 = -100%（設計書 §5）
  if (dividendLastYear === 0) return scored(scoreFromValidatedBand(0), -100);

  const growth = cagrPercent(dividendLastYear, dividendFiveYearsAgo, DIVIDEND_GROWTH_YEARS);
  if (growth === null) return unavailable('input-invalid');

  return zeroOrBelowScoresZero(growth) ?? scoreByBands(bands, growth);
}
