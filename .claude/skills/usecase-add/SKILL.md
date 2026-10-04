---
name: usecase-add
description: 新しいユースケース (API/画面機能) を追加する定型フロー。テスト->domain->usecase->infra->handler->frontend を順番に実装。
---

# ユースケース追加フロー

必ずこの順序で実装する。順序を飛ばさない（レイヤー逆流を防ぐため）。

> 規約の正本は `ai/rules/be/coding-standards.md` / `ai/rules/be/test-patterns.md`、
> パスとコマンドは `.claude/rules/path-conventions.md`。本ファイルは実装順序だけを定める。

## 0. モデル確認

- `docs/domain-model.md` に該当モデルがあるか確認。なければ先に domain-modeler agent を起動
- 更新する集約が1つであることを確認（複数なら設計を見直す）

## 1. ドメインテスト (RED)

- 不変条件・境界値のテストを `tests/domain/**/*.test.ts` に先に書く（test-writer agent 利用可）。
  **`src/` に colocate しない。`tests/` へ src と同じ構造でミラーする**
- domain のテストは unit 系統（`vitest.unit.config.ts`）。workers 系統に置かない
- `npm test -- tests/domain` で失敗することを確認

## 2. ドメイン実装 (GREEN)

- 値オブジェクト・集約メソッド・ドメインサービスを実装。外部 import 禁止
  （`eslint.config.mjs` の `no-restricted-imports` で機械的に落ちる）
- エラーは throw せず `Result<T, E>` を返す。branded type は `createSen()` / `createScore()` 経由で作る
- `npm test -- tests/domain` が通ることを確認

## 3. ユースケース実装

- `src/usecase/` に追加。リポジトリIF経由でのみ永続化に触れる
- 流れ: 入力 -> 集約取得 -> 集約メソッド呼び出し -> 保存 -> 出力。判定ロジックを書いたら違反
- 一覧・チャート用の参照系は read model (専用クエリIF) を定義してよい

## 4. インフラ実装

- drizzle schema 更新 -> `npm run db:generate` -> `db/migrations/` の生成物を確認
  （**手で ALTER を書かない**）
- リポジトリ実装を `src/infra/d1/` に追加 (toSnapshot/reconstruct 経由で変換)
- `npm run db:migrate` でローカル D1 に適用。**`npm run db:migrate:remote` は実行しない**（本番反映はユーザーの判断）
- infra のテストは workers 系統（`vitest.workers.config.ts`）に置く

## 5. ハンドラ実装

- zod スキーマ + Hono ルートを `src/handler/` に追加
- ドメインエラー kind -> HTTP ステータスのマッピングを追加
- `index.ts` に DI 組み立てを追加

## 6. フロントエンド

- API クライアント -> 画面実装。計算・判定はしない（表示整形のみ）
- レーダーチャートは Recharts の `<RadarChart>` を使用
- **判定不可（`null`）を 0 と表示しない。** `—` か「データなし」を出す（`ai/rules/fe/coding-standards.md` §2）

## 7. 検証

以下を**1コマンドずつ**実行する（PowerShell では `&&` が使えない）。

```
npm test
npm run typecheck
npm run lint
```

3つすべて全パスで完了。推測で「完了」と言わない。失敗したら出力付きで報告する。
