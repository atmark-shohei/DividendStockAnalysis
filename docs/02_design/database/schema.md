# データベース設計

> ステータス: 🟡 draft — DB 製品・ORM が未確定。テーブル定義も**たたき台**。

## 設計方針

- 金額は**銭単位の整数**で保存する（`price_sen BIGINT`）。`FLOAT` を使わない
- 日時は UTC。`TIMESTAMPTZ` 相当を使う
- 外部から取り込んだ行には必ず `fetched_at` を持たせる
- 自然キーに UNIQUE を張り、二重取り込みを DB 層で防ぐ
- 無配（0円）とデータ欠損（NULL）を型で区別する

## ER 図（テキスト）

```
stocks 1 ──< dividends
   │
   ├──< stock_prices
   │
   └──< watchlist_items >── 1 users （認証を入れる場合のみ）
```

## テーブル定義

### stocks — 銘柄マスタ

| カラム                | 型          | 制約            | 説明                   |
| --------------------- | ----------- | --------------- | ---------------------- |
| id                    | BIGSERIAL   | PK              |                        |
| code                  | VARCHAR(5)  | UNIQUE NOT NULL | 銘柄コード（例: 8058） |
| name                  | TEXT        | NOT NULL        | 銘柄名                 |
| sector                | TEXT        |                 | 業種                   |
| market                | TEXT        |                 | 市場区分               |
| fiscal_year_end_month | SMALLINT    |                 | 決算月（1-12）         |
| fetched_at            | TIMESTAMPTZ | NOT NULL        |                        |
| created_at            | TIMESTAMPTZ | NOT NULL        |                        |
| updated_at            | TIMESTAMPTZ | NOT NULL        |                        |

### dividends — 配当実績

| カラム       | 型          | 制約           | 説明                                                  |
| ------------ | ----------- | -------------- | ----------------------------------------------------- |
| id           | BIGSERIAL   | PK             |                                                       |
| stock_id     | BIGINT      | FK → stocks.id |                                                       |
| fiscal_year  | SMALLINT    | NOT NULL       | 対象年度                                              |
| period       | TEXT        | NOT NULL       | `interim` / `final` / `annual`                        |
| amount_sen   | BIGINT      | NOT NULL       | 1株あたり配当（銭）。**無配は 0**、不明は行を作らない |
| is_forecast  | BOOLEAN     | NOT NULL       | 予想値か実績値か                                      |
| ex_date      | DATE        |                | 権利確定日                                            |
| payment_date | DATE        |                | 支払日                                                |
| fetched_at   | TIMESTAMPTZ | NOT NULL       |                                                       |

制約: `UNIQUE (stock_id, fiscal_year, period, is_forecast)`

> ⚠️ **予想値と実績値を必ず分ける。** 混ぜると利回りが実態とずれる。

### stock_prices — 株価

| カラム     | 型          | 制約           | 説明           |
| ---------- | ----------- | -------------- | -------------- |
| id         | BIGSERIAL   | PK             |                |
| stock_id   | BIGINT      | FK → stocks.id |                |
| date       | DATE        | NOT NULL       |                |
| close_sen  | BIGINT      | NOT NULL       | 終値（銭）     |
| adjusted   | BOOLEAN     | NOT NULL       | 分割調整済みか |
| fetched_at | TIMESTAMPTZ | NOT NULL       |                |

制約: `UNIQUE (stock_id, date)`

### watchlist_items — ウォッチリスト

| カラム     | 型          | 制約           | 説明                 |
| ---------- | ----------- | -------------- | -------------------- |
| id         | BIGSERIAL   | PK             |                      |
| user_id    | BIGINT      | FK → users.id  | 認証を入れる場合のみ |
| stock_id   | BIGINT      | FK → stocks.id |                      |
| note       | TEXT        |                | 自由メモ             |
| sort_order | INTEGER     |                |                      |
| created_at | TIMESTAMPTZ | NOT NULL       |                      |

制約: `UNIQUE (user_id, stock_id)`

### ingest_errors — 取り込み失敗の記録

| カラム      | 型          | 説明                                             |
| ----------- | ----------- | ------------------------------------------------ |
| id          | BIGSERIAL   |                                                  |
| source      | TEXT        | データ源名                                       |
| payload     | JSONB       | 受け取った生データ（**秘密情報を含めないこと**） |
| reason      | TEXT        | 検証エラーの内容                                 |
| occurred_at | TIMESTAMPTZ |                                                  |

失敗データを捨てない。原因調査に必要。

## 計算式（実装は `src/lib/` に置く。DB では計算しない）

```
配当利回り(%) = 年間配当(銭) / 株価(銭) * 100
  ※ 株価が 0 または NULL のときは計算せず「—」を返す
  ※ 予想と実績のどちらを使ったかを結果に含める

連続配当年数 = amount_sen > 0 が途切れず続いた年数
連続増配年数 = 前年比で amount_sen が増加し続けた年数
```

## 未決定

- [ ] DB 製品（SQLite / PostgreSQL）
- [ ] ORM / クエリビルダ
- [ ] users テーブルが必要か（単一ユーザーなら不要）
- [ ] 株価をどこまで保持するか（全日足 / 直近のみ）
