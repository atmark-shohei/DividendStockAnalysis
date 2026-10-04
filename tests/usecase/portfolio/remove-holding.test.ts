import { describe, expect, it } from 'vitest';

import { removeHolding } from '@/usecase/remove-holding';
import { createFakePortfolioRepository } from './support/fake-portfolio-repository';

const CREATED_AT = '2026-01-01T00:00:00.000Z';

/**
 * `removeHolding`（DELETE /api/portfolios/:id/holdings/:code。T-103）。
 * **冪等。** 未保有の code を指定しても成功する（ポートフォリオ本体の削除とは方針が異なる）。
 */
describe('removeHolding', () => {
  it('保有中の銘柄を削除できる', async () => {
    const { repository, state } = createFakePortfolioRepository({
      portfolios: [{ id: 'pf_1', userId: 1, name: 'メインNISA', createdAt: CREATED_AT }],
      holdings: [
        { portfolioId: 'pf_1', companyCode: '7203', quantity: 100, acquisitionPriceSen: 280_000, createdAt: CREATED_AT, updatedAt: CREATED_AT },
      ],
    });

    const result = await removeHolding(repository, 1, 'pf_1', '7203');

    expect(result.ok).toBe(true);
    expect(state.holdings).toHaveLength(0);
  });

  it('未保有の銘柄コードを指定しても成功する（冪等）', async () => {
    const { repository } = createFakePortfolioRepository({
      portfolios: [{ id: 'pf_1', userId: 1, name: 'メインNISA', createdAt: CREATED_AT }],
    });

    const result = await removeHolding(repository, 1, 'pf_1', '9999');

    expect(result.ok).toBe(true);
  });

  it('他ユーザーのportfolioIdはnot-found', async () => {
    const { repository } = createFakePortfolioRepository({
      portfolios: [{ id: 'pf_1', userId: 2, name: '他ユーザー', createdAt: CREATED_AT }],
    });

    const result = await removeHolding(repository, 1, 'pf_1', '7203');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('portfolio-not-found');
  });

  it('存在しないportfolioIdはnot-found', async () => {
    const { repository } = createFakePortfolioRepository();

    const result = await removeHolding(repository, 1, 'pf_does_not_exist', '7203');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('portfolio-not-found');
  });
});
