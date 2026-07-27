---
name: usecase-add
description: 新しいユースケース (API/画面機能) を追加する定型フロー。テスト->domain->usecase->infra->handler->frontend を順番に実装。
---

# ユースケース追加フロー

必ずこの順序で実装する。順序を飛ばさない（レイヤー逆流を防ぐため）。

## 0. モデル確認

- `docs/domain-model.md` に該当モデルがあるか確認。なければ先に domain-modeler agent を起動
- 更新する集約が1つであることを確認（複数なら設計を見直す）

## 1. ドメインテスト (RED)

- 不変条件・境界値のテストを `src/domain/**/*.test.ts` に先に書く（test-writer agent 利用可）
- `pnpm vitest run src/domain` で失敗することを確認

## 2. ドメイン実装 (GREEN)

- 値オブジェクト・集約メソッド・ドメインサービスを実装。外部 import 禁止
- テストが通ることを確認

## 3. ユースケース実装

- `src/usecase/` に追加。リポジトリIF経由でのみ永続化に触れる
- 流れ: 入力 -> 集約取得 -> 集約メソッド呼び出し -> 保存 -> 出力。判定ロジックを書いたら違反
- 一覧・チャート用の参照系は read model (専用クエリIF) を定義してよい

## 4. インフラ実装

- drizzle schema 更新 -> `pnpm drizzle-kit generate` -> マイグレーション確認
- リポジトリ実装を `src/infra/d1/` に追加 (toSnapshot/reconstruct 経由で変換)
- `wrangler d1 migrations apply DB --local` でローカル適用

## 5. ハンドラ実装

- zod スキーマ + Hono ルートを `src/handler/` に追加
- ドメインエラー kind -> HTTP ステータスのマッピングを追加
- `index.ts` に DI 組み立てを追加

## 6. フロントエンド

- API クライアント -> 画面実装。計算・判定はしない（表示整形のみ）
- レーダーチャートは Recharts の `<RadarChart>` を使用

## 7. 検証

- `pnpm test && pnpm typecheck && pnpm lint`
