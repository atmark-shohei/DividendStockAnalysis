/**
 * ユースケース: ポートフォリオを削除する。`DELETE /api/portfolios/:id`（`portfolio-api.md`）。
 *
 * **冪等にしない。** 存在しない・他ユーザーのものは404（本体削除は保有銘柄を巻き込む
 * 重い操作であり、誤操作の兆候を隠さないため。`portfolio-api.md` §DELETE /api/portfolios/:id）。
 * 他ユーザーのIDと「そもそも存在しない」IDは同じ `kind`（`not-found`）で返し、
 * 存在の有無を漏らさない（§共通仕様）。
 */

import { type PortfolioRepository } from '../domain/portfolio/portfolio-repository';
import { type Result, err, ok } from '../domain/shared/result';

export type DeletePortfolioError = { readonly kind: 'not-found' };

export async function deletePortfolio(
  repository: PortfolioRepository,
  userId: number,
  portfolioId: string,
): Promise<Result<void, DeletePortfolioError>> {
  const portfolio = await repository.findById(portfolioId);
  if (portfolio === null || portfolio.userId !== userId) {
    return err({ kind: 'not-found' });
  }

  await repository.deleteById(portfolioId);
  return ok(undefined);
}
