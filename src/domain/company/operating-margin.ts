/**
 * 営業利益と売上高から営業利益率を導出する。
 *
 * `FinancialRecord.operatingMarginPercent` は「CSV に列があればこちらを使う」
 * （`company.ts`）という定義で、列が無い取り込み経路（IRバンク JSON 等）では
 * 営業利益と売上高から算出することが前提になっている。この導出はスコア判定
 * （`domain/scoring/operating-margin.ts` の5年平均・区分判定）より手前の、
 * 「採点前の生の事実を導出する」処理であり、`deriveMarketMultiples`
 * （`market-multiples.ts`）と同じ役割を持つ。
 *
 * ⚠️ 以前は取り込み層（`src/infra/irbank/parse-fy-data.ts`）に置かれていたが、
 * 「計算・判定は必ず domain へ」（`.claude/CLAUDE.md`）に沿って移した
 * （`docs/02_design/logic/irbank-json-import.md` §8-9）。挙動は変えていない。
 */

/**
 * 営業利益率（%）= 営業利益 ÷ 売上高 × 100。
 *
 * 銭どうしの比なので単位は打ち消し合う。**売上高が 0 以下ならゼロ除算を避けて `null`。**
 */
export function deriveOperatingMarginPercent(
  operatingIncomeSen: number | null,
  revenueSen: number | null,
): number | null {
  if (operatingIncomeSen === null || revenueSen === null) return null;
  if (revenueSen <= 0) return null;
  const margin = (operatingIncomeSen / revenueSen) * 100;
  return Number.isFinite(margin) ? margin : null;
}
