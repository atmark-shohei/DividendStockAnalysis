/**
 * ユースケース: 保有銘柄を1件削除する。
 * `DELETE /api/portfolios/:id/holdings/:code`（`portfolio-api.md`）。
 *
 * **冪等。** 未保有の `code` を指定しても成功として扱う（ポートフォリオ本体の削除とは
 * 方針が異なる。`portfolio-api.md` §DELETE .../holdings/:code）。
 */

import { type PortfolioRepository } from '../domain/portfolio/portfolio-repository';
import { type Result, err, ok } from '../domain/shared/result';

export type RemoveHoldingError = { readonly kind: 'portfolio-not-found' };

export async function removeHolding(
  repository: PortfolioRepository,
  userId: number,
  portfolioId: string,
  code: string,
): Promise<Result<void, RemoveHoldingError>> {
  const portfolio = await repository.findById(portfolioId);
  if (portfolio === null || portfolio.userId !== userId) {
    return err({ kind: 'portfolio-not-found' });
  }

  await repository.deleteHolding(portfolioId, code);
  return ok(undefined);
}
