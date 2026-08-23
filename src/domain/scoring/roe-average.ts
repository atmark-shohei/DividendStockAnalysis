/**
 * 指標⑤ ROE の5年平均。
 *
 * 仕様: `docs/02_design/logic/roe-scoring.md`
 * この層は純粋関数のみ。DB にも HTTP にも触らない。
 */

import { type MetricScore, unavailable } from '../shared/metric-score';
import { ROE_AVERAGE_BANDS } from './bands';
import { scoreByBands } from './metric-lookup';
import { type ScoreBand } from './score-band';
import { mean, takeCompleteYears } from './series';

/** 平均を取る年数。設計書 §3「直近5年の単純平均」 */
export const ROE_AVERAGE_YEARS = 5;

export interface RoeAverageInput {
  /** 年度降順の ROE（%）。直近5年分が必要 */
  readonly roeHistory: readonly (number | null)[];
}

/**
 * 直近5年の ROE の単純平均を採点する。
 *
 * **負の平均 ROE は 0点**（§0.3）。区分表の最下段が下限なしで負まで伸びているため
 * ガードは要らない。他の指標のような「0%以下 → 0点」の行が無いのはこのため
 * （`bands.ts` の `ROE_AVERAGE_BANDS` のコメント参照）。
 *
 * 5年揃わない・`null` を含む場合は**判定不能**であり 0点ではない（§6.4）。
 *
 * @param bands 判定に使う区分表。省略時は `bands.ts` のデフォルト定数（T-101で追加）
 */
export function calculateRoeAverage(
  input: RoeAverageInput,
  bands: readonly ScoreBand[] = ROE_AVERAGE_BANDS,
): MetricScore {
  const window = takeCompleteYears(input.roeHistory, ROE_AVERAGE_YEARS);
  if (window === null) return unavailable('insufficient-history');

  const average = mean(window);
  if (average === null) return unavailable('input-invalid');

  return scoreByBands(bands, average);
}
