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
  /**
   * ④用。EDINET取り込みの重複4期突き合わせで遡及修正が検出されたか
   * （`docs/02_design/logic/edinet-history-import.md` §4.3）。0/1。既定 0（EDINET未実施）
   */
  epsHistoryRestated: integer('eps_history_restated').notNull().default(0),
  /** ⑦用。同上 */
  revenueHistoryRestated: integer('revenue_history_restated').notNull().default(0),
  /**
   * ⑥用。`currentAssetsSen` / `investmentSecuritiesSen` の出所（EDINET有報のdocID）。
   * IRバンク・手入力由来、または未取り込みなら NULL。
   *
   * TODO(be-developer, 2026-08-08): 現時点ではこの列へ書き込む経路がまだ無い
   * （`GET /api/edinet/:code` は取得のみで保存しない。§4.6）。保存・マージの実行契機は
   * 本仕様のスコープ外（§1.2）のため、列だけ先に用意しておく（マイグレーション不要な追加を避ける）。
   */
  bsSourceDocId: text('bs_source_doc_id'),
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
    /**
     * EDINET取り込みの出所（有報のdocID）。IRバンク由来・手入力なら NULL。
     *
     * TODO(be-developer, 2026-08-08): `bsSourceDocId` と同じ理由でまだ書き込み経路が無い。
     */
    sourceDocId: text('source_doc_id'),
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

/**
 * EDINET有価証券報告書のdocIDインデックス（`docs/02_design/logic/edinet-history-import.md` §4.4）。
 *
 * 主キーは `(company_code, fiscal_year)`。**`edinet_code` ではなく当アプリの銘柄コード。**
 * `documents.json` レスポンスの `secCode`（証券コード＋チェックディジット）から変換して
 * 保存するため、EDINETコードリスト（Shift_JIS ZIP）の取得・デコードが不要になる
 * （実装時の発見。設計書ドラフトの `edinetCode` 主キーからの変更）。
 *
 * **`company_code` 単独のインデックスは張らない。** 複合主キーの先頭列が `company_code`
 * なので、`findLatest`（`WHERE company_code = ? ORDER BY fiscal_year DESC LIMIT 1`）も
 * `findDocId`（`WHERE company_code = ? AND fiscal_year = ?`）も複合PKの前方一致で賄える。
 * 単独インデックスは書き込みコストを増やすだけで読み取りを速くしない
 * （設計書 §4.4。0004 のマイグレーションで DROP 済み）。
 */
export const edinetDocumentIndex = sqliteTable(
  'edinet_document_index',
  {
    companyCode: text('company_code').notNull(),
    fiscalYear: integer('fiscal_year').notNull(),
    docId: text('doc_id').notNull(),
    /** UTC の ISO 8601。`documents.json` の `submitDateTime`（JST）から変換する */
    submittedAt: text('submitted_at').notNull(),
  },
  (table) => [primaryKey({ columns: [table.companyCode, table.fiscalYear] })],
);

/**
 * 日次バッチ（`refresh-edinet-document-index`）の最終成功時刻を保持する追記専用テーブル。
 *
 * `edinet_document_index.submitted_at` は書類の提出日時であってバッチの実行日時ではない。
 * 「バッチが1回も成功していない」と「今日はたまたま対象書類が0件だった」を区別するため、
 * 専用テーブルに分ける（`EdinetDocumentIndexRepository.lastRefreshedAt()` が読む）。
 */
export const edinetRefreshLog = sqliteTable('edinet_refresh_log', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  refreshedAt: text('refreshed_at').notNull(),
  /** その回で取り込んだ件数。障害調査用 */
  entryCount: integer('entry_count').notNull(),
});

/**
 * EDINET有価証券報告書のパース結果キャッシュ（`docs/02_design/logic/edinet-history-import.md` §4.8）。
 *
 * 主キーは `doc_id`。**有報は提出済みの不変文書で `doc_id` は不変の識別子。**
 * 同じ `doc_id` のパース結果は永久に変わらないため、TTL・更新検知を持たない（§4.8.4）。
 *
 * `payload` を JSON 列にするのは規約の例外（`.claude/rules/backend.md`「金額カラムは整数」から
 * の逸脱）。理由は項目増加のたびのマイグレーションを避けるため、および `diagnostics` が
 * 可変長のため（§4.8.3）。代わりに `schema_version` で形の不一致を検出する。
 */
export const edinetDocumentSummary = sqliteTable('edinet_document_summary', {
  docId: text('doc_id').primaryKey(),
  /** `EdinetDocumentSummary` の形の版。不一致はキャッシュミス扱い（§4.8.3） */
  schemaVersion: integer('schema_version').notNull(),
  /** `EdinetDocumentSummary` を JSON 化したもの */
  payload: text('payload').notNull(),
  /** 保存時刻。UTC の ISO 8601。**有効期限には使わない**（§4.8.4） */
  cachedAt: text('cached_at').notNull(),
});

/**
 * ユーザー（T-091。`docs/02_design/database/schema.md` §テーブル定義（認証・ポートフォリオ））。
 *
 * `created_at` は `companies` と異なり **DB の `CURRENT_TIMESTAMP` 既定値を使わず、
 * アプリ側の `now()` 注入から明示的に埋める**（`sessions.expiresAt` の計算と同じ時計を
 * 使うことでテストから固定できるようにするため。T-091計画 §2.3）。
 */
export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  passwordSalt: text('password_salt').notNull(),
  passwordIterations: integer('password_iterations').notNull(),
  /** 'user' | 'admin'。`guest`（未ログイン）は行を持たない */
  role: text('role').notNull(),
  failedLoginCount: integer('failed_login_count').notNull().default(0),
  /** この時刻まではログイン試行を拒否する。UTC ISO 8601。NULL = ロックなし */
  lockedUntil: text('locked_until'),
  createdAt: text('created_at').notNull(),
});

/** セッション（T-091）。`id` が Cookie の値そのもの（不透明トークン） */
export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  userId: integer('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: text('expires_at').notNull(),
  createdAt: text('created_at').notNull(),
});

/**
 * 指標カスタマイズ設定（T-101。`docs/02_design/database/schema.md` §user_indicator_settings）。
 *
 * 「選択している」は行の存在で表す（選択していない指標の行は無い。
 * `transformed_metrics` が判定できた指標だけ行を持つのと同じ設計）。
 * `basisValue` は満点となる基準値。⑨MIX係数の行は常に `NULL`（設定不可）。
 */
export const userIndicatorSettings = sqliteTable(
  'user_indicator_settings',
  {
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** `MetricKey`（①〜⑩） */
    metricKey: text('metric_key').notNull(),
    basisValue: real('basis_value'),
  },
  (table) => [primaryKey({ columns: [table.userId, table.metricKey] })],
);

/**
 * ポートフォリオ（T-103。`docs/02_design/database/schema.md` §portfolios）。
 * `id` はアプリ生成の不透明ID（例 `pf_xxxxxxxx`。`WebCryptoPortfolioIdGenerator`）。
 */
export const portfolios = sqliteTable(
  'portfolios',
  {
    id: text('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [index('idx_portfolios_user_id').on(table.userId)],
);

/**
 * 保有銘柄（T-103。`docs/02_design/database/schema.md` §portfolio_holdings）。
 *
 * `companyCode` は他テーブルと異なり **`ON DELETE RESTRICT`**（銘柄が誰かに保有されている間、
 * 削除自体を拒否する）。ただし D1 は既定で外部キー制約が有効とは限らないため、実際の409判定は
 * アプリ層の明示的な `COUNT` チェックで行う（`D1PortfolioRepository.countHoldingsByCompanyCode`
 * ／`deleteCompany` usecase。`company-repository.ts:405-406` と同じ前提）。
 */
export const portfolioHoldings = sqliteTable(
  'portfolio_holdings',
  {
    portfolioId: text('portfolio_id')
      .notNull()
      .references(() => portfolios.id, { onDelete: 'cascade' }),
    companyCode: text('company_code')
      .notNull()
      .references(() => companies.code, { onDelete: 'restrict' }),
    quantity: integer('quantity').notNull(),
    acquisitionPriceSen: integer('acquisition_price_sen').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.portfolioId, table.companyCode] }),
    // `countHoldingsByCompanyCode`（`DELETE /api/companies/:code` の409判定）が
    // company_code 単独で絞り込むため、複合PK（先頭列 portfolio_id）とは別に単独索引が要る
    index('idx_portfolio_holdings_company_code').on(table.companyCode),
  ],
);
