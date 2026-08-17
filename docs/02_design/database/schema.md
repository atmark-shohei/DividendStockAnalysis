# データベース設計

> ステータス: 🟢 銘柄・スコア部分は実装済み（2026-07-28）／🟡 認証・ポートフォリオ部分は設計のみ（2026-08-16 追加）
> 実装: `src/infra/d1/schema.ts` / マイグレーション: `db/migrations/0000_reflective_prism.sql`
>
> ⚠️ **2026-07-28 に全面書き直し。** 旧版は PostgreSQL（`BIGSERIAL`/`TIMESTAMPTZ`）を前提に
> `stocks`/`dividends`/`stock_prices`/`watchlist_items`/`users`/`ingest_errors` を定義していたが、
> [ADR-0001](../../adr/0001-runtime-cloudflare-workers.md) で **Cloudflare D1（SQLite）+ Drizzle ORM**
> に決定し、テーブル構成も作り直した。ウォッチリスト・株価履歴・取り込みエラーの記録テーブルは
> **現時点では実装していない**（用途が生まれたら追加する。§ 未実装・検討事項）。
>
> ✅ **2026-08-16 追記（T-078）。** [ADR-0013](../../adr/0013-multi-user-auth-small-scale.md)
> の認証導入決定を受け、`users`/`sessions`/`portfolios`/`portfolio_holdings`/
> `user_indicator_settings` の5テーブルを追加した（§テーブル定義（認証・ポートフォリオ））。
> **実装（`src/infra/d1/schema.ts` へのマイグレーション反映）はまだ**（T-091・T-102 待ち）。

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
   ├──< transformed_metrics
   │
   └──< portfolio_holdings >── N portfolios 1 ── N users
                                                     │
                                                     ├──< sessions
                                                     │
                                                     └──< user_indicator_settings
```

`score_cards` は `companies` と1対1（`company_code` が主キーかつ外部キー）。
`companies` 側は原則 `ON DELETE CASCADE`（銘柄を削除すれば明細も消える）だが、
**`portfolio_holdings` だけ例外**（`ON DELETE RESTRICT`。§テーブル定義（認証・ポートフォリオ）
の注記を参照）。`users` 側は `ON DELETE CASCADE`（ユーザーを削除すれば
セッション・ポートフォリオ・指標設定も消える）。

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

### 明細の一括 INSERT はバインド変数の上限で分割する（2026-08-05 追加）

`save()` は明細（`financial_records` / `dividend_records` / `transformed_metrics`）を
「全消し→入れ直し」で書く。このとき **D1 は1文あたりのバインド変数を100個までしか受け付けない**
（超えると `D1_ERROR: too many SQL variables: SQLITE_ERROR`）。1文にまとめて INSERT すると
実測で `dividend_records` は26件・`financial_records` は15件で落ちた。

そのため `D1_MAX_BOUND_PARAMETERS`（= 100）と各行の列数から1文あたりの行数を割り算で求め、
複数文に分割して `db.batch()` に渡す（`src/infra/d1/company-repository.ts`）。
`db.batch()` は分割後も1トランザクションなので、取り込み失敗で既存データを壊さない
（`non-functional.md`）性質は変わらない。

API の契約は `records` / `dividends` とも最大60件（`company-api.md`）で、この分割により
60件でも保存できる。Yahoo 取り込みは配当が20〜28年ぶん入るため、この上限に日常的に接近する。

## 計算とスコアの再現性

**詳細表示は保存済みの生データ（`financial_records`/`dividend_records`）から毎回採点し直す**
（`usecase/read-companies.ts` の `getCompanyScoring`）。`score_cards`/`transformed_metrics` は
再監査用のスナップショットであり、画面表示の一次ソースではない。ロジックを直したあとに
古い整形データをそのまま見せると、画面と実装が食い違うため。

## テーブル定義（認証・ポートフォリオ。2026-08-16 追加、T-078）

> 🟡 **設計のみ。実装（`schema.ts`・マイグレーション）は未着手。**
> 要求元: [ADR-0013](../../adr/0013-multi-user-auth-small-scale.md)（認証・ロール・PBKDF2）、
> [portfolio-api.md](../api/portfolio-api.md)（API契約）、
> [indicator-custom-page.md](../ui/pages/indicator-custom-page.md)（指標カスタマイズ）。
> §4「依存元の設計書と突き合わせる」の結果、`portfolio-api.md` のレスポンス例
> （`id`/`name`/`code`/`quantity`/`acquisitionPriceSen` 等）とカラム名の齟齬は無かった。

### users — ユーザー

| カラム              | 型      | 制約              | 説明                                                                                                                                    |
| ------------------- | ------- | ----------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| id                  | integer | PK, autoincrement | 内部専用。URL には出さない（`portfolios.id` と異なり非公開）                                                                            |
| email               | text    | NOT NULL, UNIQUE  | ログインID                                                                                                                              |
| password_hash       | text    | NOT NULL          | PBKDF2 の出力（[ADR-0013](../../adr/0013-multi-user-auth-small-scale.md) §決定3）                                                       |
| password_salt       | text    | NOT NULL          | ユーザーごとにランダム生成                                                                                                              |
| password_iterations | integer | NOT NULL          | ハッシュ時のイテレーション数（T-063で確定する値をそのまま保存。**将来値を上げても既存行のハッシュはそのまま検証できる**ようにするため） |
| role                | text    | NOT NULL          | `user` \| `admin`。**`guest` は未ログイン状態であり行を持たない**                                                                       |
| failed_login_count  | integer | NOT NULL, 既定 0  | ログイン失敗の連続回数。ログイン成功で 0 にリセット（[auth-api.md](../api/auth-api.md) §レート制限）                                    |
| locked_until        | text    |                   | この時刻まではログイン試行を拒否する。UTC ISO 8601。`NULL`＝ロックなし                                                                  |
| created_at          | text    | NOT NULL          | UTC ISO 8601                                                                                                                            |

- **最初に登録したユーザーが `admin`**（[ADR-0013](../../adr/0013-multi-user-auth-small-scale.md) §決定2）。
  「1人目か」の判定は `SELECT COUNT(*) FROM users` で行う（専用フラグ列を持たない）
- **人数上限（`SIGNUP_MAX_USERS`）はテーブルに持たない。** 環境変数なので、
  サインアップ時に `COUNT(*)` と比較するだけで足りる
- **`failed_login_count`/`locked_until` はユーザー単位のレート制限**（2026-08-17 追加、T-076）。
  IPベースではなくメールアドレス単位でロックする。詳細は [auth-api.md](../api/auth-api.md) §レート制限

### sessions — セッション

| カラム     | 型      | 制約                    | 説明                                      |
| ---------- | ------- | ----------------------- | ----------------------------------------- |
| id         | text    | PK                      | セッショントークン（Cookie の値そのもの） |
| user_id    | integer | NOT NULL, FK → users.id | `ON DELETE CASCADE`                       |
| expires_at | text    | NOT NULL                | UTC ISO 8601                              |
| created_at | text    | NOT NULL                | UTC ISO 8601                              |

- 期限切れ行の削除は定期実行またはログイン時の遅延削除で行う（実装時に決める。設計書の対象外）

### portfolios — ポートフォリオ

| カラム     | 型      | 制約                    | 説明                                                                                    |
| ---------- | ------- | ----------------------- | --------------------------------------------------------------------------------------- |
| id         | text    | PK                      | アプリ生成の不透明ID（例 `pf_xxxxxxxx`）。`portfolio-api.md` の例と一致させるため文字列 |
| user_id    | integer | NOT NULL, FK → users.id | `ON DELETE CASCADE`                                                                     |
| name       | text    | NOT NULL                | 1〜50文字（範囲検証は zod。DB は NOT NULL のみ）                                        |
| created_at | text    | NOT NULL                | UTC ISO 8601                                                                            |

- **1ユーザー最大10件の制約は DB に持たない。** 保存前に `COUNT(*)` で数えてから
  拒否する（`portfolio-api.md` の 403）。SQLite の `CHECK` は行数を見られないため

### portfolio_holdings — 保有銘柄

| カラム                | 型      | 制約                          | 説明                                   |
| --------------------- | ------- | ----------------------------- | -------------------------------------- |
| portfolio_id          | text    | NOT NULL, FK → portfolios.id  | `ON DELETE CASCADE`                    |
| company_code          | text    | NOT NULL, FK → companies.code | **`ON DELETE RESTRICT`**（下記の注記） |
| quantity              | integer | NOT NULL                      | 保有数量（株）                         |
| acquisition_price_sen | integer | NOT NULL                      | 取得単価（銭/株）                      |
| created_at            | text    | NOT NULL                      | UTC ISO 8601                           |
| updated_at            | text    | NOT NULL                      | UTC ISO 8601                           |

PK: `(portfolio_id, company_code)`。**同じポートフォリオへの同一銘柄の重複追加を DB 層で防ぐ**
（`portfolio-api.md` の 409 と対応）。

**評価額・評価損益・現在株価・スコア等は保存しない。** [portfolio-metrics.md](../logic/portfolio-metrics.md)
が定めるとおり、`companies`/`score_cards`/`transformed_metrics` から毎回算出する
（`companies.price_sen` 等の「詳細表示は毎回採点し直す」既存方針と同じ。§計算とスコアの再現性）。

> ⚠️ **`company_code` の外部キーを `ON DELETE RESTRICT` にする決定（この設計書の判断）。**
> 他テーブルは銘柄削除に追随して `CASCADE` するが、ここは**銘柄が誰かに保有されている間、
> 削除自体を拒否する**。ユーザーが記録した取得単価・数量は個人の資産記録であり、
> 無関係な admin の銘柄削除操作で黙って失われてよいデータではないため
> （`.claude/CLAUDE.md` が一貫して「データを黙って失わせない」立場を取っているのと同じ理由）。
>
> **影響: 既存の `DELETE /api/companies/:code` ハンドラに変更が要る。**
> 保有されている銘柄の削除リクエストは FK 制約違反になるため、
> 409（`{ "error": "この銘柄は誰かのポートフォリオに保有されているため削除できません" }`）
> に変換する必要がある。**この対応は T-091 以降（ポートフォリオ実装時）の実装課題として残す**
> （現在の `DELETE /api/companies/:code` はテーブルが存在しないため影響なし）。

### user_indicator_settings — 指標カスタマイズ設定

| カラム      | 型      | 制約                    | 説明                                                                                                                                      |
| ----------- | ------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| user_id     | integer | NOT NULL, FK → users.id | `ON DELETE CASCADE`                                                                                                                       |
| metric_key  | text    | NOT NULL                | `MetricKey`（①〜⑩。`transformed_metrics.metric_key` と同じ語彙）                                                                          |
| basis_value | real    |                         | 満点となる基準値。**MIX係数の行は常に `NULL`**（設定不可。[ADR-0012](../../adr/0012-indicator-customization-scaling-and-denominator.md)） |

PK: `(user_id, metric_key)`。

- **「選択している」は行の存在で表す。** 選択していない指標の行は無い
  （`transformed_metrics` が判定できた指標だけ行を持つのと同じ設計）。
  5〜10件という選択数の制約は zod（アプリ層）で検証する（`portfolio-api.md` の 400）
- `PUT /api/indicator-settings` は**全置き換え**なので、実装は
  「該当 `user_id` の行を全削除 → 新しい選択ぶんを INSERT」の1トランザクションになる

## 未実装・検討事項

- **株価の時系列保持** — 現在は `companies.price_sen` に最新1件のみ。日足を残すかは未定
- **`watchlist_items`（ウォッチリスト）** — 要件定義（`features.md`）に対応する機能が無く、旧draftの下書き。実装計画なし
- **`ingest_errors`（取り込み失敗の記録）** — TSV/CSV 自動取り込み（F-01〜F-04、未着手）を実装する際に必要になる。それまでは対象データが無い
- **`UserScoringPolicy` 用のテーブル** — ✅ **解消（2026-08-16）。** [ADR-0005](../../adr/0005-thresholds-fixed-for-now.md)
  が待っていた「認証の要否」は [ADR-0013](../../adr/0013-multi-user-auth-small-scale.md) で決着し、
  `user_indicator_settings` として上に定義した
- **セッションの期限切れ行の掃除方法** — 定期実行 or 遅延削除。未実装時に決める
- **`DELETE /api/companies/:code` の 409 対応** — `portfolio_holdings` の `ON DELETE RESTRICT` により、
  ポートフォリオ実装時にハンドラの変更が要る（上記の注記）
- **総合点の出所が2系統（一覧の `score_cards` vs 詳細の毎回再採点）で、
  スコアリングロジック変更直後は一時的に食い違いうる**（T-088レビューで発見、
  2026-08-17。[company-api.md](../api/company-api.md) `GET /api/companies` に詳細を記載）。
  現状は性能とのトレードオフとして許容。`score_cards.calc_version` を使った
  自動再計算・古さの検知は未実装
- ⚠️ **`score_cards` は 1銘柄1行（全ユーザー共通）の設計。指標カスタマイズ（T-101）が
  実装され、総合点がユーザーごとの選択・基準値に依存するようになると、
  この前提が成立しなくなる。** `score_cards.total_score` を「そのユーザーの設定での
  総合点」に置き換えるか、ユーザーごとに動的計算するか、**T-101着手前に決める必要がある**
  （現状は未決。`score_cards` の構造自体を見直すか、検索・ポートフォリオ一覧の
  総合点表示方法ごと再設計するかの判断を含む）
