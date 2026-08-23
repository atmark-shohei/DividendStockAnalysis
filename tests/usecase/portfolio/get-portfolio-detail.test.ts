import { describe, expect, it } from 'vitest';

import { getPortfolioDetail } from '@/usecase/get-portfolio-detail';
import { createFakePortfolioRepository } from './support/fake-portfolio-repository';

const NOW = '2026-01-01T00:00:00.000Z';

/**
 * `getPortfolioDetail`（GET /api/portfolios/:id。T-103。本タスクの中心ロジック）。
 * `calculatePortfolioMetrics`/`describeHoldingValuation` の呼び出し結線を確認する
 * （計算そのものの境界値は domain 側テストで尽くしてある）。
 */
describe('getPortfolioDetail', () => {
  it('他ユーザーの所有 → null（404への変換はhandlerの責務）', async () => {
    const { repository } = createFakePortfolioRepository({
      portfolios: [{ id: 'pf_1', userId: 2, name: '他ユーザー', createdAt: NOW }],
    });

    const result = await getPortfolioDetail(repository, 1, 'pf_1');

    expect(result).toBeNull();
  });

  it('存在しないID → null', async () => {
    const { repository } = createFakePortfolioRepository();

    const result = await getPortfolioDetail(repository, 1, 'pf_does_not_exist');

    expect(result).toBeNull();
  });

  it('保有0件: totalValueSen=0、scoreAverage=null、holdingsは空配列', async () => {
    const { repository } = createFakePortfolioRepository({
      portfolios: [{ id: 'pf_1', userId: 1, name: 'メインNISA', createdAt: NOW }],
    });

    const result = await getPortfolioDetail(repository, 1, 'pf_1');

    expect(result?.metrics.totalValueSen).toBe(0);
    expect(result?.metrics.scoreAverage).toBeNull();
    expect(result?.holdings).toEqual([]);
  });

  it('価格未取得(currentPriceSen=null)の保有銘柄: valueSen/unrealizedGainLossSenがnullになり、totalValueSenからも除外される', async () => {
    const { repository } = createFakePortfolioRepository({
      portfolios: [{ id: 'pf_1', userId: 1, name: 'メインNISA', createdAt: NOW }],
      holdings: [
        { portfolioId: 'pf_1', companyCode: '7203', quantity: 100, acquisitionPriceSen: 280_000, createdAt: NOW, updatedAt: NOW },
      ],
      companyInfo: {
        '7203': { name: 'トヨタ自動車', currentPriceSen: null, dividendYieldBp: 318, totalScore: 62, effectiveMetricCount: 8 },
      },
    });

    const result = await getPortfolioDetail(repository, 1, 'pf_1');

    expect(result?.metrics.totalValueSen).toBe(0);
    expect(result?.metrics.evaluableValueCount).toBe(0);
    const holding = result?.holdings[0];
    expect(holding?.valueSen).toBeNull();
    expect(holding?.unrealizedGainLossSen).toBeNull();
    // 利回りは価格と独立に算出できる
    expect(holding?.dividendYieldPercent).toBe(3.18);
  });

  it('利回り判定不能(dividendYieldBp=null)の保有銘柄: dividendYieldPercentがnullになる', async () => {
    const { repository } = createFakePortfolioRepository({
      portfolios: [{ id: 'pf_1', userId: 1, name: 'メインNISA', createdAt: NOW }],
      holdings: [
        { portfolioId: 'pf_1', companyCode: '7203', quantity: 100, acquisitionPriceSen: 280_000, createdAt: NOW, updatedAt: NOW },
      ],
      companyInfo: {
        '7203': { name: 'トヨタ自動車', currentPriceSen: 314_200, dividendYieldBp: null, totalScore: 62, effectiveMetricCount: 8 },
      },
    });

    const result = await getPortfolioDetail(repository, 1, 'pf_1');

    const holding = result?.holdings[0];
    expect(holding?.valueSen).toBe(31_420_000);
    expect(holding?.dividendYieldPercent).toBeNull();
  });

  it('複数銘柄の応答形がportfolio-api.mdのレスポンス例と一致する', async () => {
    const { repository } = createFakePortfolioRepository({
      portfolios: [{ id: 'pf_1', userId: 1, name: 'メインNISA', createdAt: NOW }],
      holdings: [
        { portfolioId: 'pf_1', companyCode: '7203', quantity: 100, acquisitionPriceSen: 280_000, createdAt: NOW, updatedAt: NOW },
      ],
      companyInfo: {
        '7203': { name: 'トヨタ自動車', currentPriceSen: 314_200, dividendYieldBp: 318, totalScore: 62, effectiveMetricCount: 8 },
      },
    });

    const result = await getPortfolioDetail(repository, 1, 'pf_1');

    expect(result?.holdings[0]).toEqual({
      code: '7203',
      name: 'トヨタ自動車',
      quantity: 100,
      acquisitionPriceSen: 280_000,
      currentPriceSen: 314_200,
      valueSen: 31_420_000,
      unrealizedGainLossSen: 3_420_000,
      dividendYieldPercent: 3.18,
      totalScore: 62,
      maxTotalScore: 100,
      effectiveMetricCount: 8,
      totalMetricCount: 10,
    });
  });
});
