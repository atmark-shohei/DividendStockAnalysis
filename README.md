# DividendStockAnalysis

日本株の高配当銘柄を10指標でスコアリングし、レーダーチャートで比較する Web アプリケーション。

> 🟢 **スコアリングエンジンは10指標すべて実装済み**（2026-07-28）。
> データ取り込み（TSV / CSV）は未実装で、現在は画面のフォームに直接入力する。
> 残課題は [docs/migration-plan.md](./docs/migration-plan.md) 第6部。

## セットアップ

```bash
npm install
npm run db:migrate   # ローカル D1 にマイグレーションを適用（初回のみ）
npm run dev          # SPA をビルドして wrangler dev を起動（http://127.0.0.1:8787）
```

フロントエンドを HMR で触るときは、別ターミナルで `npm run dev:worker` と
`npm run dev:web`（http://127.0.0.1:5173、`/api` は 8787 へ中継）を並べて動かす。

## アーキテクチャ

Cloudflare Workers + Hono + D1（Drizzle）+ React/Vite/Recharts の単一 Worker 構成。
**軽量DDD のレイヤード**で、依存の向きは `handler -> usecase -> domain <- infra`。

```
src/
├── domain/        素TS。フレームワーク・DB・zod を import しない
│   ├── company/   会社・財務レコード・配当履歴・リポジトリIF
│   ├── scoring/   区分表・10指標の判定・総合点
│   └── shared/    Result / Score / Sen / MetricScore / ドメインエラー
├── usecase/       アプリケーションサービス（1ユースケース = 1関数）
├── infra/d1/      Drizzle スキーマとリポジトリ実装（D1 を知るのはここだけ）
├── handler/       Hono ルート・DTO・zod スキーマ
├── index.ts       Worker エントリ（DI の組み立て）
└── lib/           移行ブリッジ（@deprecated）。新しいコードを書かない
frontend/          React + Vite + Recharts
db/migrations/     Drizzle が生成する SQL
tests/             tests/integration は実 workerd + D1 で走る
docs/              仕様の正
reference/         旧実装のスナップショット（参照専用）
```

依存の向きは `eslint.config.mjs` の `no-restricted-imports` が機械的に強制する。
`src/domain` から `hono` を import すると `npm run lint` が落ちる。

## ドキュメントの読み順

1. [docs/00_overview/system-architecture.md](./docs/00_overview/system-architecture.md) — 全体構成と技術スタック
2. [docs/domain-model.md](./docs/domain-model.md) — レイヤ・集約・判定の流れ
3. [docs/glossary.md](./docs/glossary.md) — ユビキタス言語（**型名・関数名の正**）
4. [docs/01_requirements/scoring-requirements.md](./docs/01_requirements/scoring-requirements.md) — **スコアの唯一の正**
5. [docs/adr/](./docs/adr/) — 技術選定と設計判断の記録
6. [docs/03_tasks/current-sprint.md](./docs/03_tasks/current-sprint.md) — 今やっていること

## 開発コマンド

| 目的                             | コマンド              |
| -------------------------------- | --------------------- |
| 開発（SPA ビルド＋Worker）       | `npm run dev`         |
| 開発（フロントのみ・HMR）        | `npm run dev:web`     |
| 開発（Worker のみ）              | `npm run dev:worker`  |
| テスト                           | `npm test`            |
| 型チェック                       | `npm run typecheck`   |
| Lint                             | `npm run lint`        |
| 整形                             | `npm run format`      |
| ビルド                           | `npm run build`       |
| マイグレーション生成             | `npm run db:generate` |
| マイグレーション適用（ローカル） | `npm run db:migrate`  |
| バインディング型の再生成         | `npm run cf-typegen`  |
| デプロイ                         | `npm run deploy`      |

## 免責

本アプリケーションは株式情報の分析・可視化を目的としたものであり、
投資助言・投資勧誘を行うものではない。投資判断は利用者自身の責任で行うこと。
