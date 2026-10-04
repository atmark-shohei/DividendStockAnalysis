/**
 * ユースケース: 保有銘柄を1件追加する。`POST /api/portfolios/:id/holdings`（`portfolio-api.md`）。
 *
 * `code` の形式・`quantity`/`acquisitionPriceSen` の正の値は handler の zod 境界で検証済み。
 * ここでは、①ポートフォリオの所有権（404）②銘柄の存在（404）③重複追加（409）
 * ④保有銘柄数の上限（403）の順に見る。
 */

import { type CompanyRepository } from '../domain/company/company-repository';
import { isHoldingLimitReached } from '../domain/portfolio/portfolio';
import { type PortfolioHoldingRecord } from '../domain/portfolio/portfolio-holding';
import { type PortfolioRepository } from '../domain/portfolio/portfolio-repository';
import { type Result, err, ok } from '../domain/shared/result';
import { type PortfolioHoldingDetail, toHoldingDetail } from './get-portfolio-detail';

export type AddHoldingError =
  | { readonly kind: 'portfolio-not-found' }
  | { readonly kind: 'company-not-found' }
  | { readonly kind: 'duplicate-holding' }
  | { readonly kind: 'holding-limit-reached' }
  /**
   * 理論上到達しない防御的分岐（`insertHolding` 直後の `findHoldingRow` が見つからない）。
   * `save-indicator-settings.ts` の `invalid-bands` と同型パターン
   */
  | { readonly kind: 'insert-verification-failed' };

export interface AddHoldingDependencies {
  readonly portfolioRepository: PortfolioRepository;
  readonly companyRepository: CompanyRepository;
}

export interface AddHoldingInput {
  readonly code: string;
  readonly quantity: number;
  readonly acquisitionPriceSen: number;
}

export async function addHolding(
  deps: AddHoldingDependencies,
  userId: number,
  portfolioId: string,
  input: AddHoldingInput,
  now: () => Date,
): Promise<Result<PortfolioHoldingDetail, AddHoldingError>> {
  const portfolio = await deps.portfolioRepository.findById(portfolioId);
  if (portfolio === null || portfolio.userId !== userId) {
    return err({ kind: 'portfolio-not-found' });
  }

  const company = await deps.companyRepository.findByCode(input.code);
  if (company === null) return err({ kind: 'company-not-found' });

  const alreadyHeld = await deps.portfolioRepository.findHolding(portfolioId, input.code);
  if (alreadyHeld) return err({ kind: 'duplicate-holding' });

  const existingCount = await deps.portfolioRepository.countHoldings(portfolioId);
  if (isHoldingLimitReached(existingCount)) return err({ kind: 'holding-limit-reached' });

  const nowIso = now().toISOString();
  const holding: PortfolioHoldingRecord = {
    portfolioId,
    companyCode: input.code,
    quantity: input.quantity,
    acquisitionPriceSen: input.acquisitionPriceSen,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
  await deps.portfolioRepository.insertHolding(holding);

  const row = await deps.portfolioRepository.findHoldingRow(portfolioId, input.code);
  // 直前に insertHolding した行を直後に取得するだけなので、通常運用では到達しない防御的分岐
  if (row === null) return err({ kind: 'insert-verification-failed' });
  return ok(toHoldingDetail(row));
}
