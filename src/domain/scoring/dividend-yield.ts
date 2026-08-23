/**
 * 指標⑩ 配当利回りのスコアリング。
 *
 * 仕様: `docs/02_design/logic/dividend-yield-scoring.md`
 * スコア表の原典: `docs/01_requirements/scoring-requirements.md` の指標⑩
 *
 * この層は純粋関数のみ。DB にも HTTP にも触らない（`.claude/rules/backend.md`）。
 *
 * **この指標だけ入力が生の `number`。** 株価はユーザーの手入力で、配当は取り込んだ
 * ままの値であり、**検証すること自体がこの関数の責務**だからである。他の指標が
 * `Sen`（検証済みを表す branded type）を受けるのと対照的だが、意図的な非対称。
 */

import {
  type DividendSource,
  type SelectedDividend,
  MAX_PRICE_SEN,
} from '../company/dividend-record';
import { type MetricScore, unavailable as unavailableMetric } from '../shared/metric-score';
import { type Score, scoreFromValidatedBand } from '../shared/score';
import { isSen } from '../shared/sen';
import { DIVIDEND_YIELD_BANDS } from './bands';
import { type ScoreBand, lookupPoints } from './score-band';

export { DIVIDEND_YIELD_BANDS, MAX_PRICE_SEN };
export type { DividendSource, SelectedDividend };

/**
 * 判定できなかった理由。設計書 §4 の表の行と 1 対 1 で対応させる。
 * 「計算できなかった」と「計算した結果が最低点」を区別するために持つ。
 *
 * 共通の `UnavailableReason` を使わないのは、設計書 §4 が理由ごとに
 * **別々の画面メッセージ**を要求しているため。共通語彙に丸めると出し分けられない。
 *
 * `price-too-large` / `price-invalid` / `dividend-invalid` は原典に無い防御的な分類。
 * 外部データは常に壊れている前提で扱う規約（`.claude/rules/backend.md`）に基づく。
 *
 * 配当額が負は**理由コードを持たない**。判定不能ではなく 0点（無配と同じ扱い）。
 */
export type YieldUnavailableReason =
  | 'price-missing'
  | 'price-zero'
  | 'price-negative'
  | 'price-too-large'
  | 'price-invalid'
  | 'dividend-missing'
  | 'dividend-invalid';

export interface DividendYieldInput {
  /** 現在の株価（銭）。ユーザーの手入力。未入力なら `null` */
  readonly priceSen: number | null;
  /** 採用した年間配当。配当データが1件も無ければ `null` */
  readonly dividend: SelectedDividend | null;
}

/**
 * ⑩ の判定結果。
 *
 * **`unavailableReason` を判別子にした判別可能ユニオン。**
 * `score: null` かつ `unavailableReason: null`（何も分からない結果）も、
 * `score: 5` かつ `unavailableReason: 'price-zero'`（矛盾した結果）も型エラーになる。
 * `scoring-requirements.md` §0.5 の中心要件を、レビューではなく型で守る（T-048）。
 */
export type DividendYieldResult =
  | {
      readonly score: Score;
      /** 表示用の利回り。1/100 % 単位の整数（550 = 5.50%） */
      readonly yieldHundredthsPercent: number;
      readonly dividendSource: DividendSource;
      readonly unavailableReason: null;
    }
  | {
      readonly score: null;
      readonly yieldHundredthsPercent: null;
      readonly dividendSource: null;
      readonly unavailableReason: YieldUnavailableReason;
    };

/**
 * 判定式が扱える配当の上限。`配当 * 10000` が安全整数に収まる範囲。
 *
 * **オペランドが安全整数でも、積は安全整数とは限らない。**
 * `Number.isSafeInteger` を通った値でも積が範囲を超えると比較結果が静かに逆転する
 * （実測: 株価 9007199254740991 銭で 5.25% の判定が 9点 / 厳密には 8点）。
 * 「整数比較だから厳密」という前提を成立させるには、積のほうを縛る必要がある。
 *
 * 株価側は業務上限 `MAX_PRICE_SEN` が算術上の安全域よりはるかに小さいので、
 * 業務上限だけ見れば足りる（`閾値 * 株価` は最大でも 550 * 1e8 = 5.5e10）。
 * この関係が崩れていないことは `dividend-yield.test.ts` で検証する。
 */
export const MAX_DIVIDEND_SEN = Math.floor(Number.MAX_SAFE_INTEGER / 10_000);

/**
 * 配当利回りを算出し、スコア表で採点する。
 *
 * **判定は丸めていない値で行う**（§2.2）。丸めてから判定すると境界で結果が変わる:
 * 実際の利回り 5.4951% は、丸めると 5.50% で 10点、丸めなければ 9点。
 *
 * @param bands 判定に使う区分表。**デフォルト区分表使用時（省略時）は整数演算で
 *   厳密に比較できる。ユーザー定義の区分表（指標カスタマイズ、T-101）を渡した場合、
 *   `scaleBands()` は丸めないため閾値が非整数になりうる。その場合 `compareToThreshold` の
 *   減算はその時点で通常の浮動小数点比較になる**（`MAX_DIVIDEND_SEN` の
 *   コメントが前提としていた「整数比較だから厳密」という保証は、デフォルト区分表
 *   限定の話になる。動作自体は変わらない）
 */
export function calculateDividendYield(
  input: DividendYieldInput,
  bands: readonly ScoreBand[] = DIVIDEND_YIELD_BANDS,
): DividendYieldResult {
  const { priceSen, dividend } = input;

  const unavailable = (reason: YieldUnavailableReason): DividendYieldResult => ({
    score: null,
    yieldHundredthsPercent: null,
    dividendSource: null,
    unavailableReason: reason,
  });

  if (priceSen === null) return unavailable('price-missing');
  if (!isSen(priceSen)) return unavailable('price-invalid');
  // §4 は 0 と負で別のメッセージを出すよう定めているので、理由コードも分ける
  if (priceSen === 0) return unavailable('price-zero');
  if (priceSen < 0) return unavailable('price-negative');
  if (priceSen > MAX_PRICE_SEN) return unavailable('price-too-large');

  if (dividend === null) return unavailable('dividend-missing');
  if (!isSen(dividend.amountSen) || dividend.amountSen > MAX_DIVIDEND_SEN) {
    return unavailable('dividend-invalid');
  }

  // 配当が負になるのは制度上ありえない。データの都合で負が入ってきたときは
  // 無配（0円）と同じ扱いにする（2026-07-27 決定。§4 / §6 変更点5）。
  // 判定不能に倒さないのは、③⑤⑥⑨ の「負の値は 0点」と方針を揃えるため。
  const dividendSen = Math.max(0, dividend.amountSen);

  // 利回り(%) = 配当 / 株価 * 100。閾値は 1/100 % 単位なので
  //   配当 / 株価 * 100 * 100 >= 閾値  <=>  配当 * 10000 >= 閾値 * 株価
  // 両辺とも整数で、除算を経由しない。これが「判定は生値」の実装（§2.2）。
  // 上のガードで両辺とも安全整数に収まることが保証されている。
  const compareToThreshold = (thresholdHundredths: number): number =>
    dividendSen * 10_000 - thresholdHundredths * priceSen;

  const points = lookupPoints(bands, compareToThreshold);
  // 区分表は 0% 以上を隙間なく覆っており、ここまでのガードで判定値は必ず 0 以上。
  // 該当なしは区分表の破損を意味するので、最低点ではなく判定不能に倒す
  if (points === null) return unavailable('dividend-invalid');

  return {
    score: scoreFromValidatedBand(points),
    // 表示用の値だけは丸める。丸めるのはここ1箇所（`.claude/rules/frontend.md`）
    yieldHundredthsPercent: Math.round((dividendSen * 10_000) / priceSen),
    dividendSource: dividend.source,
    unavailableReason: null,
  };
}

/**
 * ⑩ の結果を全指標共通の形に変換する。総合点の集計で使う。
 *
 * ⑩ だけ独自の理由コードと `dividendSource` を持つため、集計側が ⑩ を
 * 特別扱いしなくて済むようここで吸収する。
 */
export function dividendYieldToMetricScore(
  result: DividendYieldResult,
): MetricScore<YieldUnavailableReason> {
  if (result.unavailableReason !== null) return unavailableMetric(result.unavailableReason);
  return {
    score: result.score,
    value: result.yieldHundredthsPercent,
    unavailableReason: null,
  };
}
