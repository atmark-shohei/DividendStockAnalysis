/**
 * ポートフォリオ（集約ルート）。
 *
 * `User`/`Company` と同じ「interface（readonly フィールド）+ 純関数」パターン
 * （クラス化しない。既存実装済みパターンに合わせる）。
 *
 * 仕様: `docs/02_design/api/portfolio-api.md`、`docs/02_design/database/schema.md`
 * §portfolios/portfolio_holdings。
 */

export interface Portfolio {
  /** アプリ生成の不透明ID（例 `pf_xxxxxxxx`）。`PortfolioIdGenerator` が生成する */
  readonly id: string;
  /** 所有者の `User.id`。他ユーザーのポートフォリオは404（`portfolio-api.md` §共通仕様） */
  readonly userId: number;
  /** 1〜50文字。範囲検証は handler の zod（`portfolio-api.md`） */
  readonly name: string;
  /** UTC ISO 8601 */
  readonly createdAt: string;
}

/** `GET /api/portfolios` 一覧用の要約。保有銘柄の明細は含めない（N+1回避。read model） */
export interface PortfolioSummary {
  readonly id: string;
  readonly name: string;
  readonly holdingCount: number;
}

/**
 * 1ユーザーが持てるポートフォリオの上限（`portfolio-api.md` §共通仕様の403「ポートフォリオ数の
 * 上限（10）」）。DB には持たせない（`schema.md` §portfolios「保存前に COUNT(*) で数えてから
 * 拒否する」）。
 */
export const MAX_PORTFOLIOS_PER_USER = 10;

/**
 * 1ポートフォリオが持てる保有銘柄の上限（`portfolio-api.md` §共通仕様の403「保有銘柄数の
 * 上限（100）」）。
 */
export const MAX_HOLDINGS_PER_PORTFOLIO = 100;

/**
 * 上限判定。`evaluateSignupEligibility`（`signup-policy.ts`）と同型の
 * 「件数を渡して閾値判定する」純関数パターン。
 *
 * `count` は「追加しようとする前の既存件数」。`count >= 上限` で追加を拒否する
 * （9件目までは作成できる。10件目の作成試行で拒否＝10件で頭打ち）。
 */
export function isPortfolioLimitReached(count: number): boolean {
  return count >= MAX_PORTFOLIOS_PER_USER;
}

export function isHoldingLimitReached(count: number): boolean {
  return count >= MAX_HOLDINGS_PER_PORTFOLIO;
}
