import { describe, expect, it } from 'vitest';

import { deletePortfolio } from '@/usecase/delete-portfolio';
import { createFakePortfolioRepository } from './support/fake-portfolio-repository';

/**
 * `deletePortfolio`（DELETE /api/portfolios/:id。T-103）。
 * **冪等にしない。** 存在しない・他ユーザーのものは同じ `not-found` を返す（存在の有無を漏らさない）。
 */
describe('deletePortfolio', () => {
  it('自分のポートフォリオは削除に成功する', async () => {
    const { repository, state } = createFakePortfolioRepository({
      portfolios: [{ id: 'pf_1', userId: 1, name: 'メインNISA', createdAt: '2026-01-01T00:00:00.000Z' }],
    });

    const result = await deletePortfolio(repository, 1, 'pf_1');

    expect(result.ok).toBe(true);
    expect(state.portfolios).toHaveLength(0);
  });

  it('保有銘柄も一緒に消える（カスケード）', async () => {
    const now = '2026-01-01T00:00:00.000Z';
    const { repository, state } = createFakePortfolioRepository({
      portfolios: [{ id: 'pf_1', userId: 1, name: 'メインNISA', createdAt: now }],
      holdings: [
        { portfolioId: 'pf_1', companyCode: '7203', quantity: 100, acquisitionPriceSen: 280_000, createdAt: now, updatedAt: now },
      ],
    });

    await deletePortfolio(repository, 1, 'pf_1');

    expect(state.holdings).toHaveLength(0);
  });

  it('他ユーザーのIDはnot-found（削除されない）', async () => {
    const { repository, state } = createFakePortfolioRepository({
      portfolios: [{ id: 'pf_1', userId: 2, name: '他ユーザー', createdAt: '2026-01-01T00:00:00.000Z' }],
    });

    const result = await deletePortfolio(repository, 1, 'pf_1');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('not-found');
    expect(state.portfolios).toHaveLength(1);
  });

  it('存在しないIDはnot-found', async () => {
    const { repository } = createFakePortfolioRepository();

    const result = await deletePortfolio(repository, 1, 'pf_does_not_exist');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('not-found');
  });
});
