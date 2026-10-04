/**
 * 指標⑥ 配当維持可能年数。
 *
 * 仕様: `docs/02_design/logic/dividend-sustainability-scoring.md`
 * **旧実装には無い新規指標。**
 */

import { type MetricScore, scored, unavailable } from '../shared/metric-score';
import { scoreFromValidatedBand } from '../shared/score';
import { isSen } from '../shared/sen';
import { DIVIDEND_SUSTAINABILITY_BANDS } from './bands';
import { scoreByBands } from './metric-lookup';
import { type ScoreBand } from './score-band';

/**
 * 投資有価証券の算入率。売却時の税を考慮した**独自定義**（設計書 §3）。
 * 一般的な「現金同等物 − 有利子負債」ではない。意図的なものとして扱う。
 */
export const INVESTMENT_SECURITIES_RATE = 0.7;

export interface DividendSustainabilityInput {
  readonly currentAssets: number | null;
  readonly investmentSecurities: number | null;
  readonly totalLiabilities: number | null;
  /** 前期末の配当総額（銭） */
  readonly previousDividendTotal: number | null;
}

/**
 * ネットキャッシュ（銭）。`(流動資産 + 投資有価証券 × 0.7) − 負債総額`。
 *
 * **0.7 を掛けた時点で丸めない**（設計書 §3）。銭単位のまま小数で持ち回り、
 * 丸めるのは表示層の1箇所だけにする。
 */
export function netCashSen(
  currentAssets: number,
  investmentSecurities: number,
  totalLiabilities: number,
): number {
  return currentAssets + investmentSecurities * INVESTMENT_SECURITIES_RATE - totalLiabilities;
}

/**
 * 手元のネットキャッシュで現行の配当総額を何年維持できるかを採点する。
 *
 * ⚠️ **この指標の 0点は「債務超過」だけを意味する**（2026-07-27 決定 / 設計書 §7）。
 * 原典のままだと、配当3ヶ月分の現金がある会社と債務超過の会社がどちらも 0点になり、
 * 実質的に異なる財務状態を区別できなかった。
 *
 * ネットキャッシュちょうど 0 は **1点**（負ではないため）。区分表の最下段
 * `[0年, 2年) → 1点` が自然にこれを拾う。
 *
 * @param bands 判定に使う区分表。省略時は `bands.ts` のデフォルト定数（T-101で追加）
 */
export function calculateDividendSustainability(
  input: DividendSustainabilityInput,
  bands: readonly ScoreBand[] = DIVIDEND_SUSTAINABILITY_BANDS,
): MetricScore {
  const { currentAssets, investmentSecurities, totalLiabilities, previousDividendTotal } = input;

  if (
    currentAssets === null ||
    investmentSecurities === null ||
    totalLiabilities === null ||
    previousDividendTotal === null
  ) {
    return unavailable('input-missing');
  }
  if (
    !isSen(currentAssets) ||
    !isSen(investmentSecurities) ||
    !isSen(totalLiabilities) ||
    !isSen(previousDividendTotal)
  ) {
    return unavailable('input-invalid');
  }

  // 無配の会社は「何年維持できるか」を定義できない。0点ではなく判定不能（§6.3）
  if (previousDividendTotal === 0) return unavailable('division-by-zero');
  // 配当総額が負になるのは制度上ありえない
  if (previousDividendTotal < 0) return unavailable('input-invalid');

  const netCash = netCashSen(currentAssets, investmentSecurities, totalLiabilities);
  const years = netCash / previousDividendTotal;
  if (!Number.isFinite(years)) return unavailable('input-invalid');

  // 債務超過。区分表の外なので、表を引く前に落とす
  if (netCash < 0) return scored(scoreFromValidatedBand(0), years);

  return scoreByBands(bands, years);
}
