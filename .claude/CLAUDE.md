# 銘柄スコアリング Web アプリ (TypeScript x Cloudflare)

> ⚠️ **2026-07-28: このファイルは文字化けした原本から再構成した。**
> 原本は Shift_JIS が壊れた状態で保存されており、3888文字中1148文字が
> 置換文字（U+FFFD）になっていて復元できなかった（git 未追跡でバックアップも無し）。
>
> - **見出し構造・識別子・ファイルパス・コマンド・コードブロックは原本のまま**（ASCII は無傷だった）
> - **日本語の説明文は、残った ASCII から意味を読み取って書き直したもの**。原文と細部が違う可能性がある
> - 壊れた原本は git 履歴のコミット `6149440` に残っている（`git show 6149440:.claude/CLAUDE.md`）
>
> あわせて、**その後の決定で内容が変わった箇所には `✅ 訂正` を付けた。**
> 原本の記述をそのまま残すと、既に誤りと判明したルールを再生産するため。

## プロジェクト概要

マスターユーザーが登録した会社データ（1000社以上）を整形（CAGR・平均などの算出）し、
ユーザーごとに設定可能な閾値で10段階にスコアリングして、レーダーチャートで表示する Web アプリ。
入力データ（生値）・整形データは両方保存する。

## 技術スタック

- ランタイム: Cloudflare Workers (シングル Worker 構成)
- API: Hono / バリデーション: zod (handler 境界のみ)
- DB: Cloudflare D1 + Drizzle ORM / マイグレーション: drizzle-kit + wrangler d1 migrations
- フロント: React + TypeScript + Vite + Recharts (Workers Assets で配信)
- 認証: better-auth (マスターユーザー / 一般ユーザー)
  - ✅ **訂正: 未導入。** 認証の要否（T-003 / T-004）が未決のため実装していない。
    [ADR-0005](../docs/adr/0005-thresholds-fixed-for-now.md)
- テスト: Vitest (domain 層は素TS) + @cloudflare/vitest-pool-workers (結線)
- パッケージ管理: pnpm
  - ✅ **訂正: npm。** pnpm はこの環境に未インストール。
    [ADR-0002](../docs/adr/0002-package-manager-npm.md)

## アーキテクチャ (軽量DDD / レイヤード)

```
src/
  domain/          # 素TS。フレームワーク・Cloudflare API・zod を import しない
    company/       # Company集約, FinancialRecord, TransformedMetric, CAGR
    scoring/       # UserScoringPolicy集約, Score, ScoreThreshold, ScoringService
    shared/        # Result型, ドメインエラー類
  usecase/         # アプリケーションサービス (1ユースケース=1関数/クラス)
  infra/
    d1/            # Drizzle schema + リポジトリ実装 (domain の IF を実装)
  handler/         # Hono ルート・DTO・zodスキーマ
  index.ts         # Worker エントリ (DI組み立て)
frontend/          # React + Vite + Recharts
db/migrations/
docs/
  glossary.md      # ユビキタス言語 (必ず先に確認)
  domain-model.md
  adr/
```

## 依存ルール (絶対厳守)

- `src/domain` は外部パッケージを import しない (素TS)。hono / drizzle / zod / cloudflare:\* を
  import したら違反。
- 依存方向: handler -> usecase -> domain <- infra (infra が domain のリポジトリIFを実装)。
- domain 内: scoring は company の TransformedMetric を参照してよい。逆は禁止。
- 集約をまたぐ参照は ID (CompanyId, UserId) で行い、オブジェクトを直接持たない。
- D1/Workers 固有の型 (D1Database 等) は infra と index.ts のみに限る。

> ✅ **これらは `eslint.config.mjs` の `no-restricted-imports` で機械的に強制している**
> （2026-07-28）。規約に書くだけでは守られないため。`src/domain` に `hono` を
> import すると `npm run lint` が落ちる。

## DDD実装規約 (TypeScript)

- 値オブジェクトは branded type + ファクトリ関数で不変条件を守る:

```ts
type Score = number & { readonly __brand: 'Score' }; // 1..10 の整数
function createScore(v: number): Result<Score, DomainError> { ... }
```

> ✅ **訂正: `Score` は 0..10。** `scoring-requirements.md` §0.3 / §0.4 / §0.5 が
> 赤字・無配・表外をいずれも 0点と定めており、0 を作れない型では採点が成立しない。
> [ADR-0003](../docs/adr/0003-metric-score-discriminated-union.md)

- `as Score` のキャストをファクトリ外で書いたら違反。
- エンティティ・集約はクラスで実装し、フィールドは private。状態変更はメソッド経由で
  不変条件を守る。
- リポジトリIFは domain 側に書く: `interface CompanyRepository { ... }`
- ドメインロジックを usecase / handler / frontend に書かない（ハンドラ肥大禁止）。
  計算・判定は必ず domain へ。
- エラーは throw せず `Result<T, E>` で返す。ドメインエラーは判別可能な `kind` を持つ
  (例: `{ kind: 'ThresholdNotAscending' }`)。handler が HTTPステータスに変換する。
- zod は handler の入出力検証のみ。domain の不変条件は domain 自身が守る（二重定義しない）。

## 用語

- `docs/glossary.md` の用語をそのまま型名・関数名に使う。新しい概念が出たら用語集へ追加。
- frontend と共有する型は domain から export し、DTOは handler で定義する。

## ドメイン固有ルール

- Score は 1〜10 の整数。境界値は「閾値以上で次の段階」（>= 判定）。
  - ✅ **訂正: 0〜10 の整数。** 区分の解釈は
    `scoring-requirements.md` §0.1 の**「下限以上・上限未満」**（最上位のみ上が開く）。
- ScoreThreshold は昇順9個の境界値を持つ（10段階を作る）。昇順でなければ生成エラー。
  - ✅ **訂正: 境界値10個で11段階（0〜10点）。** ただし ③ 予想配当性向だけは
    `60〜70% → 2点` に統合したため 10段で、**1点を返す経路が無い**（意図的）。
- UserScoringPolicy はユーザーごと・指標ごとに閾値を上書きできる。未設定はデフォルト閾値に
  フォールバック。
  - ✅ **訂正: 未導入。** 閾値は `src/domain/scoring/bands.ts` の定数に固定。
    導入時は保存前に `validateBands()` を必ず通すこと（穴のある表が黙って `—` を出すため）。
    [ADR-0005](../docs/adr/0005-thresholds-fixed-for-now.md)
- CAGR = (終値/始値)^(1/年数) - 1。始値が0以下・年数0は計算不能エラー
  (NaN/Infinity を流さない)。
  - 📌 補足: **始値・終値の取り方は指標ごとに異なる。** ④ EPS は直近3年と
    5年前から遡る3年の**中央値**を使う。①⑦ は端点。
- FinancialRecord (生値) と TransformedMetric (整形済み) は両方 D1 に保存する。
  整形データは再計算可能だが、再監査目的で計算時点の値と計算バージョンを保存する。
- 一覧・レーダーチャート用の読み取りは usecase で専用クエリ (read model) を使ってよい
  (1000社超のため)。

### 追加（2026-07-28）

- **`null`（判定不能）と 0点は別物。** 個別指標は `null` のまま画面へ渡し、画面は `—` を出す。
  0 に丸めるのは総合点の集計時だけ（§0.5）。この区別は `MetricScore` の判別可能ユニオンで
  **型が保証する**。
- **総合点の分母は常に 100点。** 判定不能は 0点として合算し、**有効指標数を必ず併記**する。
  集計は表示層ではなくドメインサービス（`buildScoreCard`）に置く。
- **金額は銭単位の整数**（`Sen`）。浮動小数点で金額計算をしない。

## コマンド

> ✅ **訂正: pnpm ではなく npm**（[ADR-0002](../docs/adr/0002-package-manager-npm.md)）。
> 実測済みの一覧はルート `CLAUDE.md` にある。

- 開発: `npm run dev` (vite build + wrangler dev) / フロントのみ HMR: `npm run dev:web` (vite)
- テスト: `npm test` (vitest) / ドメインのみ: `npm test -- tests/domain`
- 型チェック・Lint: `npm run typecheck` / `npm run lint`
  (eslint: domain の外部 import 禁止ルールあり)
- マイグレーション生成: `npm run db:generate` (drizzle-kit generate)
  -> 適用: `npm run db:migrate` (wrangler d1 migrations apply DB --local)
- デプロイ: `npm run deploy` (vite build + wrangler deploy)

## 作業手順

1. 新機能はまず domain-modeler agent でモデリング -> `docs/domain-model.md` 更新
2. usecase-add skill の手順で テスト -> domain -> usecase -> infra -> handler -> frontend の順に実装
3. 実装後は ddd-reviewer agent でレビュー、glossary-keeper agent で用語照合
