# データフロー

> ステータス: 🟢 実装済み（2026-07-28。IRバンク取り込みを追記）
>
> ⚠️ **全面書き直し。** 旧版は「外部データ源からの自動取得（`src/lib/external/*Client`）」
> 「Server Component」「ウォッチリスト」を前提にしていたが、実装はそのいずれでもない。
> フロントは Next.js の Server Component ではなく **React + Vite の SPA**
> （Hono が API と静的アセットの両方を1 Worker で配信する。[ADR-0001](../adr/0001-runtime-cloudflare-workers.md)）。
> ウォッチリストは実装計画に無い（[company-api.md](../02_design/api/company-api.md)「この API に無いもの」）。
>
> ✅ **2026-07-28 訂正: 「データは常にユーザーが手入力する」は部分的に古い。**
> IRバンクの静的 JSON を銘柄コード指定で取り込む経路が入った
> （[ADR-0007](../adr/0007-irbank-json-direct-fetch.md)、§0）。ただし
> **これは入力フォームの下書きを埋めるだけの任意機能**であり、保存フロー
> そのもの（§1）は今も「フォームに入っている値をそのまま検証・保存する」
> だけで、外部アクセスを行わない。TSV/CSV 貼り付け（F-01〜F-04）は
> 別経路として未実装のまま（§ 移行計画残課題）。

## 0. 銘柄コードからの下書き取り込み（任意）

```
[ユーザー]
   │  銘柄コードを入力し「IRバンクから取り込む」を押す
   ▼
[frontend/components/CompanyForm.tsx]
   │  ① 銘柄コードの形式検証（失敗 → 送信せずエラー表示）
   ▼
[frontend/api.ts]  fetch GET /api/irbank/:code
   ▼
[src/handler/app.ts]
   ▼
[src/usecase/import-from-irbank.ts]  importFromIrBank()
   ▼
[src/infra/irbank/fy-data-client.ts]  IrBankFinancialSource.fetchByCode()
   │  ② タイムアウト5秒・リトライ1回だけ（`.claude/rules/backend.md`）
   ▼
 [f.irbank.net]（外部）
   │  ③ 正規化・検証（`src/infra/irbank/parse-fy-data.ts`）
   │     欠損・型の揺れ・年度の突き合わせ。詳細は
   │     [irbank-json-import.md](../02_design/logic/irbank-json-import.md)
   ▼
[frontend/components/CompanyForm.tsx]
   │  ④ 年度別データ・PER/PBR（株価が入力済みなら）を**フォームの下書きとして**差し込む
   │     **ここでは何も保存しない。** 保存は §1 のとおりユーザーが送信して初めて起きる
   ▼
（ユーザーが確認・補完してから §1 の「解析して保存」へ）
```

- **保存されない。** この経路は D1 にもリポジトリにも触らない。取り込んだ値は
  ブラウザの React state（下書き）に留まり、ユーザーが送信するまで確定しない
- **①②④⑦ など、この経路で埋まらない年度は残る。** 既定の空行を消さず、
  取り込めた年度だけを差し込む（[irbank-json-import.md §6](../02_design/logic/irbank-json-import.md)）
- レート制限・リトライは**この経路にだけ**存在する設計。§1（保存フロー）には無い

## 1. 銘柄データの入力・保存

```
[ユーザー]
   │  IR サイト等を見ながら年度別の数値を手入力
   ▼
[frontend/components/CompanyForm.tsx]
   │  ① 画面側の検証（全角→半角正規化、銘柄コード形式、範囲）
   │     失敗 → 送信せずエラー表示（`.claude/rules/frontend.md`）
   ▼
[frontend/api.ts]  fetch POST /api/companies
   ▼
[src/handler/app.ts]
   │  ② zod 検証（`company-input.ts` の `analyzeCompanyRequest`）
   │     失敗 → 400 + issues
   │  ③ 年度降順に並べ替え（`toCompany()`）。以降の層は「降順で来る」前提でよい
   ▼
[src/usecase/analyze-company.ts]  analyzeCompany()
   ▼
[src/usecase/score-company.ts]  scoreCompany()
   │  ④ ドメイン層で10指標を採点（`src/domain/scoring/`）
   │     判定不能は `null` のまま（0 に丸めない。§0.5）
   ▼
[src/infra/d1/company-repository.ts]  D1CompanyRepository.save()
   │  ⑤ 生データ（financial_records/dividend_records）と
   │     整形データ（score_cards/transformed_metrics）を**両方**保存
   ▼
 [Cloudflare D1]
```

- **この保存フロー自体は外部にアクセスしない。** フォームに入っている値を
  そのまま検証・保存するだけ（§0 の取り込みを使ったかどうかを区別しない）
- `fetchedAt` はサーバー側の現在時刻（`dependencies.now()`）を使う。クライアントの時計は信用しない。
  **§0 で IRバンクから取り込んだ場合でも、`fetchedAt` は「取り込んだ時刻」ではなく
  「この POST を送信した時刻」。** 取り込んでから確認・修正して送信するまでの間が
  空くことがあるため、両者は別物として扱う
- 自然キー（`company_code` + `fiscal_year` + 区分）を PK にして、同一入力の再送信は上書きになる
  （二重取り込みの防止は「拒否」ではなく「上書き」。バージョン管理はしない）

## 2. 画面表示（一覧・詳細）

```
[ブラウザ]
   │  マウント時 / 保存直後に再取得
   ▼
[frontend/api.ts]  fetch GET /api/companies または /api/companies/:code
   ▼
[src/handler/app.ts]
   ▼
[src/usecase/read-companies.ts]
   │  listCompanies()    → 一覧は要約のみ（read model。N+1 を作らない）
   │  getCompanyScoring() → 詳細は**保存済みの生データから毎回再採点**
   │                        （ロジックを直したあとに古い整形データを見せないため）
   ▼
[src/handler/dto/company-input.ts]  toScoringResponse()
   │  丸めない。判定不能は `null` のまま返す
   ▼
[frontend/App.tsx]  state に格納
   ▼
[frontend/components/{ScoreRadar,MetricTable}.tsx]
   props を受け取って描画するだけ（データ取得しない。`.claude/rules/frontend.md`）
```

- 現在の画面は**単一ページ**（ルーティング無し）。「データ入力」「解析結果」「保存済み銘柄」を
  縦に並べただけで、タブ切り替えも URL 遷移も無い（詳細: [screen-list.md](../02_design/ui/screen-list.md)）
- 丸め処理は表示層（`frontend/format.ts`）の1箇所だけで行う

## データの鮮度

| データ                   | 更新のタイミング                          | 表示                                                              |
| ------------------------ | ----------------------------------------- | ----------------------------------------------------------------- |
| 財務・配当データ         | ユーザーが `POST /api/companies` するたび | `fetchedAt` を必ず併記（画面のどこに出すかは F-31/F-32 側の課題） |
| 株価                     | 同上（`priceSen` は現在値1件のみ保持）    | 同上                                                              |
| IRバンクの取り込み下書き | §0 のボタンを押すたび（**保存されない**） | 画面上の入力欄が更新されるだけ。専用の表示は無い                  |

**保存済みデータの自動更新・自動取得は無い**ため、「古いデータを最新として表示しない」
（`CLAUDE.md`）は**「入力日時を必ず見せる」という形でのみ**成立する。定期バッチや
鮮度警告（一定時間超過でのアラート）は現状無い。

§0 の IRバンク取り込みは**下書きを埋めるだけで、保存済みデータの鮮度には影響しない**。
取り込んだ値を確認・修正して「解析して保存」を押すまでは何も確定しない。TSV/CSV 取り込み
（F-01〜F-04）は別経路として依然未実装。
