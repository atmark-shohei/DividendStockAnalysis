/**
 * ユースケース: ポートフォリオ詳細（集計値つき）。`GET /api/portfolios/:id`（`portfolio-api.md`）。
 *
 * 保有銘柄の `code` 群から `currentPriceSen`/`dividendYieldBp`/`totalScore` を集めた
 * `Holding[]` を組み立て、`calculatePortfolioMetrics()`（集計）・`describeHoldingValuation()`
 * （保有銘柄1件ぶんの評価額・評価損益・利回り%）を呼ぶ。**本タスクの中心ロジック**。
 *
 * `score_cards`/`transformed_metrics` は常にデフォルト設定（全10指標・`bands.ts` 既定境界）で
 * 計算される方針が確定済み（`schema.md` §未実装・検討事項「解消（2026-08-22）」）。
 * ユーザーごとの指標カスタマイズ設定を考慮する必要はない。
 */

import {
  MAX_TOTAL_SCORE,
  TOTAL_METRIC_COUNT,
} from '../domain/scoring/scoring-service';
import {
  type Holding,
  type PortfolioMetrics,
  calculatePortfolioMetrics,
  describeHoldingValuation,
} from '../domain/portfolio/portfolio-metrics';
import {
  type PortfolioHoldingJoinRow,
  type PortfolioRepository,
} from '../domain/portfolio/portfolio-repository';

/** `GET /api/portfolios/:id` の `holdings[]` 1件ぶん（`portfolio-api.md` のレスポンス例と対応） */
export interface PortfolioHoldingDetail {
  readonly code: string;
  readonly name: string;
  readonly quantity: number;
  readonly acquisitionPriceSen: number;
  readonly currentPriceSen: number | null;
  readonly valueSen: number | null;
  readonly unrealizedGainLossSen: number | null;
  readonly dividendYieldPercent: number | null;
  readonly totalScore: number;
  readonly maxTotalScore: number;
  readonly effectiveMetricCount: number;
  readonly totalMetricCount: number;
}

export interface PortfolioDetailResult {
  readonly id: string;
  readonly name: string;
  readonly metrics: PortfolioMetrics;
  readonly holdings: readonly PortfolioHoldingDetail[];
}

/**
 * `PortfolioHoldingJoinRow`（DB由来）を応答形（`PortfolioHoldingDetail`）へ変換する。
 * `add-holding.ts`/`update-holding.ts` の応答組み立てでも再利用する（重複させない）。
 */
export function toHoldingDetail(row: PortfolioHoldingJoinRow): PortfolioHoldingDetail {
  const holding: Holding = {
    quantity: row.quantity,
    acquisitionPriceSen: row.acquisitionPriceSen,
    currentPriceSen: row.currentPriceSen,
    dividendYieldBp: row.dividendYieldBp,
    totalScore: row.totalScore,
  };
  const valuation = describeHoldingValuation(holding);
  return {
    code: row.companyCode,
    name: row.companyName,
    quantity: row.quantity,
    acquisitionPriceSen: row.acquisitionPriceSen,
    currentPriceSen: row.currentPriceSen,
    valueSen: valuation.valueSen,
    unrealizedGainLossSen: valuation.unrealizedGainLossSen,
    dividendYieldPercent: valuation.dividendYieldPercent,
    totalScore: row.totalScore,
    maxTotalScore: MAX_TOTAL_SCORE,
    effectiveMetricCount: row.effectiveMetricCount,
    totalMetricCount: TOTAL_METRIC_COUNT,
  };
}

/**
 * @returns 他ユーザーのポートフォリオ・存在しないIDは `null`（handlerが404に変換する）
 */
export async function getPortfolioDetail(
  repository: PortfolioRepository,
  userId: number,
  portfolioId: string,
): Promise<PortfolioDetailResult | null> {
  const detail = await repository.getDetail(portfolioId);
  if (detail === null || detail.portfolio.userId !== userId) return null;

  const metrics = calculatePortfolioMetrics(
    detail.holdings.map((row) => ({
      quantity: row.quantity,
      acquisitionPriceSen: row.acquisitionPriceSen,
      currentPriceSen: row.currentPriceSen,
      dividendYieldBp: row.dividendYieldBp,
      totalScore: row.totalScore,
    })),
  );
  const holdings = detail.holdings.map(toHoldingDetail);

  return { id: detail.portfolio.id, name: detail.portfolio.name, metrics, holdings };
}
