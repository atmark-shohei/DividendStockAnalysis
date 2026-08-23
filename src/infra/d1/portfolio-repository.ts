/**
 * `PortfolioRepository` の D1 実装。ここだけが Drizzle と `D1Database` を知る
 * （`.claude/CLAUDE.md`）。
 *
 * ⚠️ **D1 は既定で外部キー制約が有効とは限らない**（`D1CompanyRepository.deleteByCode()` の
 * 既存コメント参照）。`portfolio_holdings.portfolio_id` の `ON DELETE CASCADE` を信頼せず、
 * `deleteById` は holdings→portfolios の順に明示的に削除する。同様に `company_code` の
 * `ON DELETE RESTRICT` も信頼せず、409判定は `countHoldingsByCompanyCode` を
 * 呼び出し側（`deleteCompany` usecase）が明示的に確認する設計にする。
 */

import { type DrizzleD1Database, drizzle } from 'drizzle-orm/d1';
import { and, asc, eq, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';

import { type Portfolio, type PortfolioSummary } from '../../domain/portfolio/portfolio';
import { type PortfolioHoldingRecord } from '../../domain/portfolio/portfolio-holding';
import {
  type HoldingPatch,
  type PortfolioDetail,
  type PortfolioHoldingJoinRow,
  type PortfolioRepository,
} from '../../domain/portfolio/portfolio-repository';
import { type Result, err, ok } from '../../domain/shared/result';
import { companies, portfolioHoldings, portfolios, scoreCards, transformedMetrics } from './schema';

/**
 * D1 の `UNIQUE` 制約違反かどうかを判別する。`user-repository.ts` の同名関数と同型
 * （`cause` チェーンを最大10段辿りメッセージの部分一致で判別。共有ユーティリティへの
 * 切り出しは本タスクのスコープ外。将来2箇所目の重複が出た時点で検討）。
 */
function isUniqueConstraintError(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 10 && current instanceof Error; depth += 1) {
    if (current.message.includes('UNIQUE constraint failed')) return true;
    current = current.cause;
  }
  return false;
}

/**
 * `getDetail`/`findHoldingRow` 用。⑩配当利回りの `value`（bp相当。`company-repository.ts` の
 * `dividendYieldMetrics` と同じ考え方だが、`transformed_metrics` は複合PKで1社最大2行
 * （`dividendYield`/`payoutRatio`）持つため、`metric_key` 条件付きの別名 LEFT JOIN が要る）。
 */
const dividendYieldMetrics = alias(transformedMetrics, 'portfolio_dividend_yield_metrics');

function toPortfolio(row: {
  id: string;
  userId: number;
  name: string;
  createdAt: string;
}): Portfolio {
  return { id: row.id, userId: row.userId, name: row.name, createdAt: row.createdAt };
}

function toJoinRow(row: {
  companyCode: string;
  companyName: string;
  quantity: number;
  acquisitionPriceSen: number;
  currentPriceSen: number | null;
  dividendYieldValue: number | null;
  totalScore: number | null;
  effectiveMetricCount: number | null;
}): PortfolioHoldingJoinRow {
  return {
    companyCode: row.companyCode,
    companyName: row.companyName,
    quantity: row.quantity,
    acquisitionPriceSen: row.acquisitionPriceSen,
    currentPriceSen: row.currentPriceSen,
    dividendYieldBp: row.dividendYieldValue,
    // `score_cards` に対応行が無い（LEFT JOIN が null）場合の防御。`companies` の save() と
    // `score_cards` がアトミックに書き込まれる限り通常運用では到達しない（CR-7と同型）
    totalScore: row.totalScore ?? 0,
    effectiveMetricCount: row.effectiveMetricCount ?? 0,
  };
}

export class D1PortfolioRepository implements PortfolioRepository {
  private readonly db: DrizzleD1Database;

  constructor(database: D1Database) {
    this.db = drizzle(database);
  }

  async countByUserId(userId: number): Promise<number> {
    const rows = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(portfolios)
      .where(eq(portfolios.userId, userId));
    return rows[0]?.count ?? 0;
  }

  /**
   * 1クエリ（`LEFT JOIN portfolio_holdings` + `GROUP BY` + `COUNT`）。N+1を作らない
   * （`.claude/rules/backend.md`）。並び順は作成日時昇順（作成順。実装計画 §6-f）。
   */
  async listSummariesByUserId(userId: number): Promise<readonly PortfolioSummary[]> {
    const rows = await this.db
      .select({
        id: portfolios.id,
        name: portfolios.name,
        // company_code で数える。LEFT JOIN でヒットしない行は NULL なので数えられない
        holdingCount: sql<number>`count(${portfolioHoldings.companyCode})`,
      })
      .from(portfolios)
      .leftJoin(portfolioHoldings, eq(portfolioHoldings.portfolioId, portfolios.id))
      .where(eq(portfolios.userId, userId))
      .groupBy(portfolios.id, portfolios.name, portfolios.createdAt)
      .orderBy(asc(portfolios.createdAt));

    return rows.map((row) => ({ id: row.id, name: row.name, holdingCount: row.holdingCount }));
  }

  async insert(
    portfolio: Portfolio,
  ): Promise<Result<void, { readonly kind: 'id-conflict' }>> {
    try {
      await this.db.insert(portfolios).values({
        id: portfolio.id,
        userId: portfolio.userId,
        name: portfolio.name,
        createdAt: portfolio.createdAt,
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        return err({ kind: 'id-conflict' });
      }
      throw error;
    }
    return ok(undefined);
  }

  async findById(id: string): Promise<Portfolio | null> {
    const rows = await this.db.select().from(portfolios).where(eq(portfolios.id, id)).limit(1);
    const row = rows[0];
    return row === undefined ? null : toPortfolio(row);
  }

  async deleteById(id: string): Promise<void> {
    // D1 は既定で外部キー制約が有効とは限らないので、依存行を明示的に消す
    // （`D1CompanyRepository.deleteByCode` と同じ理由）
    await this.db.batch([
      this.db.delete(portfolioHoldings).where(eq(portfolioHoldings.portfolioId, id)),
      this.db.delete(portfolios).where(eq(portfolios.id, id)),
    ]);
  }

  /**
   * portfolio行1件＋保有銘柄のJOIN行（計2クエリ）。保有銘柄ごとの個別クエリは発行しない
   * （N+1を作らない）。
   */
  async getDetail(id: string): Promise<PortfolioDetail | null> {
    const portfolioRows = await this.db
      .select()
      .from(portfolios)
      .where(eq(portfolios.id, id))
      .limit(1);
    const portfolioRow = portfolioRows[0];
    if (portfolioRow === undefined) return null;

    const holdingRows = await this.db
      .select({
        companyCode: portfolioHoldings.companyCode,
        companyName: companies.name,
        quantity: portfolioHoldings.quantity,
        acquisitionPriceSen: portfolioHoldings.acquisitionPriceSen,
        currentPriceSen: companies.priceSen,
        dividendYieldValue: dividendYieldMetrics.value,
        totalScore: scoreCards.totalScore,
        effectiveMetricCount: scoreCards.effectiveMetricCount,
      })
      .from(portfolioHoldings)
      .innerJoin(companies, eq(companies.code, portfolioHoldings.companyCode))
      .leftJoin(scoreCards, eq(scoreCards.companyCode, companies.code))
      .leftJoin(
        dividendYieldMetrics,
        and(
          eq(dividendYieldMetrics.companyCode, companies.code),
          eq(dividendYieldMetrics.metricKey, 'dividendYield'),
        ),
      )
      .where(eq(portfolioHoldings.portfolioId, id));

    return {
      portfolio: toPortfolio(portfolioRow),
      holdings: holdingRows.map(toJoinRow),
    };
  }

  async countHoldings(portfolioId: string): Promise<number> {
    const rows = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(portfolioHoldings)
      .where(eq(portfolioHoldings.portfolioId, portfolioId));
    return rows[0]?.count ?? 0;
  }

  async findHolding(portfolioId: string, companyCode: string): Promise<boolean> {
    const rows = await this.db
      .select({ companyCode: portfolioHoldings.companyCode })
      .from(portfolioHoldings)
      .where(
        and(
          eq(portfolioHoldings.portfolioId, portfolioId),
          eq(portfolioHoldings.companyCode, companyCode),
        ),
      )
      .limit(1);
    return rows.length > 0;
  }

  /** 対象1行だけのJOIN。追加・更新後の応答組み立てに使う（N+1には該当しない） */
  async findHoldingRow(
    portfolioId: string,
    companyCode: string,
  ): Promise<PortfolioHoldingJoinRow | null> {
    const rows = await this.db
      .select({
        companyCode: portfolioHoldings.companyCode,
        companyName: companies.name,
        quantity: portfolioHoldings.quantity,
        acquisitionPriceSen: portfolioHoldings.acquisitionPriceSen,
        currentPriceSen: companies.priceSen,
        dividendYieldValue: dividendYieldMetrics.value,
        totalScore: scoreCards.totalScore,
        effectiveMetricCount: scoreCards.effectiveMetricCount,
      })
      .from(portfolioHoldings)
      .innerJoin(companies, eq(companies.code, portfolioHoldings.companyCode))
      .leftJoin(scoreCards, eq(scoreCards.companyCode, companies.code))
      .leftJoin(
        dividendYieldMetrics,
        and(
          eq(dividendYieldMetrics.companyCode, companies.code),
          eq(dividendYieldMetrics.metricKey, 'dividendYield'),
        ),
      )
      .where(
        and(
          eq(portfolioHoldings.portfolioId, portfolioId),
          eq(portfolioHoldings.companyCode, companyCode),
        ),
      )
      .limit(1);

    const row = rows[0];
    return row === undefined ? null : toJoinRow(row);
  }

  async insertHolding(holding: PortfolioHoldingRecord): Promise<void> {
    await this.db.insert(portfolioHoldings).values({
      portfolioId: holding.portfolioId,
      companyCode: holding.companyCode,
      quantity: holding.quantity,
      acquisitionPriceSen: holding.acquisitionPriceSen,
      createdAt: holding.createdAt,
      updatedAt: holding.updatedAt,
    });
  }

  async updateHolding(
    portfolioId: string,
    companyCode: string,
    patch: HoldingPatch,
  ): Promise<void> {
    const set: { quantity?: number; acquisitionPriceSen?: number; updatedAt: string } = {
      updatedAt: patch.updatedAt,
    };
    if (patch.quantity !== undefined) set.quantity = patch.quantity;
    if (patch.acquisitionPriceSen !== undefined) set.acquisitionPriceSen = patch.acquisitionPriceSen;

    await this.db
      .update(portfolioHoldings)
      .set(set)
      .where(
        and(
          eq(portfolioHoldings.portfolioId, portfolioId),
          eq(portfolioHoldings.companyCode, companyCode),
        ),
      );
  }

  /** 冪等。対象が無くても成功する（`DELETE .../holdings/:code`） */
  async deleteHolding(portfolioId: string, companyCode: string): Promise<void> {
    await this.db
      .delete(portfolioHoldings)
      .where(
        and(
          eq(portfolioHoldings.portfolioId, portfolioId),
          eq(portfolioHoldings.companyCode, companyCode),
        ),
      );
  }

  async countHoldingsByCompanyCode(companyCode: string): Promise<number> {
    const rows = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(portfolioHoldings)
      .where(eq(portfolioHoldings.companyCode, companyCode));
    return rows[0]?.count ?? 0;
  }
}
