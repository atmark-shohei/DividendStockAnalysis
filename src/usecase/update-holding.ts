/**
 * ユースケース: 保有数量・取得単価を更新する。
 * `PATCH /api/portfolios/:id/holdings/:code`（`portfolio-api.md`）。
 *
 * `quantity`/`acquisitionPriceSen` の少なくとも1つが必須（0以下は400）は handler の zod
 * 境界（`.refine()`）で検証済み。両方または片方だけの更新を許す。
 *
 * TODO(be-developer, 2026-08-23): 推測実装。`portfolio-api.md` は対象の `code` がそのポート
 * フォリオに保有されていない場合のステータスを明記していない（表には0以下→400、成功→200しか
 * 無い）。「他人のリソースは404」の一般原則を延長し、`holding-not-found` を404として扱う
 * （実装計画 §6-a／§6-b・Manager承認済み）。
 */

import { type PortfolioRepository } from '../domain/portfolio/portfolio-repository';
import { type Result, err, ok } from '../domain/shared/result';
import { type PortfolioHoldingDetail, toHoldingDetail } from './get-portfolio-detail';

export type UpdateHoldingError =
  | { readonly kind: 'portfolio-not-found' }
  | { readonly kind: 'holding-not-found' };

export interface UpdateHoldingInput {
  readonly quantity?: number;
  readonly acquisitionPriceSen?: number;
}

export async function updateHolding(
  repository: PortfolioRepository,
  userId: number,
  portfolioId: string,
  code: string,
  patch: UpdateHoldingInput,
  now: () => Date,
): Promise<Result<PortfolioHoldingDetail, UpdateHoldingError>> {
  const portfolio = await repository.findById(portfolioId);
  if (portfolio === null || portfolio.userId !== userId) {
    return err({ kind: 'portfolio-not-found' });
  }

  const exists = await repository.findHolding(portfolioId, code);
  if (!exists) return err({ kind: 'holding-not-found' });

  await repository.updateHolding(portfolioId, code, {
    quantity: patch.quantity,
    acquisitionPriceSen: patch.acquisitionPriceSen,
    updatedAt: now().toISOString(),
  });

  const row = await repository.findHoldingRow(portfolioId, code);
  // 直前に確認・更新した行を直後に取得するだけなので、通常運用では到達しない防御的分岐
  if (row === null) return err({ kind: 'holding-not-found' });
  return ok(toHoldingDetail(row));
}
