/**
 * D1（SQLite）のスキーマ定義。Drizzle ORM。
 *
 * 方針（`.claude/rules/backend.md` / `docs/02_design/database/schema.md`）:
 * - **金額カラムは整数（銭）。** `REAL` を使わない。丸め誤差が投資判断の誤りになる
 * - 比率（%）・倍率（倍）は `real`。これらは金額ではないので実数でよい
 * - 日時は UTC の ISO 8601 文字列。表示層でのみ JST に変換する
 * - 自然キーに UNIQUE を張り、二重取り込みを DB 層で防ぐ
 * - 無配（0）とデータ欠損（NULL）を型で区別する
 */

import { sql } from 'drizzle-orm';
import { index, integer, primaryKey, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const companies = sqliteTable('companies', {
  /** 銘柄コード（例: 9433）。自然キーをそのまま主キーにする */
  code: text('code').primaryKey(),
  name: text('name').notNull(),
  /** ユーザーが手入力した現在株価（銭） */
  priceSen: integer('price_sen'),
  per: real('per'),
  /** 'forecast-eps' | 'actual-eps' | 'manual'。`per` が NULL なら NULL */
  perSource: text('per_source'),
  pbr: real('pbr'),
  /** 'actual-bps' | 'manual'。`pbr` が NULL なら NULL */
  pbrSource: text('pbr_source'),
  currentAssetsSen: integer('current_assets_sen'),
  investmentSecuritiesSen: integer('investment_securities_sen'),
  totalLiabilitiesSen: integer('total_liabilities_sen'),
  previousDividendTotalSen: integer('previous_dividend_total_sen'),
  /** 入力（解析）した日時。UTC。**古いデータを最新として表示しないため必須** */
  fetchedAt: text('fetched_at').notNull(),
  createdAt: text('created_at')
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at')
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const financialRecords = sqliteTable(
  'financial_records',
  {
    companyCode: text('company_code')
      .notNull()
      .references(() => companies.code, { onDelete: 'cascade' }),
    fiscalYear: integer('fiscal_year').notNull(),
    /** 予想なら 1。実績なら 0。平均・CAGR 系は実績だけを使う */
    isForecast: integer('is_forecast').notNull(),
    epsSen: integer('eps_sen'),
    roePercent: real('roe_percent'),
    revenueSen: integer('revenue_sen'),
    operatingMarginPercent: real('operating_margin_percent'),
  },
  (table) => [
    // 同じ会社・同じ年度・同じ区分は1行だけ。二重取り込みを DB で防ぐ
    primaryKey({ columns: [table.companyCode, table.fiscalYear, table.isForecast] }),
  ],
);

export const dividendRecords = sqliteTable(
  'dividend_records',
  {
    companyCode: text('company_code')
      .notNull()
      .references(() => companies.code, { onDelete: 'cascade' }),
    fiscalYear: integer('fiscal_year').notNull(),
    /** 'forecast' | 'revised' | 'actual' */
    kind: text('kind').notNull(),
    /** 年間配当の合計（銭）。**NULL は「データなし」で、0（無配）とは別物** */
    annualAmountSen: integer('annual_amount_sen'),
  },
  (table) => [primaryKey({ columns: [table.companyCode, table.fiscalYear, table.kind] })],
);

export const scoreCards = sqliteTable('score_cards', {
  companyCode: text('company_code')
    .primaryKey()
    .references(() => companies.code, { onDelete: 'cascade' }),
  /** 0〜100。判定不能は 0点として合算済み（§0.5） */
  totalScore: integer('total_score').notNull(),
  /** 判定できた指標の数。総合点の隣に併記する */
  effectiveMetricCount: integer('effective_metric_count').notNull(),
  /** 計算ロジックのバージョン。閾値や計算式を変えたら上げる */
  calcVersion: text('calc_version').notNull(),
  calculatedAt: text('calculated_at').notNull(),
});

export const transformedMetrics = sqliteTable(
  'transformed_metrics',
  {
    companyCode: text('company_code')
      .notNull()
      .references(() => companies.code, { onDelete: 'cascade' }),
    /** `MetricKey`（①〜⑩） */
    metricKey: text('metric_key').notNull(),
    /** 0〜10。**判定不能は NULL。0 に丸めない**（§0.5） */
    score: integer('score'),
    /** 判定に使った算出値。判定不能なら NULL */
    value: real('value'),
    /** 判定不能の理由。判定できたなら NULL */
    unavailableReason: text('unavailable_reason'),
  },
  (table) => [
    primaryKey({ columns: [table.companyCode, table.metricKey] }),
    index('idx_transformed_metrics_metric').on(table.metricKey),
  ],
);
