# ADR-0008: フロントエンドから domain のランタイムコードを直接 import してよい範囲

- ステータス: ✅ 採用
- 日付: 2026-07-29
- 関連: [ADR-0007](./0007-irbank-json-direct-fetch.md)、
  [irbank-json-import.md](../02_design/logic/irbank-json-import.md) §3.5、
  `/review-spec` によるレビュー（2026-07-28）

## 背景

IRバンク取り込み（ADR-0007）で PER/PBR を「株価 ÷ EPS/BPS」から算出する
`deriveMarketMultiples()` を `src/domain/company/market-multiples.ts` に置き、
`frontend/components/CompanyForm.tsx` がこれを**値として import**して
その場で呼んでいる。

これは**このプロジェクトで初めての前例**である。従来 `frontend/api.ts` や
`App.tsx` が `@/domain/...` から import しているのは型だけ
（`import type { CompanySummary } from '@/domain/company/company-repository'`）で、
domain のランタイムコードを実際に実行するのは常にサーバー側（Worker）だった。

`/review-spec` のレビューで、この前例が ADR 無しに作られたことを指摘された。
`eslint.config.mjs` の `no-restricted-imports` は「domain が何を import するか」
だけを縛る仕組みで、「frontend が domain の**どのモジュール**を実行時に呼んで
よいか」は機械的に制約されていない。次に誰かが `src/domain/scoring/` の
採点ロジックをフロントから呼んでも、lint は止めてくれない。

もう1点、レビューで指摘された論点: PER/PBR をクライアントで算出して
そのまま `POST /api/companies` すると、保存後は「IRバンク取り込みからの
近似値」か「ユーザーが直接入力した値」かを区別できない。⑩ 配当利回りが
「予想/実績のどちらを採用したか」を必ず結果に保持して画面へ返す
（`dividend-yield-scoring.md` §3.1）のと同じ透明性の要求が、本来 PER/PBR にも
及ぶはずだった。

## 決定

**frontend は `src/domain/company/` 配下の純粋関数に限り、ランタイムで
直接 import してよい。** ただし次の条件をすべて満たすものに限る。

1. **副作用が無い。** ネットワーク・タイマー・グローバル状態を持たない
2. **フレームワーク非依存。** `domain` 全体の制約（`no-restricted-imports` の
   `FORBIDDEN_IN_DOMAIN`）がそのまま frontend 実行時の安全性も保証する
3. **`src/domain/scoring/` は対象外。** 採点判定（区分表・スコア算出）は
   常にサーバー側で行う。フロントが呼んでよいのは `src/domain/company/` の
   「生の事実を導出する」関数（例: `deriveMarketMultiples`）に限る。
   採点は「サーバーが1回だけ計算して返す」という現行の一貫した設計
   （`docs/00_overview/data-flow.md` §2「詳細は保存済みの生データから毎回再採点」）
   を崩さないため

**PER/PBR が「近似値」であることの UI 上の明示は 2026-07-29 に実施した。**
下記「未解決のまま残すこと」を参照（解消済みに更新）。

## 検討した代替案

- **案A: サーバー往復にする**（`POST /api/irbank/:code/multiples?priceSen=...`
  のような専用エンドポイントを増やす） — 却下。EPS/BPS は既に取り込み時の
  レスポンスにあり、単純な除算のためだけに毎回ネットワーク往復させるのは
  無駄。オフライン編集中の応答性も落ちる
- **案B: frontend に同じ計算をベタ書きする** — 却下。
  「計算・判定は必ず domain へ」（`.claude/CLAUDE.md`）に反し、
  ゼロ除算・負値のガードがフロントとサーバーで二重定義・不一致する
  リスクを持つ
- **案C: 何も制約を書かず前例のままにする** — 却下。レビューの指摘どおり、
  次に誰かが `domain/scoring/` を同じ調子でフロントから呼んでも
  誰も止められない。最低限の allowlist を明文化する必要がある

## 結果・影響

- `src/domain/company/` に新しい純粋関数を追加するときは、
  「frontend から実行時に呼ばれる可能性がある」ことを前提に書く
  （例外・null 処理を frontend 側の入力揺れに対しても頑健にする）
- `src/domain/scoring/` に同種の関数を追加しても、frontend からは呼ばない。
  呼びたくなったら、まずこの ADR を改訂する
- eslint では検出できない。**この ADR に沿っているかはレビュー時に
  目視で確認する**（自動検出ルールは将来の課題）

## 未解決のまま残すこと（2026-07-29 更新: 全項目解消）

**✅ 2026-07-29 決着。** ユーザーと相談のうえ、次の3点を決定・実装した。

1. **PER は予想EPSを優先する。** 実績EPSで代用するのは業績ブロックに
   予想行が無い銘柄だけ（`market-multiples.ts` の `deriveMarketMultiples`）。
   PBR は元々「実績」定義であり、BPS に予想の区別が無いため据え置き
2. **PBR を BPS の年度別データとして正式管理する対応は見送り。**
   BPS は依然として最新実績1件（`ImportedFinancials.latestActualBpsSen`）を
   使い捨てるだけで、`financial_records` には保存しない。理由: PBR は既に
   定義どおり「実績」を使えており、①の非対称性ほど緊急度が高くない
3. **出所を追跡することにした。** `MarketMultiples` に `perSource` /
   `pbrSource`（`PerSource` / `PbrSource`）を追加し、`companies` テーブルに
   `per_source` / `pbr_source` カラムを追加（`db/migrations/0001_foamy_layla_miller.sql`）。
   ⑩ の `dividendSource` と同じ発想で、`ScoringResponse` にも
   `perSource`/`pbrSource` を追加し、`ListPage.tsx` で画面に表示する

検討したが採用しなかった選択肢: Yahoo Finance（`yfinance` が内部で使う
`query1.finance.yahoo.com`）からPER/PBRを直接取得する案。Cookie＋Crumb方式の
認証が必要でステートフルな上に不安定（yfinance 自体のリポジトリに crumb 関連の
不具合報告が継続的にある）と分かり、Cloudflare Worker（ステートレス）との
相性が悪いため見送った。IRバンクの静的JSON1回GETと比べて複雑さが桁違いに
大きく、ADR-0007 がまさに避けようとした「不安定な外部API依存」そのものだった。
