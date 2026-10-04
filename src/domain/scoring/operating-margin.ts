/**
 * 指標⑧ 営業利益率の5年平均。
 *
 * 仕様: `docs/02_design/logic/operating-margin-scoring.md`
 *
 * 🟡 **金融業（銀行・保険等）の扱いは保留**（設計書 §7、2026-07-27）。
 * 営業利益の概念が無い業種では履歴が空になり `null` を返す。§0.5 により
 * 総合点では 0点として合算されるため、**金融株は自動的に 10点分不利になる**。
 * この状態で金融株を他業種と単純比較しないこと。
 */

import { type MetricScore, unavailable } from '../shared/metric-score';
import { OPERATING_MARGIN_BANDS } from './bands';
import { scoreByBands, zeroOrBelowScoresZero } from './metric-lookup';
import { type ScoreBand } from './score-band';
import { mean, takeCompleteYears } from './series';

export const OPERATING_MARGIN_YEARS = 5;

export interface OperatingMarginInput {
  /** 年度降順の営業利益率（%）。直近5年分が必要 */
  readonly operatingMarginHistory: readonly (number | null)[];
}

/**
 * 直近5年の営業利益率の単純平均を採点する。
 *
 * 平均が **0% 以下（営業赤字）なら 0点**（設計書 §5）。区分表の最下段は
 * `[0%, 2%) → 1点` なので、0 ちょうどを表に渡すと 1点になってしまう。
 * 表を引く前に `zeroOrBelowScoresZero` で落とす。
 *
 * @param bands 判定に使う区分表。省略時は `bands.ts` のデフォルト定数（T-101で追加）
 */
export function calculateOperatingMargin(
  input: OperatingMarginInput,
  bands: readonly ScoreBand[] = OPERATING_MARGIN_BANDS,
): MetricScore {
  const window = takeCompleteYears(input.operatingMarginHistory, OPERATING_MARGIN_YEARS);
  if (window === null) return unavailable('insufficient-history');

  const average = mean(window);
  if (average === null) return unavailable('input-invalid');

  return zeroOrBelowScoresZero(average) ?? scoreByBands(bands, average);
}
