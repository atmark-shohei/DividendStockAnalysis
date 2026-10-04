import { describe, expect, it } from 'vitest';

import { updateHolding } from '@/usecase/update-holding';
import { createFakePortfolioRepository } from './support/fake-portfolio-repository';

const NOW = () => new Date('2026-08-23T00:00:00.000Z');
const CREATED_AT = '2026-01-01T00:00:00.000Z';

/**
 * `updateHolding`（PATCH /api/portfolios/:id/holdings/:code。T-103）。
 * 部分更新（数量のみ／単価のみ／両方）と not-found 系（実装計画 §6-b。仕様未記載のため
 * 「他人のリソースは404」の一般原則を延長して404扱い）。
 */
describe('updateHolding', () => {
  function setup() {
    return createFakePortfolioRepository({
      portfolios: [{ id: 'pf_1', userId: 1, name: 'メインNISA', createdAt: CREATED_AT }],
      holdings: [
        {
          portfolioId: 'pf_1',
          companyCode: '7203',
          quantity: 100,
          acquisitionPriceSen: 280_000,
          createdAt: CREATED_AT,
          updatedAt: CREATED_AT,
        },
      ],
      companyInfo: {
        '7203': {
          name: 'トヨタ自動車',
          currentPriceSen: 314_200,
          dividendYieldBp: 318,
          totalScore: 62,
          effectiveMetricCount: 8,
        },
      },
    });
  }

  it('数量のみ更新: acquisitionPriceSenは変わらない', async () => {
    const { repository, state } = setup();

    const result = await updateHolding(repository, 1, 'pf_1', '7203', { quantity: 150 }, NOW);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.quantity).toBe(150);
      expect(result.value.acquisitionPriceSen).toBe(280_000);
    }
    expect(state.holdings[0]?.quantity).toBe(150);
    expect(state.holdings[0]?.acquisitionPriceSen).toBe(280_000);
    expect(state.holdings[0]?.updatedAt).toBe(NOW().toISOString());
  });

  it('単価のみ更新: quantityは変わらない', async () => {
    const { repository, state } = setup();

    const result = await updateHolding(
      repository,
      1,
      'pf_1',
      '7203',
      { acquisitionPriceSen: 275_000 },
      NOW,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.quantity).toBe(100);
      expect(result.value.acquisitionPriceSen).toBe(275_000);
    }
    expect(state.holdings[0]?.quantity).toBe(100);
    expect(state.holdings[0]?.acquisitionPriceSen).toBe(275_000);
  });

  it('両方更新', async () => {
    const { repository } = setup();

    const result = await updateHolding(
      repository,
      1,
      'pf_1',
      '7203',
      { quantity: 150, acquisitionPriceSen: 275_000 },
      NOW,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.quantity).toBe(150);
      expect(result.value.acquisitionPriceSen).toBe(275_000);
    }
  });

  it('portfolio-not-found: 他ユーザーのポートフォリオID', async () => {
    const { repository } = createFakePortfolioRepository({
      portfolios: [{ id: 'pf_1', userId: 2, name: '他ユーザー', createdAt: CREATED_AT }],
    });

    const result = await updateHolding(repository, 1, 'pf_1', '7203', { quantity: 150 }, NOW);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('portfolio-not-found');
  });

  it('holding-not-found: そのポートフォリオに保有されていない銘柄コード', async () => {
    const { repository } = setup();

    const result = await updateHolding(repository, 1, 'pf_1', '9999', { quantity: 150 }, NOW);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('holding-not-found');
  });
});
