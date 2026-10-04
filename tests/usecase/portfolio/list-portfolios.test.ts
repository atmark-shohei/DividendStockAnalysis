import { describe, expect, it } from 'vitest';

import { MAX_PORTFOLIOS_PER_USER } from '@/domain/portfolio/portfolio';
import { listPortfolios } from '@/usecase/list-portfolios';
import { createFakePortfolioRepository } from './support/fake-portfolio-repository';

/**
 * `listPortfolios`（GET /api/portfolios。T-103）。薄い委譲 + `maxPortfolios` 定数の付与。
 */
describe('listPortfolios', () => {
  it('ログイン中ユーザーのポートフォリオだけを返す（他ユーザーは含まない）', async () => {
    const { repository } = createFakePortfolioRepository({
      portfolios: [
        { id: 'pf_1', userId: 1, name: 'メインNISA', createdAt: '2026-01-01T00:00:00.000Z' },
        { id: 'pf_2', userId: 1, name: '特定口座', createdAt: '2026-01-02T00:00:00.000Z' },
        { id: 'pf_3', userId: 2, name: '他ユーザー', createdAt: '2026-01-03T00:00:00.000Z' },
      ],
    });

    const result = await listPortfolios(repository, 1);

    expect(result.portfolios.map((p) => p.id)).toEqual(['pf_1', 'pf_2']);
  });

  it('maxPortfolios定数を併記する', async () => {
    const { repository } = createFakePortfolioRepository();

    const result = await listPortfolios(repository, 1);

    expect(result.maxPortfolios).toBe(MAX_PORTFOLIOS_PER_USER);
  });

  it('保有0件のポートフォリオはholdingCount=0で返る', async () => {
    const { repository } = createFakePortfolioRepository({
      portfolios: [{ id: 'pf_1', userId: 1, name: 'メインNISA', createdAt: '2026-01-01T00:00:00.000Z' }],
    });

    const result = await listPortfolios(repository, 1);

    expect(result.portfolios[0]?.holdingCount).toBe(0);
  });

  it('保有銘柄がある場合はholdingCountに反映される', async () => {
    const now = '2026-01-01T00:00:00.000Z';
    const { repository } = createFakePortfolioRepository({
      portfolios: [{ id: 'pf_1', userId: 1, name: 'メインNISA', createdAt: now }],
      holdings: [
        { portfolioId: 'pf_1', companyCode: '7203', quantity: 100, acquisitionPriceSen: 280_000, createdAt: now, updatedAt: now },
        { portfolioId: 'pf_1', companyCode: '9433', quantity: 50, acquisitionPriceSen: 400_000, createdAt: now, updatedAt: now },
      ],
    });

    const result = await listPortfolios(repository, 1);

    expect(result.portfolios[0]?.holdingCount).toBe(2);
  });
});
