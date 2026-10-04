/**
 * `PortfolioRepository` のインメモリフェイク（usecase 層のテスト専用）。
 *
 * D1 に触らず、`Portfolio`/`PortfolioHoldingRecord` の配列で状態を持つ。
 * `companyInfo` で保有銘柄の JOIN 相当（現在株価・利回り・スコア）を差し込めるようにする。
 */

import { type Portfolio, type PortfolioSummary } from '@/domain/portfolio/portfolio';
import { type PortfolioHoldingRecord } from '@/domain/portfolio/portfolio-holding';
import {
  type HoldingPatch,
  type PortfolioDetail,
  type PortfolioHoldingJoinRow,
  type PortfolioRepository,
} from '@/domain/portfolio/portfolio-repository';
import { type Result, err, ok } from '@/domain/shared/result';

export interface FakeCompanyInfo {
  readonly name: string;
  readonly currentPriceSen: number | null;
  readonly dividendYieldBp: number | null;
  readonly totalScore: number;
  readonly effectiveMetricCount: number;
}

export interface FakePortfolioRepositoryState {
  portfolios: Portfolio[];
  holdings: PortfolioHoldingRecord[];
  companyInfo: Record<string, FakeCompanyInfo>;
}

const DEFAULT_COMPANY_INFO: FakeCompanyInfo = {
  name: '不明銘柄',
  currentPriceSen: null,
  dividendYieldBp: null,
  totalScore: 0,
  effectiveMetricCount: 0,
};

export function createFakePortfolioRepository(
  initial: Partial<FakePortfolioRepositoryState> = {},
): { repository: PortfolioRepository; state: FakePortfolioRepositoryState } {
  const state: FakePortfolioRepositoryState = {
    portfolios: initial.portfolios ? [...initial.portfolios] : [],
    holdings: initial.holdings ? [...initial.holdings] : [],
    companyInfo: initial.companyInfo ? { ...initial.companyInfo } : {},
  };

  function toJoinRow(holding: PortfolioHoldingRecord): PortfolioHoldingJoinRow {
    const info = state.companyInfo[holding.companyCode] ?? {
      ...DEFAULT_COMPANY_INFO,
      name: holding.companyCode,
    };
    return {
      companyCode: holding.companyCode,
      companyName: info.name,
      quantity: holding.quantity,
      acquisitionPriceSen: holding.acquisitionPriceSen,
      currentPriceSen: info.currentPriceSen,
      dividendYieldBp: info.dividendYieldBp,
      totalScore: info.totalScore,
      effectiveMetricCount: info.effectiveMetricCount,
    };
  }

  const repository: PortfolioRepository = {
    countByUserId(userId: number): Promise<number> {
      return Promise.resolve(state.portfolios.filter((p) => p.userId === userId).length);
    },
    listSummariesByUserId(userId: number): Promise<readonly PortfolioSummary[]> {
      return Promise.resolve(
        state.portfolios
          .filter((p) => p.userId === userId)
          .map((p) => ({
            id: p.id,
            name: p.name,
            holdingCount: state.holdings.filter((h) => h.portfolioId === p.id).length,
          })),
      );
    },
    insert(portfolio: Portfolio): Promise<Result<void, { readonly kind: 'id-conflict' }>> {
      if (state.portfolios.some((p) => p.id === portfolio.id)) {
        return Promise.resolve(err({ kind: 'id-conflict' }));
      }
      state.portfolios.push(portfolio);
      return Promise.resolve(ok(undefined));
    },
    findById(id: string): Promise<Portfolio | null> {
      return Promise.resolve(state.portfolios.find((p) => p.id === id) ?? null);
    },
    deleteById(id: string): Promise<void> {
      state.portfolios = state.portfolios.filter((p) => p.id !== id);
      state.holdings = state.holdings.filter((h) => h.portfolioId !== id);
      return Promise.resolve();
    },
    getDetail(id: string): Promise<PortfolioDetail | null> {
      const portfolio = state.portfolios.find((p) => p.id === id);
      if (portfolio === undefined) return Promise.resolve(null);
      const holdings = state.holdings.filter((h) => h.portfolioId === id).map(toJoinRow);
      return Promise.resolve({ portfolio, holdings });
    },
    countHoldings(portfolioId: string): Promise<number> {
      return Promise.resolve(state.holdings.filter((h) => h.portfolioId === portfolioId).length);
    },
    findHolding(portfolioId: string, companyCode: string): Promise<boolean> {
      return Promise.resolve(
        state.holdings.some((h) => h.portfolioId === portfolioId && h.companyCode === companyCode),
      );
    },
    findHoldingRow(portfolioId: string, companyCode: string): Promise<PortfolioHoldingJoinRow | null> {
      const holding = state.holdings.find(
        (h) => h.portfolioId === portfolioId && h.companyCode === companyCode,
      );
      return Promise.resolve(holding === undefined ? null : toJoinRow(holding));
    },
    insertHolding(holding: PortfolioHoldingRecord): Promise<void> {
      state.holdings.push(holding);
      return Promise.resolve();
    },
    updateHolding(portfolioId: string, companyCode: string, patch: HoldingPatch): Promise<void> {
      state.holdings = state.holdings.map((h) =>
        h.portfolioId === portfolioId && h.companyCode === companyCode
          ? {
              ...h,
              quantity: patch.quantity ?? h.quantity,
              acquisitionPriceSen: patch.acquisitionPriceSen ?? h.acquisitionPriceSen,
              updatedAt: patch.updatedAt,
            }
          : h,
      );
      return Promise.resolve();
    },
    deleteHolding(portfolioId: string, companyCode: string): Promise<void> {
      state.holdings = state.holdings.filter(
        (h) => !(h.portfolioId === portfolioId && h.companyCode === companyCode),
      );
      return Promise.resolve();
    },
    countHoldingsByCompanyCode(companyCode: string): Promise<number> {
      return Promise.resolve(state.holdings.filter((h) => h.companyCode === companyCode).length);
    },
  };

  return { repository, state };
}
