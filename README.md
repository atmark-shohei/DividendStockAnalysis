# DividendStockAnalysis

日本株の高配当銘柄を分析・比較し、ウォッチリストとして管理する Web アプリケーション。

> 🚧 **開発初期段階** — 現在はディレクトリ構成と仕様の器のみ。実装は未着手。

## セットアップ

```bash
npm install
npm run dev
```

## フォルダ構成

```
DividendStockAnalysis/
├── CLAUDE.md               Claude Code への全体指示書
├── .claude/                Claude Code の設定・拡張
│   ├── rules/              モジュール別の詳細ルール（コンテキスト節約用）
│   │   ├── frontend.md
│   │   └── backend.md
│   └── settings.json       プロジェクト共有の権限設定
├── .claudeignore           Claude に読ませないファイル（トークン節約）
├── docs/                   仕様書・設計メモ（仕様の正）
│   ├── 00_overview/        全体概要・基本方針
│   ├── 01_requirements/    要件定義
│   ├── 02_design/          詳細設計（DB / API / UI）
│   └── 03_tasks/           実装タスク
├── src/
│   ├── app/                ページルーティング（App Router）
│   ├── components/         再利用可能な UI コンポーネント
│   ├── lib/                ドメインロジック・API 処理・DB 接続
│   └── types/              共有の型定義
├── tests/                  テストコード
└── package.json
```

## ドキュメントの読み順

初めてこのプロジェクトに触れる場合:

1. `docs/00_overview/system-architecture.md` — 全体構成と技術スタック
2. `docs/01_requirements/features.md` — 何を作るのか
3. `docs/02_design/database/schema.md` — データ構造
4. `docs/03_tasks/current-sprint.md` — 今やっていること

## 開発コマンド

| 目的       | コマンド            |
| ---------- | ------------------- |
| 開発サーバ | `npm run dev`       |
| テスト     | `npm test`          |
| 型チェック | `npm run typecheck` |
| Lint       | `npm run lint`      |
| 整形       | `npm run format`    |
| ビルド     | `npm run build`     |

## 免責

本アプリケーションは株式情報の分析・可視化を目的としたものであり、
投資助言・投資勧誘を行うものではない。投資判断は利用者自身の責任で行うこと。
