/**
 * 指標④ EPS の5年 CAGR。
 *
 * 仕様: `docs/02_design/logic/eps-cagr-scoring.md`
 *
 * **単年同士を比べない。** 一過性の特別損益をならすため、直近3年の中央値と
 * 5年前から遡った3年の中央値を使う（設計書 §3）。旧実装は端点同士で比較しており、
 * 特別損益の年に当たると成長率が跳ねた。
 */

import { type MetricScore, scored, unavailable } from '../shared/metric-score';
import { scoreFromValidatedBand } from '../shared/score';
import { EPS_CAGR_BANDS } from './bands';
import { scoreByBands, zeroOrBelowScoresZero } from './metric-lookup';
import { cagrPercent, median, takeCompleteYears } from './series';

/** 中央値を取る窓の長さ */
export const EPS_MEDIAN_WINDOW = 3;
/** 必要な履歴の年数。直近3年 + 5年前から遡る3年 = 6年 */
export const EPS_REQUIRED_YEARS = 6;
/** 成長率を測る期間。指標名（5年CAGR）と原典の計算式に従い固定 */
export const EPS_CAGR_YEARS = 5;

export interface EpsCagrInput {
  /** 年度降順の EPS（銭）。最低6年分が必要 */
  readonly epsHistory: readonly (number | null)[];
  /**
   * EDINET取り込みの重複4期突き合わせで遡及修正が検出されたか
   * （`docs/02_design/logic/edinet-history-import.md` §4.3）。`true` なら
   * 系列の連続性が保証できないため判定不能に倒す。
   */
  readonly historyRestated: boolean;
}

/**
 * EPS の年平均成長率（中央値ベース）を採点する。
 *
 * 窓の取り方: `epsHistory` は年度降順なので、直近3年は添字 0〜2、
 * 「5年前から遡った3年」は添字 3〜5（＝3年前・4年前・5年前）になる。
 * 設計書が「最低6年分」を要求しているのはこの2つの窓がちょうど6年を覆うため。
 *
 * 設計書 §5 の区別を守る:
 * - 5年前側の中央値が 0 → **ゼロ除算で判定不能**
 * - 5年前側の中央値が負 → **成長率を定義できないので判定不能**（0点ではない）
 * - 成長率が 0% 以下 → **0点**
 */
export function calculateEpsCagr(input: EpsCagrInput): MetricScore {
  const window = takeCompleteYears(input.epsHistory, EPS_REQUIRED_YEARS);
  if (window === null) return unavailable('insufficient-history');
  // 6期そろわない銘柄は insufficient-history が先に返る（設計書 §4.3・§7.2）
  if (input.historyRestated) return unavailable('restated-history');

  const recentMedian = median(window.slice(0, EPS_MEDIAN_WINDOW));
  const baseMedian = median(window.slice(EPS_MEDIAN_WINDOW, EPS_REQUIRED_YEARS));
  if (recentMedian === null || baseMedian === null) return unavailable('input-invalid');

  if (baseMedian === 0) return unavailable('division-by-zero');
  if (baseMedian < 0) return unavailable('undefined-growth');

  // 黒字から赤字（または EPS 0）へ転落した場合。実数の5乗根が定義できないため
  // 成長率そのものは出せないが、「0% 以下」であることは確実なので 0点にする。
  // 表示値は下限の -100% に寄せる（設計書 §5「成長率が 0% 以下 → 0点」）。
  if (recentMedian <= 0) return scored(scoreFromValidatedBand(0), -100);

  const growth = cagrPercent(recentMedian, baseMedian, EPS_CAGR_YEARS);
  if (growth === null) return unavailable('input-invalid');

  return zeroOrBelowScoresZero(growth) ?? scoreByBands(EPS_CAGR_BANDS, growth);
}
