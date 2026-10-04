/**
 * 10指標の区分表。**すべての閾値をこのファイル1箇所に集める**（T-014 の決定）。
 *
 * 出典の相違（`docs/01_requirements/scoring-source-comparison.md`）が再燃したときに、
 * 判定ロジックではなく定数だけを差し替えられるようにするため。
 *
 * ⚠️ **④⑦⑧ は現在まったく同じ表だが、意図的に別々の定数として書いてある。**
 * 共有すると ⑦ の閾値を直したときに ④⑧ が黙って変わる。指標ごとに独立して
 * 出典の議論があるため、重複はここでは正しい。一致していることは
 * `bands.test.ts` で明示的に検証する。
 *
 * ⚠️ **「0%以下 → 0点」の行はここには無い。** 各指標の設計書 §5（例外処理）が
 * 定める規則であり、区分表を引く前に落とす。`[0, 2)` の区分に 0 ちょうどを
 * 取られないようにするためで、実装側のコメントで対応関係を明示している。
 */

import { type ScoreBand } from './score-band';

/** ① 直近5年間の増配率（CAGR）。単位 %。0%以下 → 0点 は実装側のガード */
export const DIVIDEND_GROWTH_RATE_BANDS: readonly ScoreBand[] = [
  { minInclusive: 30, maxExclusive: null, points: 10 },
  { minInclusive: 20, maxExclusive: 30, points: 9 },
  { minInclusive: 15, maxExclusive: 20, points: 8 },
  { minInclusive: 12, maxExclusive: 15, points: 7 },
  { minInclusive: 10, maxExclusive: 12, points: 6 },
  { minInclusive: 8, maxExclusive: 10, points: 5 },
  { minInclusive: 5, maxExclusive: 8, points: 4 },
  { minInclusive: 3, maxExclusive: 5, points: 3 },
  { minInclusive: 2, maxExclusive: 3, points: 2 },
  { minInclusive: 0, maxExclusive: 2, points: 1 },
];

/**
 * ② 連続非減配年数。単位 年。
 *
 * 他指標と違い 10/5/3/0 の4段しかない。段の粗さ（16年で5点、17年で10点）は
 * 認識したうえで正典据え置きと決定済み（設計書 §7）。
 */
export const CONSECUTIVE_YEARS_BANDS: readonly ScoreBand[] = [
  { minInclusive: 17, maxExclusive: null, points: 10 },
  { minInclusive: 10, maxExclusive: 17, points: 5 },
  { minInclusive: 5, maxExclusive: 10, points: 3 },
  { minInclusive: 0, maxExclusive: 5, points: 0 },
];

/**
 * ③ 予想配当性向。単位 %。**低いほど高得点**なので表の向きが他と逆。
 *
 * ⚠️ **この指標だけ 10段**（他は 11段）。原典の `60〜65% → 2点` /
 * `65〜70% → 1点` を `60〜70% → 2点` に統合したため、**1点を返す経路が無い**
 * （2026-07-27 決定 / 設計書 §7）。バグではない。
 */
export const PAYOUT_RATIO_BANDS: readonly ScoreBand[] = [
  { minInclusive: 0, maxExclusive: 25, points: 10 },
  { minInclusive: 25, maxExclusive: 30, points: 9 },
  { minInclusive: 30, maxExclusive: 35, points: 8 },
  { minInclusive: 35, maxExclusive: 40, points: 7 },
  { minInclusive: 40, maxExclusive: 45, points: 6 },
  { minInclusive: 45, maxExclusive: 50, points: 5 },
  { minInclusive: 50, maxExclusive: 55, points: 4 },
  { minInclusive: 55, maxExclusive: 60, points: 3 },
  { minInclusive: 60, maxExclusive: 70, points: 2 },
  { minInclusive: 70, maxExclusive: null, points: 0 },
];

/** ④ EPS の5年 CAGR。単位 %。0%以下 → 0点 は実装側のガード */
export const EPS_CAGR_BANDS: readonly ScoreBand[] = [
  { minInclusive: 20, maxExclusive: null, points: 10 },
  { minInclusive: 16, maxExclusive: 20, points: 9 },
  { minInclusive: 14, maxExclusive: 16, points: 8 },
  { minInclusive: 12, maxExclusive: 14, points: 7 },
  { minInclusive: 10, maxExclusive: 12, points: 6 },
  { minInclusive: 8, maxExclusive: 10, points: 5 },
  { minInclusive: 6, maxExclusive: 8, points: 4 },
  { minInclusive: 4, maxExclusive: 6, points: 3 },
  { minInclusive: 2, maxExclusive: 4, points: 2 },
  { minInclusive: 0, maxExclusive: 2, points: 1 },
];

/**
 * ⑤ ROE の5年平均。単位 %。
 *
 * 最下段の下限が `null`（下限なし）なのは、**負の平均 ROE を 0点にする**ため（§0.3）。
 * 原典の表は「0%〜2% → 0点」で負の範囲が表外だった。他の指標と違い、
 * この指標には「0%以下 → 0点」の行が無いので、最下段を負まで伸ばして表現する。
 */
export const ROE_AVERAGE_BANDS: readonly ScoreBand[] = [
  { minInclusive: 15, maxExclusive: null, points: 10 },
  { minInclusive: 12, maxExclusive: 15, points: 9 },
  { minInclusive: 10, maxExclusive: 12, points: 8 },
  { minInclusive: 8, maxExclusive: 10, points: 7 },
  { minInclusive: 7, maxExclusive: 8, points: 6 },
  { minInclusive: 6, maxExclusive: 7, points: 5 },
  { minInclusive: 5, maxExclusive: 6, points: 4 },
  { minInclusive: 4, maxExclusive: 5, points: 3 },
  { minInclusive: 3, maxExclusive: 4, points: 2 },
  { minInclusive: 2, maxExclusive: 3, points: 1 },
  { minInclusive: null, maxExclusive: 2, points: 0 },
];

/**
 * ⑥ 配当維持可能年数。単位 年。
 *
 * ⚠️ **この指標の 0点は「債務超過」だけを意味する**（2026-07-27 決定 / 設計書 §7）。
 * 原典の `1〜2年 → 1点` / `0〜1年 → 0点` を `0〜2年 → 1点` に統合してある。
 * 配当3ヶ月分の現金がある会社と債務超過の会社を同じ 0点にしないための変更。
 * ネットキャッシュが負のときだけ 0点にするガードは実装側にある。
 */
export const DIVIDEND_SUSTAINABILITY_BANDS: readonly ScoreBand[] = [
  { minInclusive: 30, maxExclusive: null, points: 10 },
  { minInclusive: 20, maxExclusive: 30, points: 9 },
  { minInclusive: 10, maxExclusive: 20, points: 8 },
  { minInclusive: 8, maxExclusive: 10, points: 7 },
  { minInclusive: 6, maxExclusive: 8, points: 6 },
  { minInclusive: 5, maxExclusive: 6, points: 5 },
  { minInclusive: 4, maxExclusive: 5, points: 4 },
  { minInclusive: 3, maxExclusive: 4, points: 3 },
  { minInclusive: 2, maxExclusive: 3, points: 2 },
  { minInclusive: 0, maxExclusive: 2, points: 1 },
];

/** ⑦ 売上高の5年 CAGR。単位 %。0%以下 → 0点 は実装側のガード */
export const REVENUE_CAGR_BANDS: readonly ScoreBand[] = [
  { minInclusive: 20, maxExclusive: null, points: 10 },
  { minInclusive: 16, maxExclusive: 20, points: 9 },
  { minInclusive: 14, maxExclusive: 16, points: 8 },
  { minInclusive: 12, maxExclusive: 14, points: 7 },
  { minInclusive: 10, maxExclusive: 12, points: 6 },
  { minInclusive: 8, maxExclusive: 10, points: 5 },
  { minInclusive: 6, maxExclusive: 8, points: 4 },
  { minInclusive: 4, maxExclusive: 6, points: 3 },
  { minInclusive: 2, maxExclusive: 4, points: 2 },
  { minInclusive: 0, maxExclusive: 2, points: 1 },
];

/** ⑧ 営業利益率の5年平均。単位 %。0%以下 → 0点 は実装側のガード */
export const OPERATING_MARGIN_BANDS: readonly ScoreBand[] = [
  { minInclusive: 20, maxExclusive: null, points: 10 },
  { minInclusive: 16, maxExclusive: 20, points: 9 },
  { minInclusive: 14, maxExclusive: 16, points: 8 },
  { minInclusive: 12, maxExclusive: 14, points: 7 },
  { minInclusive: 10, maxExclusive: 12, points: 6 },
  { minInclusive: 8, maxExclusive: 10, points: 5 },
  { minInclusive: 6, maxExclusive: 8, points: 4 },
  { minInclusive: 4, maxExclusive: 6, points: 3 },
  { minInclusive: 2, maxExclusive: 4, points: 2 },
  { minInclusive: 0, maxExclusive: 2, points: 1 },
];

/**
 * ⑨ MIX係数（PER × PBR）。単位 倍。**低いほど高得点**なので表の向きが逆。
 *
 * 最上位区分（下限 40倍・上が開いている）の点数が **0点**である点に注意。
 * PER か PBR が負のときは 0点にするガードが実装側にある（§0.3）。
 */
export const MIX_COEFFICIENT_BANDS: readonly ScoreBand[] = [
  { minInclusive: 0, maxExclusive: 10, points: 10 },
  { minInclusive: 10, maxExclusive: 12, points: 9 },
  { minInclusive: 12, maxExclusive: 15, points: 8 },
  { minInclusive: 15, maxExclusive: 18, points: 7 },
  { minInclusive: 18, maxExclusive: 22.5, points: 6 },
  { minInclusive: 22.5, maxExclusive: 25, points: 5 },
  { minInclusive: 25, maxExclusive: 27, points: 4 },
  { minInclusive: 27, maxExclusive: 30, points: 3 },
  { minInclusive: 30, maxExclusive: 33, points: 2 },
  { minInclusive: 33, maxExclusive: 40, points: 1 },
  { minInclusive: 40, maxExclusive: null, points: 0 },
];

/**
 * ⑩ 配当利回り。**閾値は 1/100 % 単位の整数**（550 = 5.50%）。
 *
 * 小数で持つと閾値そのものが丸め誤差を抱えるため、この指標だけ整数で持つ。
 * 判定式が `配当 * 10000 >= 閾値 * 株価` の整数比較になるのはこのため。
 */
export const DIVIDEND_YIELD_BANDS: readonly ScoreBand[] = [
  { minInclusive: 550, maxExclusive: null, points: 10 },
  { minInclusive: 525, maxExclusive: 550, points: 9 },
  { minInclusive: 500, maxExclusive: 525, points: 8 },
  { minInclusive: 475, maxExclusive: 500, points: 7 },
  { minInclusive: 450, maxExclusive: 475, points: 6 },
  { minInclusive: 425, maxExclusive: 450, points: 5 },
  { minInclusive: 400, maxExclusive: 425, points: 4 },
  { minInclusive: 375, maxExclusive: 400, points: 3 },
  { minInclusive: 350, maxExclusive: 375, points: 2 },
  { minInclusive: 325, maxExclusive: 350, points: 1 },
  { minInclusive: 0, maxExclusive: 325, points: 0 },
];
