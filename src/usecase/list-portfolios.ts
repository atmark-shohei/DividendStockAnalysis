/**
 * ユースケース: ログイン中ユーザーのポートフォリオ一覧。
 *
 * `GET /api/portfolios`（`portfolio-api.md`）。**保有銘柄の明細は含めない**
 * （一覧は軽量に保つ。N+1 を避ける方針を踏襲。`listCompanies` と同型の薄い委譲）。
 */

import { MAX_PORTFOLIOS_PER_USER, type PortfolioSummary } from '../domain/portfolio/portfolio';
import { type PortfolioRepository } from '../domain/portfolio/portfolio-repository';

export interface ListPortfoliosResult {
  readonly portfolios: readonly PortfolioSummary[];
  readonly maxPortfolios: number;
}

export async function listPortfolios(
  repository: PortfolioRepository,
  userId: number,
): Promise<ListPortfoliosResult> {
  const portfolios = await repository.listSummariesByUserId(userId);
  return { portfolios, maxPortfolios: MAX_PORTFOLIOS_PER_USER };
}
