/**
 * 指標② 連続非減配年数。
 *
 * 仕様: `docs/02_design/logic/consecutive-years-scoring.md`
 *
 * **「増配」ではなく「非減配」。** 横ばいを継続に含める（2026-07-27 決定 / 設計書 §7）。
 * 日本の高配当株はコロナ等で配当を据え置いた銘柄が多く、増配で数えると
 * そこで打ち切られて 0年になる。この指標が見たいのは**減配耐性**である。
 */

import { type DividendRecord, actualDividendSeriesWithYear } from '../company/dividend-record';
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

/** 年次リスト1行の状態。`null` は前年比較ができない（先頭行、または前年・当年のどちらかが欠損） */
export type ConsecutiveYearState = 'increase' | 'flat' | 'decrease' | null;

/** ② 連続非減配年数の年次リスト（指標詳細ダイアログ）の1行分 */
export interface ConsecutiveYearRow {
  /** 決算年度。2024年3月期なら 2024 */
  readonly fiscalYear: number;
  /** 年間配当の合計（銭）。null=データなし（0の無配とは別物） */
  readonly amountSen: number | null;
  /** 前年からの差分（銭）。判定不能なら null（0 に丸めない） */
  readonly diffSen: number | null;
  /** 前年比較の結果。判定不能なら null */
  readonly state: ConsecutiveYearState;
}

/**
 * ② 連続非減配年数の年次リスト（指標詳細ダイアログ用。`GET /api/companies/:code/dividends`
 * の `consecutiveYearRows`）。
 *
 * **`calculateConsecutiveYears` と同一のデータソース**（`actualDividendSeriesWithYear`。
 * 実績限定・欠落年を `null` でフレーム化）を使う。①配当推移が使う `dividendHistoryByYear`
 * （予想も含む・欠落年をスキップ）を使うと、要約行の連続年数とこのリストの増配/減配表示が
 * 食い違いうる（`docs/03_tasks/T-098` 実装計画 §1）。この理由により、②のリストには
 * 予想年度（`kind: 'forecast' | 'revised'`）は出現しない（実績限定）。
 *
 * 最大 `CONSECUTIVE_LOOKBACK_YEARS + 1`（19）年分を、年度昇順（古い年→新しい年）で返す。
 * 先頭行（ウィンドウ内で最も古い年）は前年が無いため常に `state: null` / `diffSen: null`。
 * 判定式は `calculateConsecutiveYears` の分岐と同一（`current < previous` が減配）。
 */
export function describeConsecutiveYearRows(
  dividends: readonly DividendRecord[],
): readonly ConsecutiveYearRow[] {
  const descending = actualDividendSeriesWithYear(dividends, CONSECUTIVE_LOOKBACK_YEARS + 1);
  const ascending = [...descending].reverse();

  const rows: ConsecutiveYearRow[] = [];
  let previousAmountSen: number | null = null;
  for (const [index, year] of ascending.entries()) {
    if (index === 0) {
      rows.push({ fiscalYear: year.fiscalYear, amountSen: year.amountSen, diffSen: null, state: null });
      previousAmountSen = year.amountSen;
      continue;
    }

    const current = year.amountSen;
    // 当年・前年のどちらかが欠損なら判定不能。0 に丸めると「減配した」と誤判定する
    if (current === null || previousAmountSen === null) {
      rows.push({ fiscalYear: year.fiscalYear, amountSen: current, diffSen: null, state: null });
      previousAmountSen = current;
      continue;
    }

    const diffSen = current - previousAmountSen;
    const state: ConsecutiveYearState = diffSen > 0 ? 'increase' : diffSen === 0 ? 'flat' : 'decrease';
    rows.push({ fiscalYear: year.fiscalYear, amountSen: current, diffSen, state });
    previousAmountSen = current;
  }
  return rows;
}
