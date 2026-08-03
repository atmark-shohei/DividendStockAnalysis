# パス規約・コマンドルール（常時読込）

## レイヤ構成と依存ルール

```
src/
    domain/           ← 素の TypeScript（フレームワーク非依存）
        company/
        scoring/
        shared/
    usecase/
    infra/d1/         ← Drizzle ORM (D1)
    handler/          ← Hono ハンドラ（zod バリデーションはここだけ）
    lib/
    index.ts
frontend/             ← React 19 + Vite + Recharts
db/migrations/        ← drizzle-kit generate の出力
tests/                ← テスト（src に colocate しない。実体のフォルダ名は vitest 設定の include で確認）
docs/                 ← 仕様の正本
```

- **依存の向き**: `handler → usecase → domain ← infra`
- この依存方向は `eslint.config.mjs` の `no-restricted-imports` で機械的に強制されている。違反すると `npm run lint` が落ちる
- パスエイリアス: `@/*` → `./src/*`

## コマンド

```bash
npm install           # 依存導入
npm run dev           # 開発サーバ
npm test              # テスト（Vitest。unit / workers の 2 系統）
npm run typecheck     # 型チェック
npm run lint          # ESLint
npm run format        # フォーマッタ
npm run build         # ビルド
```

### マイグレーション

```bash
npm run db:generate       # スキーマ変更からマイグレーション生成（drizzle-kit generate）
npm run db:migrate        # ローカル D1 へ適用（wrangler d1 migrations apply DB --local）
npm run db:migrate:remote # 本番 D1 へ適用（ユーザーが判断して実行する）
```

### テスト 2 系統（Vitest projects）

| 系統    | 設定ファイル               | 対象                                                               |
| ------- | -------------------------- | ------------------------------------------------------------------ |
| unit    | `vitest.unit.config.ts`    | domain / usecase / handler / frontend（Cloudflare ランタイム不要） |
| workers | `vitest.workers.config.ts` | infra と Worker 全体の結線（`@cloudflare/vitest-pool-workers`）    |

> 設定ファイルの実名はリポジトリ実体で確認すること。**domain のテストを workers 側で回さない**（domain は素の TS。unit 側へ倒す）。

## ルールファイル参照表

| 対象                                   | ルールファイル                                 |
| -------------------------------------- | ---------------------------------------------- |
| BE（src/ Worker 側）コーディング規約   | `ai/rules/be/coding-standards.md`              |
| BE テストパターン                      | `ai/rules/be/test-patterns.md`                 |
| BE コードレビュー チェックリスト       | `ai/rules/be/code-review-checklist.md`         |
| FE（frontend/）コーディング規約        | `ai/rules/fe/coding-standards.md`              |
| FE テストパターン                      | `ai/rules/fe/test-patterns.md`                 |
| FE コードレビュー チェックリスト       | `ai/rules/fe/code-review-checklist.md`         |
| コードレビュー出力フォーマット（共通） | `ai/rules/common/code-review-output-format.md` |

## ドキュメント参照表（docs/ が仕様の正）

| 用途                                                     | 参照先                                    |
| -------------------------------------------------------- | ----------------------------------------- |
| ユビキタス言語（型名・関数名はここの用語をそのまま使う） | `docs/glossary.md`                        |
| 設計書（API / DB / ロジック / UI）                       | `docs/02_design/{api,database,logic,ui}/` |
| 現スプリントのタスク（着手前に読む）                     | `docs/03_tasks/current-sprint.md`         |
| 決定と経緯（ADR）                                        | `docs/adr/NNNN-*.md`                      |

## コマンド実行ルール

- 原則 1 コマンドずつ実行する（`&&` / `;` / パイプの多段連結を避ける）
- `cd` によるディレクトリ移動をせず、npm の `--prefix` や絶対パスで指定する
- `command | grep` → `Grep` ツールを使う
- ビルド/テスト結果は推測せず、必ず実際に実行して出力を確認する
