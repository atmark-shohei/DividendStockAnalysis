# 銘柄・スコアリング API 仕様

> ステータス: 🟢 実装済み（2026-07-28。IRバンク・Yahoo取り込みの契約記載は2026-08-04追加）
> 実装: `src/handler/app.ts` / DTO: `src/handler/dto/company-input.ts`, `src/handler/dto/price-input.ts`,
> `src/handler/dto/irbank-import.ts`, `src/handler/dto/market-data-import.ts`

## 共通仕様

- ベースパス: `/api`
- リクエスト・レスポンスともに JSON
- 金額は**銭単位の整数**で返す。フロント側で表示単位に変換する
- 日時は ISO 8601 の UTC
- バリデーションは zod（handler 境界のみ）。ドメインの不変条件はドメイン自身が守る
- ドメインエラーは handler が HTTP ステータスへ変換する。内部情報（SQL・スタックトレース・パス）は
  返さない（`app.ts` の `onError`）

### エラー形式

```json
{ "error": "<人間向けの説明>" }
```

400 は `zod` の検証失敗時のみ `issues` を追加で含める。

```json
{
  "error": "入力が不正です。項目を確認して再送信してください",
  "issues": [{ "path": "priceSen", "message": "..." }]
}
```

| ステータス | 用途                                                                                |
| ---------- | ----------------------------------------------------------------------------------- |
| 200 / 201  | 成功                                                                                |
| 204        | 削除成功（本文なし）                                                                |
| 400        | 入力形式不正（zod） / 銘柄コード形式不正                                            |
| 404        | 対象なし                                                                            |
| 422        | `GET /api/irbank/:code` 固有。検証を通った決算年度が1件も無かった                   |
| 500        | 想定外のサーバーエラー                                                              |
| 502        | `GET /api/irbank/:code` / `GET /api/market-data/:code` 固有。外部データ源の取得失敗 |

---

## GET /api/health

死活監視用。認証なし。

```json
{ "status": "ok" }
```

---

## POST /api/price/parse

株価入力欄の検証だけを行う。画面が入力中に呼ぶ（保存はしない）。

リクエスト:

```json
{ "raw": "3,250.50" }
```

レスポンス（200）— `PriceInputResult`（判別可能ユニオン）:

```json
{ "kind": "ok", "sen": 325050 }
```

| kind      | 意味                        | 画面での扱い                 |
| --------- | --------------------------- | ---------------------------- |
| `empty`   | 未入力                      | 「株価を入力してください」   |
| `invalid` | 数値として読めない          | 「株価が不正です」           |
| `ok`      | 銭単位の整数（0・負も含む） | 妥当性の判定はスコア側の責務 |

> 全角数字・全角スペース・全角マイナス（U+2212）は正規化してから判定する。
> カンマは3桁区切りとして妥当な位置にあるものだけを許可する
> （`12,3` のような不正な区切りは `invalid` にする。詳細: `price-input.ts`）。

`raw` が文字列でない場合は 400。

---

## GET /api/companies

保存済み銘柄の一覧（要約）。1000社規模を想定し、明細は含めない read model。

```json
{
  "companies": [
    {
      "code": "9433",
      "name": "テスト商事",
      "totalScore": 74,
      "maxTotalScore": 100,
      "effectiveMetricCount": 10,
      "totalMetricCount": 10,
      "fetchedAt": "2026-07-28T00:00:00.000Z"
    }
  ]
}
```

## GET /api/irbank/:code

IRバンクから財務データを取り込む。**保存はしない。**
実装: `src/handler/app.ts` / DTO: `src/handler/dto/irbank-import.ts`

パスパラメータ:

| 項目   | 制約                                                                                                                                 |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| `code` | 4文字固定。先頭3桁は数字、末尾1桁は数字か英大文字（例: `130A`）。形式検証は `importFromIrBank` の先（`IrBankFinancialSource`）が行う |

レスポンス（200）— `IrBankImportResponse`:

```json
{
  "code": "9433",
  "records": [
    {
      "fiscalYear": 2025,
      "isForecast": false,
      "epsSen": 30000,
      "roePercent": 15.2,
      "revenueSen": 500000000000,
      "operatingMarginPercent": 18.5
    }
  ],
  "latestForecastEpsSen": 32000,
  "latestActualEpsSen": 30000,
  "latestActualBpsSen": 133350,
  "dividends": [{ "fiscalYear": 2025, "annualAmountSen": 14500 }],
  "fiscalYearEndMonth": 3,
  "diagnostics": [
    {
      "block": "業績",
      "fiscalYearKey": "2026/03",
      "column": "EPS",
      "reason": "rounded",
      "raw": "300.005"
    }
  ],
  "cellWarnings": [
    {
      "fiscalYear": 2026,
      "fiscalYearKey": "2026/03",
      "field": "epsYen",
      "column": "EPS",
      "reason": "rounded",
      "valueKept": true,
      "raw": "300.005"
    }
  ]
}
```

> ✅ **2026-08-03 追加。** `records[]` に1株配当は無い（[ADR-0009](../../adr/0009-dividend-single-source.md)）。
> 1株配当は `dividends[]` から取る。`fiscalYearEndMonth` は Yahoo 取り込み
> （`GET /api/market-data/:code`）へフロントがそのままクエリで渡す想定（設計書 §8-4）。
> 決算年度キーの月がちょうど1つに定まらない場合（0個または決算期変更の疑いで2個以上）は `null`。
> `diagnostics` は捨てずに残す生の取得診断、`cellWarnings` は取り込んだ時点で
> handler 側が画面のセルに解決したもの（`docs/02_design/logic/import-review.md` §3.2）。

エラー:

| ステータス | `kind`                                                                             | 意味                                                                                                              |
| ---------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| 400        | `invalid-code`                                                                     | 銘柄コードの形式が不正                                                                                            |
| 404        | `source-not-found`                                                                 | 指定された銘柄のデータが見つからない                                                                              |
| 422        | `no-usable-year`                                                                   | 検証を通った決算年度が1件も無かった                                                                               |
| 502        | `source-unreachable` / `malformed-response` / `unexpected-shape` / `code-mismatch` | IRバンクからのデータ取得に失敗（文言:「IRバンクからのデータ取得に失敗しました。時間をおいて再試行してください」） |

---

## GET /api/market-data/:code

Yahoo Finance から株価・配当履歴・株式分割イベントを取り込む。**保存はしない。**
実装: `src/handler/app.ts` / DTO: `src/handler/dto/market-data-import.ts`

パスパラメータ:

| 項目   | 制約                                                            |
| ------ | --------------------------------------------------------------- |
| `code` | 4文字固定。先頭3桁は数字、末尾1桁は数字か英大文字（例: `130A`） |

クエリパラメータ:

| 項目                 | 制約                                                                                                                                                                    |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fiscalYearEndMonth` | 任意。1〜12 の整数。未指定なら配当の年度集計をせず、株価・分割イベントだけ返す。`GET /api/irbank/:code` が返した `fiscalYearEndMonth` をそのまま渡す想定（設計書 §8-4） |

レスポンス（200）— `MarketDataImportResponse`:

```json
{
  "code": "9433",
  "name": "KDDI CORP",
  "priceSen": 425000,
  "priceAsOf": "2026-08-01T06:00:00.000Z",
  "splits": [{ "date": "2020-09-29", "numerator": 3, "denominator": 1 }],
  "dividendRecords": [{ "fiscalYear": 2025, "annualAmountSen": 14500 }],
  "dividendAggregated": true,
  "diagnostics": [],
  "dividendDiagnostics": []
}
```

| フィールド            | 意味                                                                                     |
| --------------------- | ---------------------------------------------------------------------------------------- |
| `name`                | **英語表記のみ。** 取れなければ `null`（画面側の表示制御はFEの責務）                     |
| `priceSen`            | 銭単位の整数。取れなければ `null`                                                        |
| `priceAsOf`           | 株価の観測時刻。UTC の ISO 8601。取れなければ `null`。JST 変換は表示層で行う             |
| `splits`              | 株式分割・併合イベント。参考情報。**この機能では自動反映・スコアリングへの利用はしない** |
| `dividendRecords`     | 決算年度に集計した配当。`dividendAggregated: false` のときは常に空配列                   |
| `dividendAggregated`  | 配当の年度集計を実行したか。`fiscalYearEndMonth` クエリが未指定のときは `false`          |
| `diagnostics`         | 取得時のパース診断。**捨てない**                                                         |
| `dividendDiagnostics` | 配当の年度集計時の診断（丸め・安全整数超過）。**捨てない**                               |

エラー:

| ステータス | `kind`                                                           | 意味                                                                                              |
| ---------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| 400        | `invalid-code`                                                   | 銘柄コードの形式が不正                                                                            |
| 400        | `invalid-fiscal-year-end-month`                                  | `fiscalYearEndMonth` の指定が不正（zod で1〜12に絞るため通常は届かない防御的分岐）                |
| 404        | `source-not-found`                                               | 指定された銘柄のデータが見つからない                                                              |
| 502        | `source-unreachable` / `malformed-response` / `unexpected-shape` | 市場データの取得に失敗（文言:「市場データの取得に失敗しました。時間をおいて再試行してください」） |

---

## POST /api/companies

会社の生データを受け取り、採点して保存する。

リクエストボディ（`analyzeCompanyRequest`。抜粋。全項目は `company-input.ts` 参照）:

> ✅ **2026-07-31 訂正。** `records[]` に 1株配当は無い。1株配当は
> `dividends[]` にのみ載せる（[ADR-0009](../../adr/0009-dividend-single-source.md)）。

```json
{
  "code": "9433",
  "name": "KDDI",
  "records": [
    {
      "fiscalYear": 2025,
      "isForecast": false,
      "epsSen": 30000,
      "roePercent": 15.2,
      "revenueSen": 500000000000,
      "operatingMarginPercent": 18.5
    }
  ],
  "dividends": [{ "fiscalYear": 2025, "kind": "actual", "annualAmountSen": 14500 }],
  "balanceSheet": {
    "currentAssetsSen": null,
    "investmentSecuritiesSen": null,
    "totalLiabilitiesSen": null,
    "previousDividendTotalSen": null
  },
  "multiples": { "per": 14.2, "pbr": 2.1 },
  "priceSen": 425000
}
```

主なバリデーション（zod。`company-input.ts`）:

| 項目             | 制約                                                            |
| ---------------- | --------------------------------------------------------------- |
| `code`           | 4文字固定。先頭3桁は数字、末尾1桁は数字か英大文字（例: `130A`） |
| `name`           | 1〜100文字                                                      |
| `records`        | 最大60件                                                        |
| `dividends`      | 最大60件                                                        |
| 金額系フィールド | 整数のみ（安全整数）。小数は弾く                                |
| 比率系フィールド | 有限の実数（`NaN`/`Infinity` は弾く）                           |
| `priceSen`       | `0` 〜 `MAX_PRICE_SEN`（1株1,000,000円相当）                    |

`records`/`dividends` は受信後に年度**降順**へ並べ替えてからドメインへ渡す
（並べ替えは handler の責務。ドメインは「降順で来る」ことを前提にしてよい）。

レスポンス（201）— `ScoringResponse`:

```json
{
  "totalScore": 74,
  "maxTotalScore": 100,
  "effectiveMetricCount": 10,
  "totalMetricCount": 10,
  "dividendSource": "forecast",
  "fetchedAt": "2026-07-28T00:00:00.000Z",
  "metrics": [
    {
      "key": "dividendGrowthRate",
      "number": 1,
      "label": "直近5年間の増配率",
      "unit": "%",
      "score": 5,
      "value": 8.3,
      "unavailableReason": null
    }
  ]
}
```

> **判定不能な指標は `score`/`value` が `null` になり、`unavailableReason` に理由コードが入る。**
> `0` を返すことはない（`.claude/rules/frontend.md`「データが無い場合に0を表示しない」）。

400: zod 検証失敗。

## GET /api/companies/:code

保存済み銘柄を**生データから再採点**して返す（`ScoringResponse`。形は POST と同じ）。

保存済みの `score_cards`/`transformed_metrics` をそのまま返さないのは、ロジックを直したあとに
古い整形データを見せると画面と実装が食い違うため（`usecase/read-companies.ts`）。

- 400: 銘柄コードの形式不正
- 404: 該当コードなし

## DELETE /api/companies/:code

- 204: 削除成功
- 400: 銘柄コードの形式不正

削除の冪等性（未登録コードに対する挙動）は未確認。次に触るときに検証すること。

---

## この API に無いもの（意図的）

- **ウォッチリスト** — 要件に対応する機能が無い。`user-api.md`（旧draft）にあった案は不採用
- **スクリーニング・フィルタ・ページング** — `GET /api/companies` は現状ページングなし。
  1000社規模での応答時間は未検証（§ 移行計画 残課題）
- **認証** — 未決（T-003/T-004）。全エンドポイントが誰からでも呼べる前提

## 関連ドキュメント

- [scoring-requirements.md](../../01_requirements/scoring-requirements.md) — 10指標の定義
- [schema.md](../database/schema.md) — 永続化先のテーブル定義
- [domain-model.md](../../domain-model.md) — ドメインモデル全体
