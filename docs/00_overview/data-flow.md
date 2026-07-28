# データフロー

> ステータス: 🟢 実装済み（2026-07-28）
>
> ⚠️ **全面書き直し。** 旧版は「外部データ源からの自動取得（`src/lib/external/*Client`）」
> 「Server Component」「ウォッチリスト」を前提にしていたが、実装はそのいずれでもない。
> **データは常にユーザーが手入力する**（TSV/CSV 貼り付けは未実装。F-01〜F-04、§ 移行計画残課題）。
> フロントは Next.js の Server Component ではなく **React + Vite の SPA**
> （Hono が API と静的アセットの両方を1 Worker で配信する。[ADR-0001](../adr/0001-runtime-cloudflare-workers.md)）。
> ウォッチリストは実装計画に無い（[company-api.md](../02_design/api/company-api.md)「この API に無いもの」）。

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

- 外部データ源への自動アクセスは無い。**レート制限・リトライの設計は不要**（旧版の想定は削除）
- `fetchedAt` はサーバー側の現在時刻（`dependencies.now()`）を使う。クライアントの時計は信用しない
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

| データ           | 更新のタイミング                          | 表示                                                              |
| ---------------- | ----------------------------------------- | ----------------------------------------------------------------- |
| 財務・配当データ | ユーザーが `POST /api/companies` するたび | `fetchedAt` を必ず併記（画面のどこに出すかは F-31/F-32 側の課題） |
| 株価             | 同上（`priceSen` は現在値1件のみ保持）    | 同上                                                              |

自動更新・自動取得が無いため、「古いデータを最新として表示しない」（`CLAUDE.md`）は
**「入力日時を必ず見せる」という形でのみ**成立する。定期バッチや鮮度警告（一定時間超過での
アラート）は現状無い。TSV/CSV 取り込み（F-01〜F-04）が入っても、取得元は依然として
ユーザーが貼り付けた静的なテキストであり、自動取得ではない。
