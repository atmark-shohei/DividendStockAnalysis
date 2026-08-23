/**
 * 保有銘柄1件（`portfolios` に紐づく明細）。
 *
 * 評価額・評価損益・現在株価・スコア等は**保存しない**（`schema.md` §portfolio_holdings）。
 * `companies`/`score_cards`/`transformed_metrics` から毎回算出する。この型は永続化されている
 * 生の入力（数量・取得単価）だけを持つ。
 */

/**
 * `quantity`（保有株数）の上限。BEレビュー CR-1 対応。
 *
 * `portfolio-metrics.ts` の `calculatePortfolioMetrics` は `quantity × currentPriceSen`
 * （評価額）・`quantity × acquisitionPriceSen`（取得原価）の積を追加の上限チェック無しで
 * 計算する前提になっている（同ファイルの「オーバーフローについて」コメント参照）。
 * `MAX_HOLDING_QUANTITY × MAX_PRICE_SEN`（`src/domain/company/dividend-record.ts`。
 * 100,000,000銭=1,000,000円）= `1,000,000 × 100,000,000 = 1×10^14` であり、
 * `Number.MAX_SAFE_INTEGER`（約9×10^15）の安全域に収まる。これにより、
 * ドメイン層のオーバーフロー非発生前提が「想定」から「入力境界による保証」に変わる。
 */
export const MAX_HOLDING_QUANTITY = 1_000_000;
export interface PortfolioHoldingRecord {
  readonly portfolioId: string;
  /** `companies.code`。`ON DELETE RESTRICT`（`schema.md` §portfolio_holdings） */
  readonly companyCode: string;
  /** 株（正の整数）。0以下の検証は handler の zod 境界で行う */
  readonly quantity: number;
  /** 銭/株（取得単価）。0以下の検証は handler の zod 境界で行う */
  readonly acquisitionPriceSen: number;
  /** UTC ISO 8601 */
  readonly createdAt: string;
  /** UTC ISO 8601 */
  readonly updatedAt: string;
}
