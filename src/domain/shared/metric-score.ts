/**
 * 1指標ぶんの判定結果。
 *
 * **「点数」と「判定不能」が同時に立たないことを型で保証する。**
 * `unavailableReason` を判別子にした判別可能ユニオンなので、
 *
 * - `score: null` かつ `unavailableReason: null`（何も分からない結果）
 * - `score: 5` かつ `unavailableReason: 'input-missing'`（矛盾した結果）
 *
 * のどちらも**型エラーになる**。`scoring-requirements.md` §0.5 の
 * 「計算できなかった」と「計算した結果が最低区分」の区別は、本システムの中心要件であり、
 * レビューではなく型で守る（`todo-list.md` T-048）。
 */

import { type Score } from './score';

/**
 * 判定不能の理由。全指標で共有する。
 *
 * 指標ごとに別名を作ると、10指標で10通りの語彙ができて画面側が分岐しきれない。
 * ⑩ だけは設計書 §4 が理由ごとに別メッセージを要求しているため
 * 独自の理由コードを持つ（`DividendYieldUnavailableReason`）。
 */
export type UnavailableReason =
  /** 入力に `null` がある。無配（0）とは別物 */
  | 'input-missing'
  /** 年数が足りない（5年平均に4年分しかない等） */
  | 'insufficient-history'
  /** 基準値が 0 で割れない */
  | 'division-by-zero'
  /** 基準値が負で成長率を定義できない。0点ではない */
  | 'undefined-growth'
  /** NaN / Infinity / 安全整数の範囲外など、数値として壊れている */
  | 'input-invalid'
  /** 区分表のどこにも該当しなかった。表に穴がある兆候 */
  | 'value-out-of-band'
  /**
   * ④⑦専用。EDINET取り込みで重複4期の突き合わせが一致せず、系列の連続性が
   * 保証できない（`docs/02_design/logic/edinet-history-import.md` §4.3）。
   */
  | 'restated-history';

export type MetricScore<R extends string = UnavailableReason> =
  | {
      readonly score: Score;
      /** 判定に使った算出値。表示用。丸めるのは表示層の1箇所だけ */
      readonly value: number;
      readonly unavailableReason: null;
    }
  | {
      readonly score: null;
      readonly value: null;
      readonly unavailableReason: R;
    };

export function scored(score: Score, value: number): MetricScore<never> {
  return { score, value, unavailableReason: null };
}

export function unavailable<R extends string>(reason: R): MetricScore<R> {
  return { score: null, value: null, unavailableReason: reason };
}

/** 判定できたか。`score === null` の判定を各所に散らさないための述語 */
export function isScored<R extends string>(
  metric: MetricScore<R>,
): metric is Extract<MetricScore<R>, { unavailableReason: null }> {
  return metric.unavailableReason === null;
}
