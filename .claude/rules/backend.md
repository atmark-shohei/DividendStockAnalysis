# バックエンドルール

`src/` 配下（Cloudflare Workers 側）を触るときに読む。

> 詳細な規約の正本は `ai/rules/be/coding-standards.md` / `ai/rules/be/test-patterns.md`、
> パスとコマンドは `.claude/rules/path-conventions.md`。
> ここには**このアプリ固有の落とし穴**だけを書く。

## レイヤ分け

```
src/handler/      … Hono ルート・DTO・zod スキーマ。HTTP の入出力のみ。ロジックを書かない
src/usecase/      … アプリケーションサービス（1ユースケース = 1関数）。判定を書かない
src/domain/       … 素TS。計算・判定はすべてここ。最重要のテスト対象
src/infra/d1/     … Drizzle スキーマとリポジトリ実装。SQL / ORM 呼び出しはここに閉じる
src/infra/irbank/ … 外部データ源クライアント。ネットワークを知るのはここだけ
src/index.ts      … Worker エントリ（DI の組み立て）
```

依存の向きは `handler → usecase → domain ← infra`。上の層は下の層を呼ぶ。逆流させない。
`src/handler/` から D1 を直接触らない。

この依存方向は `eslint.config.mjs` の `no-restricted-imports` で機械的に強制されている。
`src/domain` に hono / drizzle / zod / `cloudflare:*` を import すると `npm run lint` が落ちる。

> `src/lib/` は軽量DDD への移行ブリッジ（`@deprecated` の再エクスポート）。
> **ここに新しいコードを書かない。** 移行台帳は `docs/migration-plan.md` §4.3。

## 外部データ源（株価・配当）

**外部データは常に壊れている前提で扱う。**

- レスポンスを受け取ったら、永続化する前に必ずスキーマ検証する。
- 検証すべき典型:
  - 必須フィールドの欠損 / `null`
  - 単位（円 / 千円 / 百万円、`%` / 倍）
  - 桁（株式分割の反映漏れで株価が10倍ずれる）
  - 日付（権利確定日が未来すぎる / 過去すぎる）
- 検証に落ちたデータは**捨てずに記録**する。原因調査に必要。
- 取得結果には必ず `fetched_at` を付けて保存する（`companies.fetched_at`）。
- **ネットワーク接点とパースを分ける。** 取得は `src/infra/irbank/fy-data-client.ts`、
  パースは `parse-fy-data.ts`（純粋関数）。規約面で自動取得ができなくなったとき、
  前段だけ差し替えられるようにするため（ADR-0007）。
- レート制限を守る。リトライは指数バックオフ。無限リトライしない。
- API キーは環境変数から読む。コード・ログ・エラーメッセージに出さない。

## 計算

- **浮動小数点で金額計算をしない。** 金額は銭単位の整数（`Sen`）で扱う。
- 配当利回り = 年間配当 ÷ 株価。**株価0・データ欠損で必ずゼロ除算を防ぐ**。
- 判定できなかった結果を 0 に丸めない。`Result` のエラーか `MetricScore` の
  `unavailableReason`（`division-by-zero` / `input-missing` 等）で表す。
- 計算関数は純粋関数にし、DB や HTTP に触らせない。テストが書けなくなる。
- 計算ロジックには必ず境界値テストを書く:
  - 無配（配当0円）
  - 株価データ欠損
  - 決算期変更・期末日跨ぎ
  - 株式分割前後

## DB

- スキーマ変更は `npm run db:generate` → `db/migrations/` の生成物を確認 → `npm run db:migrate`。
  **手で ALTER を書かない**。`npm run db:migrate:remote` はユーザーが判断して実行する。
- 金額カラムは `integer`（銭）。`real` を使わない。
  比率（%）・倍率（倍）は金額ではないので `real` でよい。
- 日時は **UTC の ISO 8601 文字列**（`text`）で保存する。SQLite にタイムゾーン付き型は無い。
  JST への変換は表示層だけで行う。
- 同じデータの二重取り込みは **複合主キー**で DB 層から防ぐ
  （例: `financial_records` は `(company_code, fiscal_year, is_forecast)`）。
- 無配（`0`）とデータ欠損（`NULL`）をカラムの型と NOT NULL 制約で区別する。
- N+1 を作らない。一覧取得は必ず1クエリか JOIN で済ませる（1000社超のため）。

## エラー処理

- domain は throw せず `Result<T, E>` を返す。ドメインエラーは判別可能な `kind` を持ち、
  handler が HTTP ステータスへ変換する。
- 外部要因の失敗（データ源の障害、レート制限）と、こちらのバグを区別してログに出す。
- handler が返すエラーに内部情報（SQL、スタックトレース、パス）を含めない。
- 握りつぶす場合は理由をコメントに書く。黙って `catch {}` しない。

## テスト

- `src/domain/` のロジックは**必ず**テストを書く。
- テストは `tests/` に `src/` と同じ構造でミラー配置する。**`src/` に colocate しない**。
- domain / usecase / handler は unit 系統、infra と Worker 全体の結線は workers 系統
  （`.claude/rules/path-conventions.md` のテスト2系統の表を参照）。
- 外部 API はモックする。テストで実 API を叩かない。
- モックのレスポンスは実物のサンプルから作る。手書きの理想形で作らない。
