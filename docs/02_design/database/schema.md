# データベース設計

> ステータス: 🟢 実装済み（2026-07-28）
> 実装: `src/infra/d1/schema.ts` / マイグレーション: `db/migrations/0000_reflective_prism.sql`
>
> ⚠️ **2026-07-28 に全面書き直し。** 旧版は PostgreSQL（`BIGSERIAL`/`TIMESTAMPTZ`）を前提に
> `stocks`/`dividends`/`stock_prices`/`watchlist_items`/`users`/`ingest_errors` を定義していたが、
> [ADR-0001](../../adr/0001-runtime-cloudflare-workers.md) で **Cloudflare D1（SQLite）+ Drizzle ORM**
> に決定し、テーブル構成も作り直した。ウォッチリスト・株価履歴・取り込みエラーの記録テーブルは
> **現時点では実装していない**（用途が生まれたら追加する。§ 未実装・検討事項）。

## 設計方針

- 金額カラムは**整数（銭）**。`integer`。丸め誤差が投資判断の誤りになるため `real` を使わない
- 比率（%）・倍率（倍）は金額ではないので `real` でよい
- 日時は UTC の ISO 8601 文字列（`text`）。表示層でのみ JST に変換する
- 自然キー（銘柄コード、銘柄コード+年度+区分）をそのまま主キーにし、二重取り込みを DB 層で防ぐ
- 無配（0）とデータ欠損（`NULL`）を型で区別する。**0 に丸めない**
- 生データ（`financial_records`/`dividend_records`）と整形データ（`score_cards`/`transformed_metrics`）を
  **両方**保存する。整形データは再計算可能だが、再監査のために計算時点の値を残す
  （`.claude/CLAUDE.md`）

## ER 図（テキスト）

```
companies 1 ──< financial_records
   │
   ├──< dividend_records
   │
   ├──1 score_cards
   │
   └──< transformed_metrics
```

`score_cards` は `companies` と1対1（`company_code` が主キーかつ外部キー）。
すべて `ON DELETE CASCADE`。銘柄を削除すれば明細も消える。

## テーブル定義

### companies — 銘柄マスタ（生データ）

| カラム                      | 型      | 制約     | 説明                               |
| --------------------------- | ------- | -------- | ---------------------------------- |
| code                        | text    | PK       | 銘柄コード（例: 9433）。自然キー   |
| name                        | text    | NOT NULL | 銘柄名                             |
| price_sen                   | integer |          | ユーザーが手入力した現在株価（銭） |
| per                         | real    |          | PER（会社予想）。倍                |
| pbr                         | real    |          | PBR（実績）。倍                    |
| current_assets_sen          | integer |          | ⑥ 用。流動資産（銭）               |
| investment_securities_sen   | integer |          | ⑥ 用。投資有価証券（銭）           |
| total_liabilities_sen       | integer |          | ⑥ 用。負債総額（銭）               |
| previous_dividend_total_sen | integer |          | ⑥ 用。前期末の配当総額（銭）       |
| fetched_at                  | text    | NOT NULL | 入力（解析）した日時。UTC ISO 8601 |
| created_at                  | text    | NOT NULL | 既定値 `CURRENT_TIMESTAMP`         |
| updated_at                  | text    | NOT NULL | 既定値 `CURRENT_TIMESTAMP`         |

株価は**現在値1件のみ**保持する。時系列（日足）は保持しない（§ 未実装・検討事項）。

### financial_records — 年度別の財務レコード（生データ）

| カラム                   | 型      | 制約                          | 説明                 |
| ------------------------ | ------- | ----------------------------- | -------------------- |
| company_code             | text    | NOT NULL, FK → companies.code |                      |
| fiscal_year              | integer | NOT NULL                      | 決算年度             |
| is_forecast              | integer | NOT NULL                      | 予想なら1、実績なら0 |
| eps_sen                  | integer |                               | 1株利益（銭）        |
| roe_percent              | real    |                               | 自己資本利益率（%）  |
| revenue_sen              | integer |                               | 売上高（銭）         |
| operating_margin_percent | real    |                               | 営業利益率（%）      |

PK: `(company_code, fiscal_year, is_forecast)`。同一年度でも予想と実績は別行。

> ✅ **2026-07-31 訂正。** `dividend_per_share_sen` 列は削除した
> （[ADR-0009](../../adr/0009-dividend-single-source.md)）。1株配当は
> `dividend_records.annual_amount_sen` のみが保持する。②連続非減配年数が
> 18年前まで遡る「配当履歴」の関心事であって財務諸表の1項目ではないこと、
> 二重管理は取得元が分かれると必ず食い違うことが理由。①②③はいずれも
> `dividend_records` を読む。マイグレーション: `db/migrations/0002_even_odin.sql`。

### dividend_records — 配当履歴（生データ、⑩ が使う）

| カラム            | 型      | 制約                          | 説明                                                |
| ----------------- | ------- | ----------------------------- | --------------------------------------------------- |
| company_code      | text    | NOT NULL, FK → companies.code |                                                     |
| fiscal_year       | integer | NOT NULL                      | 決算年度                                            |
| kind              | text    | NOT NULL                      | `forecast` / `revised` / `actual`                   |
| annual_amount_sen | integer |                               | 年間配当合計（銭）。**`NULL`＝データなし。0＝無配** |

PK: `(company_code, fiscal_year, kind)`。

### score_cards — 総合点（整形データ）

| カラム                 | 型      | 制約                    | 説明                                                   |
| ---------------------- | ------- | ----------------------- | ------------------------------------------------------ |
| company_code           | text    | PK, FK → companies.code |                                                        |
| total_score            | integer | NOT NULL                | 0〜100。判定不能は0点として合算済み（§0.5）            |
| effective_metric_count | integer | NOT NULL                | 判定できた指標の数                                     |
| calc_version           | text    | NOT NULL                | 計算ロジックのバージョン。閾値・計算式を変えたら上げる |
| calculated_at          | text    | NOT NULL                | 計算した日時。UTC ISO 8601                             |

### transformed_metrics — 指標別の整形値（整形データ）

| カラム             | 型      | 制約                          | 説明                                                   |
| ------------------ | ------- | ----------------------------- | ------------------------------------------------------ |
| company_code       | text    | NOT NULL, FK → companies.code |                                                        |
| metric_key         | text    | NOT NULL                      | `MetricKey`（①〜⑩。`src/domain/shared/metric-key.ts`） |
| score              | integer |                               | 0〜10。**判定不能は `NULL`。0に丸めない**（§0.5）      |
| value              | real    |                               | 判定に使った算出値。判定不能なら `NULL`                |
| unavailable_reason | text    |                               | 判定不能の理由。判定できたなら `NULL`                  |

PK: `(company_code, metric_key)`。`metric_key` に索引あり（指標別の横断集計用）。

## リポジトリ境界

DB を直接知るのは `src/infra/d1/` だけ（`.claude/CLAUDE.md` 依存ルール）。
ドメイン側は `CompanyRepository`（`src/domain/company/company-repository.ts`）というインターフェースだけを知る。

```ts
interface CompanyRepository {
  save(company: Company, scoring: StoredScoring): Promise<void>;
  findByCode(code: string): Promise<Company | null>;
  listSummaries(): Promise<readonly CompanySummary[]>; // 1000社規模の一覧用 read model
  deleteByCode(code: string): Promise<void>;
}
```

一覧表示（`listSummaries`）は明細を持たない要約専用クエリで、N+1 を避ける。

## 計算とスコアの再現性

**詳細表示は保存済みの生データ（`financial_records`/`dividend_records`）から毎回採点し直す**
（`usecase/read-companies.ts` の `getCompanyScoring`）。`score_cards`/`transformed_metrics` は
再監査用のスナップショットであり、画面表示の一次ソースではない。ロジックを直したあとに
古い整形データをそのまま見せると、画面と実装が食い違うため。

## 未実装・検討事項

- **株価の時系列保持** — 現在は `companies.price_sen` に最新1件のみ。日足を残すかは未定
- **`watchlist_items`（ウォッチリスト）** — 要件定義（`features.md`）に対応する機能が無く、旧draftの下書き。実装計画なし
- **`ingest_errors`（取り込み失敗の記録）** — TSV/CSV 自動取り込み（F-01〜F-04、未着手）を実装する際に必要になる。それまでは対象データが無い
- **`UserScoringPolicy` 用のテーブル** — [ADR-0005](../../adr/0005-thresholds-fixed-for-now.md)。認証の要否（T-003/T-004）待ち
