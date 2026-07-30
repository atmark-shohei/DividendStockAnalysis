/**
 * `CompanyRepository` の D1 実装。
 *
 * ここだけが Drizzle と `D1Database` を知る。ドメインへは
 * ドメインの型（`Company`）に詰め替えて返す（`.claude/CLAUDE.md`）。
 */

import { type DrizzleD1Database, drizzle } from 'drizzle-orm/d1';
import { type BatchItem } from 'drizzle-orm/batch';
import { eq } from 'drizzle-orm';

import { type Company, type PbrSource, type PerSource } from '../../domain/company/company';
import {
  type CompanyRepository,
  type CompanySummary,
  type StoredScoring,
} from '../../domain/company/company-repository';
import { type DividendRecordKind } from '../../domain/company/dividend-record';
import { MAX_TOTAL_SCORE, TOTAL_METRIC_COUNT } from '../../domain/scoring/scoring-service';
import {
  companies,
  dividendRecords,
  financialRecords,
  scoreCards,
  transformedMetrics,
} from './schema';

const DIVIDEND_KINDS: readonly DividendRecordKind[] = ['forecast', 'revised', 'actual'];

/** DB の文字列を配当区分に戻す。未知の値は取り込みの不具合なので `null` を返して捨てる */
function toDividendKind(raw: string): DividendRecordKind | null {
  return DIVIDEND_KINDS.includes(raw as DividendRecordKind) ? (raw as DividendRecordKind) : null;
}

const PER_SOURCES: readonly PerSource[] = ['forecast-eps', 'actual-eps', 'manual'];
const PBR_SOURCES: readonly PbrSource[] = ['actual-bps', 'manual'];

/** DB の文字列を PER の出所に戻す。未知の値・`null` は `null`（出所不明扱い） */
function toPerSource(raw: string | null): PerSource | null {
  return raw !== null && PER_SOURCES.includes(raw as PerSource) ? (raw as PerSource) : null;
}

function toPbrSource(raw: string | null): PbrSource | null {
  return raw !== null && PBR_SOURCES.includes(raw as PbrSource) ? (raw as PbrSource) : null;
}

export class D1CompanyRepository implements CompanyRepository {
  private readonly db: DrizzleD1Database;

  constructor(database: D1Database) {
    this.db = drizzle(database);
  }

  async save(company: Company, scoring: StoredScoring): Promise<void> {
    const now = new Date().toISOString();

    // 明細は「全消し→入れ直し」にする。年度が減ったときに古い行が残らない。
    // D1 の batch は1つのトランザクションとして実行されるので、途中で失敗しても
    // 中途半端な状態にならない
    const statements: BatchItem<'sqlite'>[] = [
      this.db
        .insert(companies)
        .values({
          code: company.code,
          name: company.name,
          priceSen: company.priceSen,
          per: company.multiples.per,
          perSource: company.multiples.perSource,
          pbr: company.multiples.pbr,
          pbrSource: company.multiples.pbrSource,
          currentAssetsSen: company.balanceSheet.currentAssetsSen,
          investmentSecuritiesSen: company.balanceSheet.investmentSecuritiesSen,
          totalLiabilitiesSen: company.balanceSheet.totalLiabilitiesSen,
          previousDividendTotalSen: company.balanceSheet.previousDividendTotalSen,
          fetchedAt: company.fetchedAt,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: companies.code,
          set: {
            name: company.name,
            priceSen: company.priceSen,
            per: company.multiples.per,
            perSource: company.multiples.perSource,
            pbr: company.multiples.pbr,
            pbrSource: company.multiples.pbrSource,
            currentAssetsSen: company.balanceSheet.currentAssetsSen,
            investmentSecuritiesSen: company.balanceSheet.investmentSecuritiesSen,
            totalLiabilitiesSen: company.balanceSheet.totalLiabilitiesSen,
            previousDividendTotalSen: company.balanceSheet.previousDividendTotalSen,
            fetchedAt: company.fetchedAt,
            updatedAt: now,
          },
        }),
      this.db.delete(financialRecords).where(eq(financialRecords.companyCode, company.code)),
      this.db.delete(dividendRecords).where(eq(dividendRecords.companyCode, company.code)),
      this.db.delete(transformedMetrics).where(eq(transformedMetrics.companyCode, company.code)),
    ];

    if (company.records.length > 0) {
      statements.push(
        this.db.insert(financialRecords).values(
          company.records.map((record) => ({
            companyCode: company.code,
            fiscalYear: record.fiscalYear,
            isForecast: record.isForecast ? 1 : 0,
            epsSen: record.epsSen,
            roePercent: record.roePercent,
            revenueSen: record.revenueSen,
            operatingMarginPercent: record.operatingMarginPercent,
          })),
        ),
      );
    }

    if (company.dividends.length > 0) {
      statements.push(
        this.db.insert(dividendRecords).values(
          company.dividends.map((record) => ({
            companyCode: company.code,
            fiscalYear: record.fiscalYear,
            kind: record.kind,
            annualAmountSen: record.annualAmountSen,
          })),
        ),
      );
    }

    if (scoring.metrics.length > 0) {
      statements.push(
        this.db.insert(transformedMetrics).values(
          scoring.metrics.map((metric) => ({
            companyCode: company.code,
            metricKey: metric.metricKey,
            score: metric.score,
            value: metric.value,
            unavailableReason: metric.unavailableReason,
          })),
        ),
      );
    }

    statements.push(
      this.db
        .insert(scoreCards)
        .values({
          companyCode: company.code,
          totalScore: scoring.totalScore,
          effectiveMetricCount: scoring.effectiveMetricCount,
          calcVersion: scoring.calcVersion,
          calculatedAt: scoring.calculatedAt,
        })
        .onConflictDoUpdate({
          target: scoreCards.companyCode,
          set: {
            totalScore: scoring.totalScore,
            effectiveMetricCount: scoring.effectiveMetricCount,
            calcVersion: scoring.calcVersion,
            calculatedAt: scoring.calculatedAt,
          },
        }),
    );

    const [first, ...rest] = statements;
    if (first === undefined) return;
    await this.db.batch([first, ...rest]);
  }

  async findByCode(code: string): Promise<Company | null> {
    const rows = await this.db.select().from(companies).where(eq(companies.code, code)).limit(1);
    const row = rows[0];
    if (row === undefined) return null;

    const [records, dividends] = await Promise.all([
      this.db.select().from(financialRecords).where(eq(financialRecords.companyCode, code)),
      this.db.select().from(dividendRecords).where(eq(dividendRecords.companyCode, code)),
    ]);

    return {
      code: row.code,
      name: row.name,
      // 年度降順に整えるのは取り込み層の責務。DB から出した時点でも保証する
      records: [...records]
        .sort((a, b) => b.fiscalYear - a.fiscalYear)
        .map((record) => ({
          fiscalYear: record.fiscalYear,
          isForecast: record.isForecast === 1,
          epsSen: record.epsSen,
          roePercent: record.roePercent,
          revenueSen: record.revenueSen,
          operatingMarginPercent: record.operatingMarginPercent,
        })),
      dividends: [...dividends]
        .sort((a, b) => b.fiscalYear - a.fiscalYear)
        .flatMap((record) => {
          const kind = toDividendKind(record.kind);
          if (kind === null) return [];
          return [
            {
              fiscalYear: record.fiscalYear,
              kind,
              annualAmountSen: record.annualAmountSen,
            },
          ];
        }),
      balanceSheet: {
        currentAssetsSen: row.currentAssetsSen,
        investmentSecuritiesSen: row.investmentSecuritiesSen,
        totalLiabilitiesSen: row.totalLiabilitiesSen,
        previousDividendTotalSen: row.previousDividendTotalSen,
      },
      multiples: {
        per: row.per,
        perSource: toPerSource(row.perSource),
        pbr: row.pbr,
        pbrSource: toPbrSource(row.pbrSource),
      },
      priceSen: row.priceSen,
      fetchedAt: row.fetchedAt,
    };
  }

  /** 一覧は1クエリ。N+1 を作らない（`.claude/rules/backend.md`） */
  async listSummaries(): Promise<readonly CompanySummary[]> {
    const rows = await this.db
      .select({
        code: companies.code,
        name: companies.name,
        fetchedAt: companies.fetchedAt,
        totalScore: scoreCards.totalScore,
        effectiveMetricCount: scoreCards.effectiveMetricCount,
      })
      .from(companies)
      .leftJoin(scoreCards, eq(scoreCards.companyCode, companies.code));

    return rows
      .map((row) => ({
        code: row.code,
        name: row.name,
        totalScore: row.totalScore ?? 0,
        maxTotalScore: MAX_TOTAL_SCORE,
        effectiveMetricCount: row.effectiveMetricCount ?? 0,
        totalMetricCount: TOTAL_METRIC_COUNT,
        fetchedAt: row.fetchedAt,
      }))
      .sort((a, b) => b.fetchedAt.localeCompare(a.fetchedAt));
  }

  async deleteByCode(code: string): Promise<void> {
    // 明細側の外部キーは ON DELETE CASCADE だが、D1 は既定で外部キー制約が
    // 有効とは限らないので、依存行を明示的に消す
    await this.db.batch([
      this.db.delete(transformedMetrics).where(eq(transformedMetrics.companyCode, code)),
      this.db.delete(scoreCards).where(eq(scoreCards.companyCode, code)),
      this.db.delete(dividendRecords).where(eq(dividendRecords.companyCode, code)),
      this.db.delete(financialRecords).where(eq(financialRecords.companyCode, code)),
      this.db.delete(companies).where(eq(companies.code, code)),
    ]);
  }
}
