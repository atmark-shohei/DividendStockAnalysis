# DividendStockAnalysis

日本株の高配当銘柄を10指標でスコアリングし、レーダーチャートで比較する Web アプリケーション。

グローバルルール（`~/.claude/CLAUDE.md`）は自動適用される。ここには**このプロジェクト
固有のことだけ**を書く。重複させない。

> 軽量DDD の規約（レイヤ構成・依存ルール・DDD 実装規約）は `.claude/CLAUDE.md` にある。
> **アーキテクチャに関わる作業の前に必ず読むこと。**

## 技術スタック

> ✅ 2026-07-28 に Next.js から Cloudflare Workers へ載せ替え済み（ADR-0001）。
> 決定と経緯は `docs/adr/` にある。

| 領域           | 採用                                     | 状態      |
| -------------- | ---------------------------------------- | --------- |
| ランタイム     | Cloudflare Workers（単一 Worker）        | 🟢 確定   |
| API            | Hono                                     | 🟢 確定   |
| バリデーション | zod（handler 境界のみ）                  | 🟢 確定   |
| DB             | Cloudflare D1 + Drizzle ORM              | 🟢 確定   |
| フロント       | React + TypeScript + Vite + Recharts     | 🟢 確定   |
| 言語           | TypeScript (strict)                      | 🟢 確定   |
| テスト         | Vitest + @cloudflare/vitest-pool-workers | 🟢 確定   |
| パッケージ管理 | **npm**（pnpm ではない。ADR-0002）       | 🟢 確定   |
| データ源       | 手動入力（TSV ペースト / CSV / 株価）    | 🟢 確定   |
| 認証           | 未定                                     | 🔴 要決定 |

未定の項目を勝手に決めて実装しない。決める必要が出たら、選択肢と推奨を提示して確認する。

## コマンド

> ✅ 2026-07-28 に下記すべて動作確認済み（Node 24.18.0 / npm 11.16.0 / wrangler 4.114.0）。
> コマンドを追加・変更したら、実際に走らせてからこの表を更新すること。
> 動かないコマンドをこの表に残さない。

| 目的                             | コマンド                |
| -------------------------------- | ----------------------- |
| セットアップ                     | `npm install`           |
| 開発（SPA ビルド＋Worker）       | `npm run dev`           |
| 開発（フロントのみ・HMR）        | `npm run dev:web`       |
| 開発（Worker のみ）              | `npm run dev:worker`    |
| テスト（全体）                   | `npm test`              |
| テスト（単体）                   | `npm test -- <pattern>` |
| 型チェック                       | `npm run typecheck`     |
| Lint                             | `npm run lint`          |
| 整形                             | `npm run format`        |
| ビルド                           | `npm run build`         |
| マイグレーション生成             | `npm run db:generate`   |
| マイグレーション適用（ローカル） | `npm run db:migrate`    |
| バインディング型の再生成         | `npm run cf-typegen`    |
| デプロイ                         | `npm run deploy`        |

`npm run dev` の前に `npm run db:migrate` を一度実行しておくこと。

## ディレクトリの責務

レイヤの定義と依存ルールは `.claude/CLAUDE.md` が正。ここには置き場所だけ書く。

- `src/domain/` — **素TS。** フレームワーク・DB・zod を import しない。テスト対象の中心
  - `company/` — 会社・財務レコード・配当履歴・リポジトリIF
  - `scoring/` — 区分表・10指標の判定・総合点
  - `shared/` — `Result` / `Score` / `Sen` / `MetricScore` / ドメインエラー
- `src/usecase/` — アプリケーションサービス（1ユースケース = 1関数）
- `src/infra/d1/` — Drizzle スキーマとリポジトリ実装。**D1 を知るのはここだけ**
- `src/handler/` — Hono ルート・DTO・zod スキーマ。HTTP の入出力のみ
- `src/index.ts` — Worker エントリ（DI の組み立て）
- `src/lib/` — **移行ブリッジ（`@deprecated`）。** 新しいコードを書かない
- `frontend/` — React + Vite + Recharts。データ取得は `App` と `api.ts` だけ
- `db/migrations/` — Drizzle が生成する SQL。**手で ALTER を書かない**
- `tests/` — `tests/domain` ほかは素の Node、`tests/integration` は workerd + D1
- `docs/` — 仕様の正。実装前に必ず該当ドキュメントを読む
- `reference/` — 旧実装のスナップショット。**参照専用。再利用も修正もしない**

## このプロジェクト固有の決まり

- **金額・比率の計算に浮動小数点を使わない。** 配当利回りや取得単価の誤差は
  そのまま投資判断の誤りになる。金額は銭単位の整数で扱う。
- **日時は UTC で保存し、表示層でのみ JST に変換する。**
  権利確定日・配当支払日はタイムゾーンずれが致命的になる。
- **取得した株価・配当データは必ず「取得時刻」とセットで保存する。**
  古いデータを最新として表示しない。
- **外部データ源のレスポンスを検証せずに信用しない。** 欠損・null・
  単位違い（円/千円、% と倍）を必ずチェックしてから永続化する。
- **`null`（判定不能）と 0点は別物。** 個別指標は `null` のまま画面へ渡し、
  画面は `—` を出す。0 に丸めるのは総合点の集計時だけ（§0.5）。
- **投資判断そのものを自動化・推奨する機能は作らない。** 分析と可視化まで。

## 作業の進め方

1. 実装前に `docs/03_tasks/current-sprint.md` を読む
2. 該当する設計書（`docs/02_design/**`）を読む。無ければ先に書く
3. 設計と実装が食い違ったら、**どちらが正しいかを確認してから**片方を直す
4. 実装が終わったら設計書も更新する。docs を陳腐化させない

## 受入基準の既定値

明示がない限り、以下を満たしたら完了とする。

- ✅ `npm test` が全パス
- ✅ `npm run typecheck` がエラーなし
- ✅ `npm run lint` がエラーなし
- ✅ 変更した挙動に対応するテストが `tests/` にある
- ✅ 金額・日付を扱う変更には境界値テストがある（0円、無配、期末日跨ぎ）
- ✅ 指標を追加・変更したら、境界値ちょうど・負値・無配・欠損の4系統を踏んでいる
