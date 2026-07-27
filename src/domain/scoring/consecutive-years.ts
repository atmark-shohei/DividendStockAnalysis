/**
 * 指標② 連続非減配年数。
 *
 * 仕様: `docs/02_design/logic/consecutive-years-scoring.md`
 *
 * **「増配」ではなく「非減配」。** 横ばいを継続に含める（2026-07-27 決定 / 設計書 §7）。
 * 日本の高配当株はコロナ等で配当を据え置いた銘柄が多く、増配で数えると
 * そこで打ち切られて 0年になる。この指標が見たいのは**減配耐性**である。
 */

import { type MetricScore, unavailable } from '../shared/metric-score';
import { CONSECUTIVE_YEARS_BANDS } from './bands';
import { scoreByBands } from './metric-lookup';

/**
 * 遡る年数。設計書 §1「直近から過去18年前まで遡り」。
 *
 * 「18年前まで遡る」には**19年分の値**が要る（当年と18年前の間に18回の比較がある）。
 * 18年分しか見ないと最大 17年にしかならず、設計書 §5 の
 * 「全期間で非減配 → 18年」に届かない。
 */
export const CONSECUTIVE_LOOKBACK_YEARS = 18;

export interface ConsecutiveYearsInput {
  /** 年度降順の配当履歴（銭）。19年分まで見る */
  readonly dividendHistory: readonly (number | null)[];
}

/**
 * 連続非減配年数を数えて採点する。
 *
 * 直近年から過去へ順に走査し、`当年 < 前年` となった時点で打ち切る。
 * `当年 == 前年`（横ばい）は**継続**とみなす。
 *
 * **`null` は判定不能**（設計書 §5 / §6.4）。欠損を 0 とみなすと「減配した」と
 * 誤判定して年数が不当に短くなる。ただし「連続性の判定範囲内」に限る（§6.4）ので、
 * **減配で打ち切られた後ろにある `null` は結果に影響しない**。
 * 走査は打ち切り時点で止まるため、この区別は自然に満たされる。
 */
export function calculateConsecutiveYears(input: ConsecutiveYearsInput): MetricScore {
  // 「18年前まで遡る」= 当年を含めて19年分の値を比較対象にする
  const history = input.dividendHistory.slice(0, CONSECUTIVE_LOOKBACK_YEARS + 1);
  if (history.length === 0) return unavailable('input-missing');

  const latest = history[0];
  if (latest === null || latest === undefined) return unavailable('input-missing');

  let years = 0;
  for (let i = 0; i < history.length - 1; i++) {
    const current = history[i];
    const previous = history[i + 1];
    // ここに来る時点で current は非 null が確定している（前周で検査済み、初回は上で検査）。
    // previous が欠けていると、この年が非減配だったか判定できない
    if (current === null || current === undefined) return unavailable('input-missing');
    if (previous === null || previous === undefined) return unavailable('input-missing');
    if (current < previous) break;
    years++;
  }

  return scoreByBands(CONSECUTIVE_YEARS_BANDS, years);
}
