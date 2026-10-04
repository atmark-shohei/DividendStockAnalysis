# 外部スキル移植ブリーフ（DividendStockAnalysis）

**この文書は、外部で作られたスキル（特に実装系）をこのプロジェクトへ持ち込むときに、
移植元の Claude に丸ごと読ませるためのものである。**

外部の Claude はこのリポジトリを見られない前提なので、判断に必要な事実はすべてここに
書いてある。移植先の CLAUDE.md やソースを「あとで読む」ことを前提にしない。

渡し方の例:

```
これから貼るブリーフの制約に合わせて、スキル <名前> を書き直してほしい。
ブリーフに書かれていない技術（Next.js / pnpm / Prisma / fs など）は使わないこと。
不明点は勝手に決めず、質問として列挙して。

<この文書を貼る>
<移植したいスキルの SKILL.md を貼る>
```

---

## 1. プロジェクトの一行説明

日本株の高配当銘柄を10指標でスコアリングし、レーダーチャートで比較する Web アプリ。
**金額と日付の表示ミスがそのまま投資判断の誤りになる**ドメインなので、精度に関する規約が
通常より厳しい。

---

## 2. 技術スタック（実測済み・これ以外を持ち込まない）

| 領域           | 採用                                              |
| -------------- | ------------------------------------------------- |
| ランタイム     | Cloudflare Workers（単一 Worker、workerd）        |
| API            | Hono 4                                            |
| バリデーション | zod 4（**handler 境界のみ**）                     |
| DB             | Cloudflare D1（SQLite）+ Drizzle ORM 0.45         |
| マイグレーション | drizzle-kit generate → wrangler d1 migrations apply |
| フロント       | React 19 + Vite 8 + Recharts 3                    |
| 言語           | TypeScript 5.9 (strict)                           |
| テスト         | Vitest 4 + @cloudflare/vitest-pool-workers        |
| パッケージ管理 | **npm**                                           |
| Node           | v24 系（`engines: >=20`）                         |
| デプロイ       | wrangler 4                                        |
| 認証           | **未導入・未決定**                                |

### 使わないもの（外部スキルが持ち込みがちな順）

- **pnpm / yarn** — npm 固定。`pnpm install`, `pnpm vitest` を書いたら不適合
- **Next.js / App Router / Server Component / `"use client"`** — 過去に載っていたが
  Workers へ移行済み。`src/app/`, `src/pages/`, `getServerSideProps` は存在しない
- **Node.js 標準 API** — `fs` / `path` / `child_process` / `process.env` に依存する
  実装コードを書かない（`nodejs_compat` は有効だが、依存を増やさない方針）。
  設定値は Worker の `Env` バインディング経由で受け取る
- **Prisma / TypeORM / Knex / 生 SQL 直書き** — Drizzle 以外の ORM を入れない
- **Python** — この環境に未インストール。スキルのスクリプトを Python で書かない
- **`any`** — eslint で `error`。不明な型は `unknown` から絞り込む
- **浮動小数点の金額計算** — 後述（§5）
- **新しい依存の追加** — 既存の依存で足りないかを先に確認し、足りなければ理由を添えて
  提案する。勝手に `npm install` しない

### 実行環境（スキルがコマンドを流すとき）

- OS: Windows 11。シェルは **PowerShell 5.1 と Git Bash の併用**
- PowerShell では `&&` `||` `?:` が使えない。`;` と `if ($?) { }` を使う
- `head` / `tail` / `which` / `touch` などの Unix コマンドは PowerShell 側に無い
- `gh` CLI は未インストール（PR 作成手順を含むスキルは、その前提を明示すること）
- **PowerShell と Bash をひとつのスクリプトに混ぜない。** ファイル単位でどちらか一方

---

## 3. コマンド（この表以外を書かない）

| 目的                             | コマンド                |
| -------------------------------- | ----------------------- |
| セットアップ                     | `npm install`           |
| 開発（SPA ビルド＋Worker）       | `npm run dev`           |
| 開発（フロントのみ・HMR）        | `npm run dev:web`       |
| 開発（Worker のみ）              | `npm run dev:worker`    |
| テスト（全体）                   | `npm test`              |
| テスト（絞り込み）               | `npm test -- <pattern>` |
| 型チェック                       | `npm run typecheck`     |
| Lint                             | `npm run lint`          |
| 整形                             | `npm run format`        |
| ビルド                           | `npm run build`         |
| マイグレーション生成             | `npm run db:generate`   |
| マイグレーション適用（ローカル） | `npm run db:migrate`    |
| デプロイ                         | `npm run deploy`        |

`npm run dev` の前に `npm run db:migrate` を一度実行しておくこと。

`npm run typecheck` は **tsconfig を2つ**（Worker 側とフロント側）走らせる。片方だけ通っても
完了ではない。

---

## 4. レイヤ構成と依存ルール（**外部スキルが最も踏む地雷**）

```
src/
  domain/     素TS。フレームワーク・DB・zod・Cloudflare API を import しない
    company/  Company, DividendRecord, リポジトリIF
    scoring/  区分表(bands), 10指標の判定, 総合点
    shared/   Result / Score / Sen / MetricScore / DomainError / MetricKey
  usecase/    アプリケーションサービス（1ユースケース = 1関数）
  infra/d1/   Drizzle スキーマとリポジトリ実装。**D1 を知るのはここだけ**
  handler/    Hono ルート・DTO・zod スキーマ。HTTP の入出力のみ
  index.ts    Worker エントリ（DI の組み立て）
  lib/        移行ブリッジ（@deprecated）。**新しいコードを書かない**
frontend/     React + Vite + Recharts
db/migrations/  drizzle-kit の生成物。**手で ALTER を書かない**
tests/        テストは src と分離（後述）
docs/         仕様の正
```

依存の向き: `handler → usecase → domain ← infra`

これは **`eslint.config.mjs` の `no-restricted-imports` で機械的に強制されている**。
違反すると `npm run lint` が落ちる。具体的には:

- `src/domain/**` から `hono` / `drizzle-orm` / `zod` / `cloudflare:*` / `react` / `recharts`
  を import → **error**
- `src/domain/**` から `usecase` / `infra` / `handler` / `lib` を import → **error**
- `src/usecase/**` から `hono` / `drizzle-orm` / `cloudflare:*` / `infra` / `handler`
  を import → **error**
- `src/**` / `frontend/**` から `@/lib/*` を import → **warn**（移行ブリッジなので増やさない）

パスエイリアスは `@/*` → `./src/*`（Worker 側 tsconfig）。

**実装系スキルが「テストと実装を同じフォルダに置く」「ハンドラに計算を書く」
「usecase から Drizzle を直接叩く」手順を持っている場合、それは全部このプロジェクトでは
lint エラーか規約違反になる。** 移植時に手順そのものを書き換えること。

---

## 5. ドメイン固有の規約（値の扱い）

外部スキルが「普通に書いてしまう」コードが、ここでは不正解になる。

### 金額

- **浮動小数点で金額計算をしない。** 金額は銭単位の整数 `Sen`（branded type）で扱う。
  1 円 = 100 銭。`type Sen = number & { readonly __brand: 'Sen' }`
- 生成は `createSen()` / `senFromYen()` のみ。**`as Sen` のキャストをファクトリ外で書かない**
- DB の金額カラムは整数型。`FLOAT` / `REAL` を使わない

### スコア

- `Score` は **0〜10 の整数**の branded type。`createScore()` 経由でのみ作る
- 区分の解釈は「**下限以上・上限未満**」（最上位区分のみ上が開く）

### `null` と 0 の区別（このプロジェクトの中心要件）

- **「判定不能」と「0点」は別物。** 個別指標は `null` のまま画面へ渡し、画面は `—` を出す。
  0 に丸めてよいのは総合点の集計時だけ
- これは `MetricScore` の判別可能ユニオンで**型が保証している**:

```ts
type MetricScore<R extends string = UnavailableReason> =
  | { readonly score: Score; readonly value: number; readonly unavailableReason: null }
  | { readonly score: null; readonly value: null; readonly unavailableReason: R };
```

`score: 5` かつ `unavailableReason: 'input-missing'` のような矛盾した値は型エラーになる。
`UnavailableReason` は `'input-missing' | 'insufficient-history' | 'division-by-zero'
| 'undefined-growth' | 'input-invalid' | 'value-out-of-band'`。

- **フロントで「データなしを 0 と表示」しない。** `—` か「データなし」と明示する

### エラー処理

- **ドメイン層は throw しない。`Result<T, E>` を返す。**

```ts
export type Result<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };
```

- ドメインエラーは判別可能な `kind` を持つ（例 `{ kind: 'ScoreOutOfRange', value: 11 }`）。
  handler が `kind` を見て HTTP ステータスと日本語文言に変換する。
  **ドメイン層に UI 文言を持たせない**
- API が返すエラーに内部情報（SQL・スタックトレース・パス）を含めない

### 日時

- **UTC で保存し、表示層でのみ JST に変換する。** 権利確定日・配当支払日のずれは致命的

### 外部データ

- 外部データは常に壊れている前提。永続化の前に必ずスキーマ検証する
  （欠損 / `null` / 単位違い〈円・千円・%と倍〉/ 桁ずれ〈分割の反映漏れ〉/ 日付の異常）
- 取得結果には必ず **`fetched_at`** を付けて保存する。古いデータを最新として表示しない
- 検証に落ちたデータは**捨てずに記録**する
- テストで実 API を叩かない。モックは実物のサンプルから作る

### やらないこと

- **投資判断そのものを自動化・推奨する機能は作らない。** 分析と可視化まで

---

## 6. テストの置き場所と2系統構成

**テストは `src/` に colocate しない。`tests/` 配下にミラーする。**

```
tests/domain/{company,scoring,shared}/*.test.ts   素の Node で動く（大半はこちら）
tests/usecase/  tests/handler/  tests/frontend/    素の Node
tests/integration/*.test.ts                        workerd + 実 D1
tests/helpers/  tests/fixtures/                    共有ヘルパ・データ
```

Vitest は projects で2系統に分かれている:

- `vitest.unit.config.ts` — domain / usecase / handler / frontend
- `vitest.workers.config.ts` — infra と Worker 全体の結線（`@cloudflare/vitest-pool-workers`）

ドメインが素TSであることの裏返しで、**計算ロジックのテストは Cloudflare ランタイムを
必要としない**。外部スキルが「Workers 環境でドメインのテストを回す」手順を持っていたら、
unit 側へ倒すこと。

テストは table-driven を基本とし、名前で「何が壊れたか」が分かるようにする。

---

## 7. 受入基準の既定値

明示がない限り、スキルの完了条件はこれ。**推測で「完了」と言わせない。**

- ✅ `npm test` が全パス
- ✅ `npm run typecheck` がエラーなし（tsconfig 2本とも）
- ✅ `npm run lint` がエラーなし
- ✅ 変更した挙動に対応するテストが `tests/` にある
- ✅ 金額・日付を扱う変更には境界値テストがある（0円、無配、期末日跨ぎ、分割前後）
- ✅ 指標を追加・変更したら、**境界値ちょうど・負値・無配・欠損の4系統**を踏んでいる

完了報告には証拠（コマンド出力・ファイル行）を添える。失敗したら失敗したと出力付きで言う。

---

## 8. ドキュメント運用

- `docs/` が仕様の正。実装前に該当ドキュメントを読む
  - `docs/glossary.md` — ユビキタス言語。**型名・関数名はここの用語をそのまま使う**
  - `docs/domain-model.md`
  - `docs/02_design/{api,database,logic,ui}/` — 設計書
  - `docs/03_tasks/current-sprint.md` — 着手前に読む
  - `docs/adr/NNNN-*.md` — 決定と経緯（0001〜0010 が既存）
- 設計と実装が食い違ったら、**どちらが正しいかを確認してから**片方を直す
- 実装が終わったら設計書も更新する

**実装系スキルには「該当設計書を読む」「終わったら設計書を更新する」ステップを
入れること。** 外部スキルにはたいてい無い。

---

## 9. スキルの書式

`.claude/skills/<name>/SKILL.md`。frontmatter は最小:

```markdown
---
name: <kebab-case>
description: <日本語1〜2文。いつ起動するかを「〜と言われたときに使う」形で書く>
---
```

既存スキルの description は、起動条件を日本語の言い回しで列挙するスタイルで揃っている
（例: 「決算データを取り込む、CSV を読み込む、TSV をパースする、と言われたときに使う」）。
移植時は英語 description を日本語へ置き換え、**このプロジェクトで実際に使う言い回し**を
入れること。

本文の言語は日本語。ただし**コード内のコメント・識別子は英語**。

---

## 10. 移植チェックリスト

外部スキルを持ち込む前に、SKILL.md を上から見てこれを潰す。

| # | 見るもの | 不適合の例 | 直し方 |
|---|---|---|---|
| 1 | パッケージマネージャ | `pnpm` / `yarn` | `npm` |
| 2 | フレームワーク前提 | Next.js / `src/app/` / `"use client"` | Hono + React SPA（Vite） |
| 3 | DB アクセス | Prisma / 生 SQL / `src/app` から DB | Drizzle、`src/infra/d1/` に閉じる |
| 4 | マイグレーション | 手書き ALTER | `npm run db:generate` |
| 5 | テストの置き場所 | `src/**/*.test.ts` | `tests/` にミラー |
| 6 | テストランナー | jest / 単一 vitest 設定 | Vitest 2系統（unit / workers） |
| 7 | エラー処理 | `throw` / `try-catch` でドメインエラー | `Result<T, E>` + `kind` |
| 8 | 数値 | `number` で金額、`toFixed` で丸め | `Sen`（銭単位の整数）、丸めは表示層1箇所 |
| 9 | 欠損値 | `?? 0` / `\|\| 0` | `null` を保ち `—` を出す |
| 10 | 型 | `any` | `unknown` から絞り込む |
| 11 | 検証 | domain で zod | zod は handler 境界のみ |
| 12 | 日時 | ローカル時刻で保存 | UTC 保存・表示層で JST |
| 13 | 外部データ | 取得してそのまま保存 | 検証 + `fetched_at` + 失敗の記録 |
| 14 | シェル | `&&` を含む PowerShell、Unix コマンド前提 | `;` / `if ($?) { }`、Bash なら Bash で統一 |
| 15 | 依存追加 | 黙って `npm install` | 既存で足りるか確認 → 提案 |
| 16 | 完了条件 | 「動く」「きれい」 | §7 の受入基準を貼る |
| 17 | 秘密情報 | `.env` を読む手順 | 環境変数「名」だけ扱う。`.env` は permissions で deny 済み |
| 18 | docs 連携 | 設計書に触れない | 「設計書を読む」「更新する」ステップを追加 |

---

## 11. 既知の落とし穴（リポジトリ内の記述が古い箇所）

移植元の Claude がこのリポジトリを覗ける場合、次を**信用させない**こと。

- `.claude/rules/backend.md` / `.claude/rules/frontend.md` は Next.js 時代のパス
  （`src/app/`, `src/lib/<domain>/`, Server Component）で書かれている。
  **レイヤの定義は本文書 §4 と `.claude/CLAUDE.md` が正**。rules の価値は
  「外部データの扱い」「金額表示」など**ランタイム非依存の部分**にある
- `.claude/skills/usecase-add/SKILL.md` は `pnpm vitest run src/domain` と
  colocate 前提のテストパスが残っている（実際は `npm test -- tests/domain`）
- `.claude/CLAUDE.md` は文字化けした原本から再構成したもので、`✅ 訂正` の注記が
  付いた箇所は**注記のほうが正しい**（Score は 0〜10、pnpm ではなく npm、
  better-auth と UserScoringPolicy は未導入）
- `reference/` は旧実装のスナップショット。**参照専用。再利用も修正もしない**
- `src/lib/` は移行ブリッジ（`@deprecated`）。新しいコードを置かない

---

## 12. 未決定事項（勝手に決めさせない）

- **認証**（マスターユーザー / 一般ユーザーの要否、公開範囲）— 未決定。
  ログイン・ユーザー登録を前提にしたスキルは、そのまま入れられない
- **ユーザーごとの閾値設定**（`UserScoringPolicy`）— 未導入。閾値は
  `src/domain/scoring/bands.ts` の定数に固定
- **フロントのスタイル方式**（Tailwind / CSS Modules 等）— 未確定

未定の項目を勝手に決めて実装しない。決める必要が出たら、選択肢と推奨を提示して確認する。
