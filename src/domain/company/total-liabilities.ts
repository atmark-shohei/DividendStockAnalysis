/**
 * 総資産と純資産から負債総額を導出する（会計恒等式 資産 = 負債 + 純資産）。
 *
 * 仕様: `docs/02_design/logic/balance-sheet-derivation.md` §2.1 / §3
 *
 * IRバンクの財務ブロックには負債の列が無いが、総資産と純資産は全銘柄・全年度で
 * 取れる。指標⑥（配当維持可能年数）が要求する `totalLiabilitiesSen` を、
 * 手入力ではなくこの導出で埋めるためのもの。
 *
 * `deriveOperatingMarginPercent`（`operating-margin.ts`）と同じ「採点前の生の事実を
 * 導出する」処理で、DB にも HTTP にも触らない純粋関数である。
 *
 * ⚠️ **この関数だけ入力が円である。** プロジェクト規約（`CLAUDE.md`）の
 * 「金額は銭単位の整数」に対する意図的な例外で、理由は下の §3.2 の引用にある。
 * 引数名に `Yen` を付けて取り違えを防ぐ。出力の `valueSen` は銭。
 */

/**
 * 負債総額の導出結果。**`number | null` を返さない。**
 *
 * 呼び出し側（infra）は「正常な欠損」と「会計恒等式違反」を区別して
 * `ImportDiagnostic` を組み立てる必要があり、`null` だけでは判別できない
 * （設計書 §2.1）。診断には `block` / `fiscalYearKey` / `column` が要るが
 * 純粋関数はそれを知らないので、**理由だけを返して診断の組み立ては infra に委ねる**。
 * `MetricScore` の `unavailableReason`（ADR-0003）と同じ形。
 */
export type TotalLiabilitiesDerivation =
  /** 算出できた。`valueSen` は銭（整数）。**0 もここに入る**（無借金。§5.4） */
  | { readonly kind: 'derived'; readonly valueSen: number }
  /** 総資産・純資産のいずれかが `null`。正常な欠損（§5.1） */
  | { readonly kind: 'input-missing' }
  /** 円の生値が整数でなかった。データ不良（§5.1） */
  | { readonly kind: 'not-integer' }
  /** 総資産 < 純資産。会計恒等式に反する（§5.3） */
  | { readonly kind: 'negative-liabilities' }
  /** 円の生値、または差を銭にした値が安全整数を超える（§3.2） */
  | { readonly kind: 'unsafe-integer' };

/** 円 → 銭。`Sen` にしないのは、これが未検証の入力だから（`parse-fy-data.ts` と同じ理由） */
const SEN_PER_YEN = 100;

/**
 * 負債総額（銭）= 総資産 − 純資産。
 *
 * **減算は円で行い、その差だけを銭へ変換する**（設計書 §3.2）。総資産・純資産を
 * 個別に銭化してから引くと、7203（トヨタ）の総資産 105.5兆円が銭で 1.06e16 になり
 * `Number.MAX_SAFE_INTEGER`（9.007e15）を超えて桁あふれする。円で引けば
 * 差は 64.5兆円＝6.45e15 銭に収まり、**先に引くだけで1銘柄が救われる**。
 *
 * 円の生値は整数で、実測の最大は約 4.3e14（8306 の総資産）。2^53 未満の整数は
 * IEEE 754 の double が厳密に表現するので、円のままの減算に浮動小数点誤差は無い。
 *
 * 境界条件:
 * - 差 0（無借金）は `derived` の `valueSen: 0`。**`null` に丸めない**（§5.4）
 * - 純資産が負（債務超過）でも `derived`。総資産より大きい負債総額が正しく出る（§5.2）
 * - 差が負のときだけ `negative-liabilities`。どちらの入力が誤りか機械的に決められない
 *   ので値を採らない（§5.3）
 */
export function deriveTotalLiabilities(
  totalAssetsYen: number | null,
  netAssetsYen: number | null,
): TotalLiabilitiesDerivation {
  if (totalAssetsYen === null || netAssetsYen === null) return { kind: 'input-missing' };

  if (!Number.isInteger(totalAssetsYen) || !Number.isInteger(netAssetsYen)) {
    return { kind: 'not-integer' };
  }
  // 円の生値が「整数だが安全整数でない」場合は `unsafe-integer` に倒す。桁の話なので
  // `not-integer`（＝整数でない）の意味には合わない。実測の最大は 8306 の 4.3e14 で
  // 20倍以上の余裕があり、実データでは起きない防御。
  // 仕様: `docs/02_design/logic/balance-sheet-derivation.md` §5.1
  // （ユーザー承認済み 2026-08-06。設計書 §5.1 の表は「整数でない」と「差の銭化が
  //   安全整数を超える」しか書いていなかったため、この扱いを実装時に決めて承認を得た）
  if (!Number.isSafeInteger(totalAssetsYen) || !Number.isSafeInteger(netAssetsYen)) {
    return { kind: 'unsafe-integer' };
  }

  const liabilitiesYen = totalAssetsYen - netAssetsYen;
  // 負債は 0 以上。負になるのは会計上ありえないのでデータ不良として値を採らない（§5.3）
  if (liabilitiesYen < 0) return { kind: 'negative-liabilities' };

  const valueSen = liabilitiesYen * SEN_PER_YEN;
  // 8306（三菱UFJ）は円で引いても銭化で超える。銀行は本書の範囲では埋まらない（§3.2）
  if (!Number.isSafeInteger(valueSen)) return { kind: 'unsafe-integer' };

  return { kind: 'derived', valueSen };
}
