/**
 * 区分表の点数を `MetricScore` に変換する共通経路。
 *
 * 10指標が同じ形で結果を返すための唯一の入口。ここを通さずに `scored()` を
 * 直接呼ぶと、区分表の外に出た値が黙って最低点になる経路ができる。
 */

import { type MetricScore, scored, unavailable } from '../shared/metric-score';
import { scoreFromValidatedBand } from '../shared/score';
import { type ScoreBand, lookupBandIndex } from './score-band';

/**
 * 素の数値で区分表を引き、`MetricScore` と該当区分の添字を返す（T-108）。
 *
 * 区分表のどこにも該当しなければ `'value-out-of-band'` で**判定不能**にし、添字は `null`。
 * 最低点に倒さないのは、「表に穴がある」という実装の不具合を
 * 「評価が低い銘柄」として画面に出さないため。
 *
 * 比較式は `lookupPointsByValue` と同じ `value - threshold`。
 */
export function scoreByBandsWithIndex(
  bands: readonly ScoreBand[],
  value: number,
): { readonly metric: MetricScore; readonly bandIndex: number | null } {
  const bandIndex = lookupBandIndex(bands, (threshold) => value - threshold);
  const band = bandIndex === null ? undefined : bands[bandIndex];
  if (bandIndex === null || band === undefined) {
    return { metric: unavailable('value-out-of-band'), bandIndex: null };
  }
  return { metric: scored(scoreFromValidatedBand(band.points), value), bandIndex };
}

/**
 * 素の数値で区分表を引き、`MetricScore` にして返す。`scoreByBandsWithIndex` のラッパー。
 *
 * 区分表のどこにも該当しなければ `'value-out-of-band'` で**判定不能**にする。
 */
export function scoreByBands(bands: readonly ScoreBand[], value: number): MetricScore {
  return scoreByBandsWithIndex(bands, value).metric;
}

/**
 * 「0以下は 0点」の指標（①④⑦⑧）で使うガード。
 *
 * 各設計書 §5（例外処理）の「成長率が 0% 以下 → 0点」に対応する。
 * 区分表の最下段は `[0, 2) → 1点` なので、**0 ちょうどを区分表に渡すと 1点になってしまう**。
 * 表を引く前にここで落とす。
 *
 * @returns 0以下なら 0点の `MetricScore`。正なら `null`（呼び出し側が区分表を引く）
 */
export function zeroOrBelowScoresZero(value: number): MetricScore | null {
  if (value > 0) return null;
  return scored(scoreFromValidatedBand(0), value);
}
