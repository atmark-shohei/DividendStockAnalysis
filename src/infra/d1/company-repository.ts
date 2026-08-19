/**
 * `CompanyRepository` の D1 実装。
 *
 * ここだけが Drizzle と `D1Database` を知る。ドメインへは
 * ドメインの型（`Company`）に詰め替えて返す（`.claude/CLAUDE.md`）。
 */

import { type DrizzleD1Database, drizzle } from 'drizzle-orm/d1';
import { type BatchItem } from 'drizzle-orm/batch';
import { type AnyColumn, and, asc, desc, eq, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';

import { type Company, type PbrSource, type PerSource } from '../../domain/company/company';
import { type CompanyListQuery } from '../../domain/company/company-list-query';
import {
  type CompanyListResult,
  type CompanyRepository,
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

/**
 * D1 が **1文** に許すバインド変数（`?`）の上限。
 *
 * 超えると `D1_ERROR: too many SQL variables: SQLITE_ERROR` になる。
 * 実測（2026-08-05, dev サーバーへ合成データを POST）:
 * - `dividend_records`（4列）: 25件 = 100 param → 201 / **26件 = 104 param → 500**
 * - `financial_records`（7列）: 14件 = 98 param → 201 / **15件 = 105 param → 500**
 *
 * batch 全体ではなく1文あたりの制限なので、行を分割して複数文にすれば回避できる。
 */
export const D1_MAX_BOUND_PARAMETERS = 100;

/**
 * 1文にまとめてよい行数を列数から導く。
 *
 * `25` のようなマジックナンバーを書かない。列が増えたときに黙って上限を超えて
 * 落ちるのを防ぐため、必ずここで割り算して求める。
 */
export function maxRowsPerInsert(columnCount: number): number {
  // 1行だけで上限を超える列数でも 0 を返さない（0 だと永遠に挿入できない）
  return Math.max(1, Math.floor(D1_MAX_BOUND_PARAMETERS / columnCount));
}

/**
 * 一括 INSERT の行を、1文あたりのバインド変数が D1 の上限を超えないように分割する。
 *
 * Drizzle は `values()` の各プロパティを1個のバインド変数にするので、
 * 1行あたりの変数の個数はプロパティ数と一致する。
 * 分割しても `db.batch()` は1トランザクションなので原子性は保たれる。
 */
function chunkRowsForInsert<T extends Record<string, unknown>>(rows: readonly T[]): T[][] {
  const first = rows[0];
  if (first === undefined) return [];

  const rowsPerStatement = maxRowsPerInsert(Object.keys(first).length);
  const chunks: T[][] = [];
  for (let index = 0; index < rows.length; index += rowsPerStatement) {
    chunks.push(rows.slice(index, index + rowsPerStatement));
  }
  return chunks;
}

const DIVIDEND_KINDS: readonly DividendRecordKind[] = ['forecast', 'revised', 'actual'];

/** DB の文字列を配当区分に戻す。未知の値は取り込みの不具合なので `null` を返して捨てる */
function toDividendKind(raw: string): DividendRecordKind | null {
  return DIVIDEND_KINDS.includes(raw as DividendRecordKind) ? (raw as DividendRecordKind) : null;
}

/** `listFiscalYearEndMonths` の暫定実装が返す定数（1〜12月すべて） */
const ALL_MONTHS: readonly number[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

/**
 * `listSummaries()` 用。`transformed_metrics` は `(companyCode, metricKey)` 複合PKで
 * 1社最大2行（`dividendYield`/`payoutRatio`）を持つ。単純な LEFT JOIN だと1社が2行に
 * 増えてページングの行数がずれるため、`metric_key` 条件付きの別名 LEFT JOIN を2本張り、
 * 1社1行に保つ（BE計画 §5.1）。
 */
const dividendYieldMetrics = alias(transformedMetrics, 'dividend_yield_metrics');
const payoutRatioMetrics = alias(transformedMetrics, 'payout_ratio_metrics');

/**
 * SQLite `LIKE` のワイルドカード文字（`%`/`_`）とエスケープ文字自身（`\`）をエスケープする。
 *
 * 未エスケープのまま `%${q}%` に埋め込むと、`q='_'` や `q='100%'` のように `LIKE` の
 * 特殊文字を検索語に含めた場合、意図しない部分一致が起こる（BE レビュー CR-1）。
 * `\` を最初にエスケープしないと `%`/`_` の直前に付けたエスケープ文字自身が
 * 二重解釈されるので、置換順序を守ること。
 */
export function escapeLikeValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

/**
 * `column LIKE '%<escaped q>%' ESCAPE '\'` を組み立てる。
 *
 * `like()`（drizzle-orm）は `ESCAPE` 句を指定できないため使わない（CR-1）。
 */
function likeQuery(column: AnyColumn, value: string) {
  return sql`${column} LIKE ${`%${escapeLikeValue(value)}%`} ESCAPE '\\'`;
}

/**
 * `listSummaries()` の `sort` → `orderBy` の対応。`sort=created_desc`（既定）は `fetchedAt` 降順。
 *
 * 主キー（`score_cards.total_score`/`companies.fetched_at`）は同値が大量に発生しうるため、
 * `companies.code` 昇順を第2ソートキーとして必ず付与し、`LIMIT/OFFSET` によるページングで
 * 同じ行が複数ページに重複・欠落しないようにする（BE レビュー CR-2）。
 */
function orderByForSort(sort: CompanyListQuery['sort']) {
  switch (sort) {
    case 'created_desc':
      return [desc(companies.fetchedAt), asc(companies.code)];
    case 'score_desc':
      return [desc(scoreCards.totalScore), asc(companies.code)];
    case 'score_asc':
      return [asc(scoreCards.totalScore), asc(companies.code)];
    case 'code_asc':
      return [asc(companies.code)];
  }
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
          epsHistoryRestated: company.epsHistoryRestated ? 1 : 0,
          revenueHistoryRestated: company.revenueHistoryRestated ? 1 : 0,
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
            epsHistoryRestated: company.epsHistoryRestated ? 1 : 0,
            revenueHistoryRestated: company.revenueHistoryRestated ? 1 : 0,
            fetchedAt: company.fetchedAt,
            updatedAt: now,
          },
        }),
      this.db.delete(financialRecords).where(eq(financialRecords.companyCode, company.code)),
      this.db.delete(dividendRecords).where(eq(dividendRecords.companyCode, company.code)),
      this.db.delete(transformedMetrics).where(eq(transformedMetrics.companyCode, company.code)),
    ];

    // 明細は行数が増えると1文のバインド変数が D1 の上限を超える。
    // 列数から求めた行数で分割して複数文にする（`D1_MAX_BOUND_PARAMETERS`）
    const financialRows = company.records.map((record) => ({
      companyCode: company.code,
      fiscalYear: record.fiscalYear,
      isForecast: record.isForecast ? 1 : 0,
      epsSen: record.epsSen,
      roePercent: record.roePercent,
      revenueSen: record.revenueSen,
      operatingMarginPercent: record.operatingMarginPercent,
    }));
    for (const rows of chunkRowsForInsert(financialRows)) {
      statements.push(this.db.insert(financialRecords).values(rows));
    }

    const dividendRows = company.dividends.map((record) => ({
      companyCode: company.code,
      fiscalYear: record.fiscalYear,
      kind: record.kind,
      annualAmountSen: record.annualAmountSen,
    }));
    for (const rows of chunkRowsForInsert(dividendRows)) {
      statements.push(this.db.insert(dividendRecords).values(rows));
    }

    const metricRows = scoring.metrics.map((metric) => ({
      companyCode: company.code,
      metricKey: metric.metricKey,
      score: metric.score,
      value: metric.value,
      unavailableReason: metric.unavailableReason,
    }));
    for (const rows of chunkRowsForInsert(metricRows)) {
      statements.push(this.db.insert(transformedMetrics).values(rows));
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
      epsHistoryRestated: row.epsHistoryRestated === 1,
      revenueHistoryRestated: row.revenueHistoryRestated === 1,
    };
  }

  /**
   * 一覧は「JOIN一覧クエリ + 別COUNTクエリ」の計2クエリ（BE計画 §5.1）。
   * `companies` × `score_cards` × `transformed_metrics`（⑩⑬用の2本を別名JOIN）を
   * 1クエリの JOIN で取得し、行数に比例したクエリは発行しない（N+1 を作らない）。
   *
   * `q`（銘柄コード・銘柄名の部分一致）は SQLite 既定の `LIKE`（ASCII大文字小文字非区別）に
   * 委ねる（Manager確認済み。`LOWER()` の明示は不要。BE計画 §6-3）。
   * ワイルドカード文字（`%`/`_`）はエスケープしてから渡す（`escapeLikeValue`。CR-1）。
   */
  async listSummaries(query: CompanyListQuery): Promise<CompanyListResult> {
    const whereClause =
      query.q === ''
        ? undefined
        : or(likeQuery(companies.code, query.q), likeQuery(companies.name, query.q));

    const rowsQuery = this.db
      .select({
        code: companies.code,
        name: companies.name,
        fetchedAt: companies.fetchedAt,
        priceSen: companies.priceSen,
        totalScore: scoreCards.totalScore,
        effectiveMetricCount: scoreCards.effectiveMetricCount,
        dividendYieldValue: dividendYieldMetrics.value,
        payoutRatioValue: payoutRatioMetrics.value,
      })
      .from(companies)
      .leftJoin(scoreCards, eq(scoreCards.companyCode, companies.code))
      .leftJoin(
        dividendYieldMetrics,
        and(
          eq(dividendYieldMetrics.companyCode, companies.code),
          eq(dividendYieldMetrics.metricKey, 'dividendYield'),
        ),
      )
      .leftJoin(
        payoutRatioMetrics,
        and(
          eq(payoutRatioMetrics.companyCode, companies.code),
          eq(payoutRatioMetrics.metricKey, 'payoutRatio'),
        ),
      );

    const rows = await (whereClause === undefined ? rowsQuery : rowsQuery.where(whereClause))
      .orderBy(...orderByForSort(query.sort))
      .limit(query.perPage)
      .offset((query.page - 1) * query.perPage);

    const countQuery = this.db.select({ count: sql<number>`count(*)` }).from(companies);
    const countRows = await (whereClause === undefined
      ? countQuery
      : countQuery.where(whereClause));
    const total = countRows[0]?.count ?? 0;

    return {
      items: rows.map((row) => ({
        code: row.code,
        name: row.name,
        // `score_cards` に対応行が無い（LEFT JOIN が null）場合の防御。
        // `save()` が companies と score_cards を常にアトミックに書き込むため
        // （schema.ts の score_cards.company_code は companies.code への FK かつ PK）、
        // 通常運用では到達しない分岐（CR-7）。将来 score_cards だけを個別に削除する経路が
        // できた場合に備えた型合わせであり、実データでの再現テストは無い。
        totalScore: row.totalScore ?? 0,
        maxTotalScore: MAX_TOTAL_SCORE,
        effectiveMetricCount: row.effectiveMetricCount ?? 0,
        totalMetricCount: TOTAL_METRIC_COUNT,
        fetchedAt: row.fetchedAt,
        priceSen: row.priceSen,
        dividendYieldValue: row.dividendYieldValue,
        payoutRatioValue: row.payoutRatioValue,
      })),
      total,
    };
  }

  /**
   * TODO(be-developer, 2026-08-08): 推測実装。決算月を保存する列が無いため、常に
   * 1〜12月すべてを返す（`CompanyRepository.listFiscalYearEndMonths` のコメント参照）。
   */
  async listFiscalYearEndMonths(): Promise<readonly number[]> {
    return ALL_MONTHS;
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
