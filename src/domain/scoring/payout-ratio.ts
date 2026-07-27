/**
 * 指標③ 予想配当性向。
 *
 * 仕様: `docs/02_design/logic/payout-ratio-scoring.md`
 *
 * ⚠️ **この指標だけ 10段**（他は 11段）。`60〜70% → 2点` に統合した結果、
 * **1点を返す経路が無い**（2026-07-27 決定 / 設計書 §7）。バグではない。
 */

import { type MetricScore, scored, unavailable } from '../shared/metric-score';
import { scoreFromValidatedBand } from '../shared/score';
import { isSen } from '../shared/sen';
import { PAYOUT_RATIO_BANDS } from './bands';
import { scoreByBands } from './metric-lookup';

export interface PayoutRatioInput {
  /** 今期予想の1株配当（銭） */
  readonly forecastDividend: number | null;
  /** 今期予想の1株利益（銭）。**負（赤字）がありうる** */
  readonly forecastEps: number | null;
}

/**
 * 予想配当性向を採点する。**低いほど高得点**。
 *
 * 2つの 0点は原典の欠陥を埋めたもので、いずれも意図的（§0.3 / §0.4）:
 * - **EPS が負（赤字）→ 0点。** 原典のままだと配当性向が負になり
 *   「0%〜25% → 10点」に該当して**赤字企業が満点**を取った
 * - **無配（配当 0）→ 0点。** 配当性向 0% は数値上は最上位区分だが、
 *   高配当銘柄を探す目的に反する
 *
 * EPS が 0 はゼロ除算で**判定不能**。0点と混同しないこと。
 */
export function calculatePayoutRatio(input: PayoutRatioInput): MetricScore {
  const { forecastDividend, forecastEps } = input;

  if (forecastDividend === null || forecastEps === null) return unavailable('input-missing');
  if (!isSen(forecastDividend) || !isSen(forecastEps)) return unavailable('input-invalid');

  // 配当が負になるのは制度上ありえない。データ不良として判定不能にする
  if (forecastDividend < 0) return unavailable('input-invalid');

  if (forecastEps === 0) return unavailable('division-by-zero');

  const ratioPercent = (forecastDividend / forecastEps) * 100;

  // §0.3: EPS が赤字なら 0点。区分表を引く前に落とす（負の性向は表外）
  if (forecastEps < 0) return scored(scoreFromValidatedBand(0), ratioPercent);

  // §0.4: 無配は 0点。配当性向 0% は表の最上位（10点）に該当してしまうため、
  // 「性向が 0%」ではなく「配当額が 0」で分岐する
  if (forecastDividend === 0) return scored(scoreFromValidatedBand(0), 0);

  return scoreByBands(PAYOUT_RATIO_BANDS, ratioPercent);
}
