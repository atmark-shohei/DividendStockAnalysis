# 銘柄・スコアリング API 仕様

> ステータス: 🟢 既存部分は実装済み（2026-07-28）／🟢 `GET /api/companies` の検索・ソート・
> サーバサイドページングは実装済み（T-093, 2026-08-18）／🟢 `GET /api/companies/:code/dividends`
> （配当年次履歴）は実装済み（T-097, 2026-08-20）
> 実装: `src/handler/app.ts` / DTO: `src/handler/dto/company-input.ts`, `src/handler/dto/price-input.ts`,
> `src/handler/dto/irbank-import.ts`, `src/handler/dto/market-data-import.ts`,
> `src/handler/dto/edinet-import.ts`, `src/handler/dto/company-list-query.ts`
>
> 管理用の `POST /api/admin/edinet/index/refresh`（docIDインデックスのバックフィル）は
> **この文書では未記載**。別タスクで起こす。

## 変更履歴

- **2026-08-20**（T-097）: `GET /api/companies/:code/dividends`（配当年次履歴）を実装。
  `src/handler/app.ts` に `GET /api/companies/:code` の直後のルートとして追加した（無認証）。
  `dividends[]` は年度昇順で返り、`amountSen: null` の年度も除外せず含める
  （データ欠損を「行が無い」ではなく `null` で表現する）。同一年度に複数区分がある場合は
  `actual` > `revised` > `forecast` の優先順位で1件を採用し、この優先順位判定は
  `amountSen` の値の有無では分岐しない（`actual` が `null` でも `actual` を採用する）。
  上記「GET /api/companies/:code/dividends」節の 🟡（設計のみ・未実装）表記を 🟢（実装済み）
  に更新した。
- **2026-08-20**（T-096 着手前のブロッカー解消）: `ScoringResponse` に `priceSen`/`per`/`pbr`
  （数値）を実装。下記の 2026-08-17・2026-08-18 の記載は**設計のみで実装が伴っておらず**、
  「実装済み」という記述が誤りだった（`src/usecase/score-company.ts` の `CompanyScoring`、
  `src/handler/dto/company-input.ts` の `ScoringResponse`/`toScoringResponse()` に該当
  フィールドが存在しなかった）。本タスクでこの2ファイルへ配線を追加し、記載どおりの実装に
  追いついた。値は `Company.priceSen`/`Company.multiples.per`/`Company.multiples.pbr`
  （既に D1 に永続化済み）をそのまま転記するのみで、計算式・閾値の変更は無いため
  `SCORING_CALC_VERSION` は上げていない。一覧（`GET /api/companies`・`CompanySummary`）
  への `per`/`pbr` 追加は本タスクのスコープ外（設計書に記載が無く、指示にも含まれない）。
- **2026-08-18**（T-093）: `GET /api/companies` の検索・ソート・サーバサイドページングを実装。
  `q`/`sort`/`page`/`perPage` は不正値・未知値でも 400 にせず既定値へ丸める（zod `.catch()`）。
  `companies` × `score_cards` × `transformed_metrics`（`metric_key` 条件付き別名JOIN2本）を
  1クエリの JOIN で取得し、`total` は別の `COUNT(*)` クエリ（計2クエリ）で求める。
  `CompanySummary` に `priceSen`/`dividendYieldValue`/`payoutRatioValue` を追加。
  **`GET /api/companies/:code/dividends`（配当年次履歴）は本タスクのスコープ外**（Manager確認済み。
  BE計画 §0・§6-1）。~~`ScoringResponse` への `priceSen`/`per`/`pbr` 追加は既に実装済み
  （`GET /api/companies/:code` の応答。下記 §GET /api/companies/:code 参照）。~~
  → ✅ 訂正（2026-08-20）: この時点では未実装だった。実装は上記 2026-08-20 のエントリを参照。
- **2026-08-17**（T-077）: `GET /api/companies` に検索・ソート・サーバサイドページングを追加。
  ~~`ScoringResponse` に `priceSen`/`per`/`pbr`（数値）を追加。~~
  → ✅ 訂正（2026-08-20）: このエントリは設計追加の記録であり、実装は伴っていなかった。
  実装は上記 2026-08-20 のエントリを参照。
  `GET /api/companies/:code/dividends`（配当年次履歴）を新規追加。
  [search-page.md](../ui/pages/search-page.md)・[analysis-dialog.md](../ui/pages/analysis-dialog.md)
  が要求していた項目（§データ取得（API要件））に対応

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

| ステータス | 用途                                                                                                          |
| ---------- | ------------------------------------------------------------------------------------------------------------- |
| 200 / 201  | 成功                                                                                                          |
| 204        | 削除成功（本文なし）                                                                                          |
| 400        | 入力形式不正（zod） / 銘柄コード形式不正                                                                      |
| 404        | 対象なし                                                                                                      |
| 422        | `GET /api/irbank/:code` 固有。検証を通った決算年度が1件も無かった                                             |
| 500        | 想定外のサーバーエラー                                                                                        |
| 502        | `GET /api/irbank/:code` / `GET /api/market-data/:code` / `GET /api/edinet/:code` 固有。外部データ源の取得失敗 |

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

> 🟢 **検索・ソート・ページングは 2026-08-17 設計（T-077）→ 2026-08-18 実装済み（T-093）。**
> [search-page.md](../ui/pages/search-page.md) §2・§8 の要求に対応する。
> 実装: `src/handler/dto/company-list-query.ts`（zod, 既定値丸め込み）,
> `src/domain/company/company-list-query.ts`（`CompanyListQuery`/`CompanySortKey`）,
> `src/infra/d1/company-repository.ts`（`listSummaries()`）。

クエリパラメータ:

| 項目      | 制約                                                                                                                                                                                                   | 既定               |
| :-------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :----------------- |
| `q`       | 任意。銘柄コード・銘柄名の部分一致（大文字小文字を区別しない）                                                                                                                                         | 空（絞り込まない） |
| `sort`    | 任意。`created_desc` / `score_desc` / `score_asc` / `code_asc`。**未知の値は既定に倒す**（400 にしない。`useActualForScoring` 以外の既存クエリと違う扱いだが、検索は誤入力頻度が高いフィールドのため） | `created_desc`     |
| `page`    | 任意。1以上の整数。0以下・非数値は 1 に倒す                                                                                                                                                            | `1`                |
| `perPage` | 任意。1〜100 の整数。範囲外は既定に丸める（`records`/`dividends` の「最大60件」と同様、上限を設ける）                                                                                                  | `15`               |

- `sort=score_desc`/`score_asc` は `score_cards.total_score` でソートする。
  **`companies`・`score_cards` の JOIN 1クエリで行い、クライアント側で並べ替えない**
  （`.claude/rules/backend.md`「一覧取得は1クエリか JOIN で済ませる」）
- `sort=created_desc` は `companies.fetched_at` の降順、`sort=code_asc` は `companies.code` の昇順

> ⚠️ **一覧の総合点は `score_cards`（保存済みスナップショット）、詳細（`GET /api/companies/:code`）
> の総合点は生データからの毎回再採点。この2つは意図的に異なる情報源であり、
> スコアリングロジックを変更した直後は一時的に食い違う**（T-088レビューで指摘。
> 2026-08-17追記）。
>
> - **一覧が毎回全銘柄を再採点しない理由:** `sort=score_desc` はソート後にページングするため、
>   全銘柄の総合点が確定していないとページ N を正しく返せない。1000社規模を毎リクエスト
>   再計算するのは Workers の CPU予算（T-063の実測で判明した制約）に照らして現実的でない
> - **解消される契機:** 対象銘柄が `POST /api/companies` で再解析されると `score_cards` が
>   更新され、一覧側も最新値になる。スコアリングロジックを変更しただけで銘柄を
>   再解析していない間は、一覧＝旧ロジックの値、詳細＝新ロジックの値、という
>   食い違いが残る（`calc_version` で検知は可能だが、検知後の自動再計算は未実装。
>   [schema.md §未実装・検討事項](../database/schema.md) に記録）
> - **これは実装前に解消すべき矛盾ではなく、性能とのトレードオフとして許容する。**
>   ただし [schema.md](../database/schema.md) にも同じ説明を置き、
>   「なぜ2系統あるのか」がどちらの文書からも追える状態にする

レスポンス（200）:

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
      "fetchedAt": "2026-07-28T00:00:00.000Z",
      "priceSen": 425000,
      "dividendYieldValue": 318,
      "payoutRatioValue": 32.4
    }
  ],
  "page": 1,
  "perPage": 15,
  "total": 42
}
```

| 追加フィールド       | 単位                                                                         | `null` の意味 |
| :------------------- | :--------------------------------------------------------------------------- | :------------ |
| `priceSen`           | 銭                                                                           | 株価が未入力  |
| `dividendYieldValue` | **1/100%**（`ScoringResponse.metrics[].value` の ⑩ と同じ表現。500 = 5.00%） | ⑩ が判定不能  |
| `payoutRatioValue`   | %（`ScoringResponse.metrics[].value` の ③ と同じ表現。そのまま% として読む） | ③ が判定不能  |

- `priceSen` は `companies.price_sen`、`dividendYieldValue`/`payoutRatioValue` は
  `transformed_metrics`（`metric_key IN ('dividendYield', 'payoutRatio')`）から取る。
  **`companies` × `score_cards` × `transformed_metrics` を1クエリの JOIN で取得する**
  （N+1 を作らない。`.claude/rules/backend.md`）
- `total` はフィルタ後（`q` 適用後）の総件数。ページング UI の「N / total ページ」計算に使う

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
  "totalLiabilities": { "valueSen": 6450226300000000, "fiscalYear": 2026 },
  "previousDividendTotal": { "valueSen": 30154700000000, "fiscalYear": 2026 },
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
>
> ✅ **2026-08-06 追加。** `totalLiabilities` / `previousDividendTotal` は
> ⑥（配当維持可能年数）用の負債総額・前期末の配当総額（`ImportedAmount | null`）。
> `valueSen` は銭、`fiscalYear` はその値を採った決算年度。算出・取得できなければ
> `null`（**`0`（無借金・無配）と `null`（判定不能）は別物**）。導出規則は
> [balance-sheet-derivation.md](../logic/balance-sheet-derivation.md) が正。

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

## GET /api/edinet/:code

> ステータス: 🟢 実装済み（節の記載は2026-08-09追加。`diagnostics` も同日追加）

金融庁 EDINET の有価証券報告書から、④⑦用の EPS・売上高の履歴（最大6期）と
⑥用の貸借対照表項目（前期末の流動資産・投資有価証券）を取り込む。**保存はしない。**
実装: `src/handler/app.ts` / DTO: `src/handler/dto/edinet-import.ts` /
ロジック: [edinet-history-import.md](../logic/edinet-history-import.md)

docID インデックス（`edinet_document_index`）は日次バッチが事前に構築している前提。
インデックスに該当エントリが無ければ 404（`document-not-found`）を返す。

パスパラメータ:

| 項目   | 制約                                                            |
| ------ | --------------------------------------------------------------- |
| `code` | 4文字固定。先頭3桁は数字、末尾1桁は数字か英大文字（例: `130A`） |

クエリパラメータ: なし。

レスポンス（200）— `EdinetImportResponse`:

```json
{
  "years": [
    {
      "fiscalYear": 2026,
      "epsSen": 18359,
      "revenueSen": 607191500000000,
      "roePercent": 13.93,
      "operatingMarginPercent": 18.1,
      "sourceDocId": "S100YKG2"
    },
    {
      "fiscalYear": 2025,
      "epsSen": 17012,
      "revenueSen": 580123400000000,
      "roePercent": null,
      "operatingMarginPercent": null,
      "sourceDocId": "S100YKG2"
    }
  ],
  "epsHistoryRestated": false,
  "revenueHistoryRestated": false,
  "balanceSheet": {
    "currentAssetsSen": 470650700000000,
    "investmentSecuritiesSen": null,
    "sourceDocId": "S100YKG2"
  },
  "diagnostics": []
}
```

| フィールド                       | 意味                                                                                                                                                     |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `years`                          | 年度降順。最大6件。`epsSen` / `revenueSen` は銭。取れなければ `null`（**無配・0円と `null` は別物**）                                                    |
| `years[].roePercent`             | ⑤用。**%**（自算値）。純利益÷期末自己資本で自算した ROE。**EDINETの公表列ではない**（あちらは期首期末平均基準で最大 1.35pp ずれる）。取れなければ `null` |
| `years[].operatingMarginPercent` | ⑧用。**%**（自算値）。その有報のハイライト表内で導出した営業利益率。書類をまたいで分子・分母を組み合わせない。取れなければ `null`                        |
| `years[].sourceDocId`            | その年度の値をどの有報（docID）から採ったか                                                                                                              |
| `epsHistoryRestated`             | ④用。重複4期の突き合わせで遡及修正が検出されたか。比較できなければ `false`                                                                               |
| `revenueHistoryRestated`         | ⑦用。同上                                                                                                                                                |
| `balanceSheet`                   | ⑥用。前期末時点。取得できなければ `null`。IFRS企業は `investmentSecuritiesSen` が項目単位で `null` になりうる                                            |
| `diagnostics`                    | 取り込めなかった値の記録。**捨てない・丸めない・0件でも空配列でキーを残す**（`GET /api/market-data/:code` と同じ）                                       |

`diagnostics[]` の各要素（`EdinetImportDiagnostic`。domain 型をそのまま公開する）:

| 項目          | 型                                                                                    | 意味                                                                                                                |
| ------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `field`       | `eps` / `revenue` / `currentAssets` / `investmentSecurities` / `netIncome` / `equity` | どの項目の話か。`netIncome`/`equity` は⑤用（ROEは自算値のため、純利益と自己資本のどちらで落ちたかを分けて記録する） |
| `offset`      | `number \| null`                                                                      | その有報の当期を 0 とする相対年度（0〜4）。貸借対照表項目は `null`                                                  |
| `fiscalYear`  | `number \| null`                                                                      | 絶対年度（`有報の当期年度 - offset`）。貸借対照表項目は `null`（§5 の型が年度を持たない）                           |
| `elementId`   | `string`                                                                              | XBRL 要素ID。原因調査はタグ単位でないと成立しないため落とさない                                                     |
| `reason`      | `unit-mismatch` / `unsafe-integer` / `unparsable-value`                               | 採用しなかった理由                                                                                                  |
| `raw`         | `string`                                                                              | 採用しなかった生の値（単位不整合時は `unitId=...` / `unit=...`）                                                    |
| `sourceDocId` | `string`                                                                              | どの有報由来か。最新有報と1年前有報の診断が**1つの配列に混ざる**ため、これで区別する                                |

> `reason` の語彙は IRバンク・Yahoo が共有する `ImportDiagnostic['reason']` とは**別物**。
> `unit-mismatch`（XBRL のユニットID／単位が期待と違う）は EDINET でしか起きないため、
> 共有型に混ぜず EDINET 専用型にしている（`import-review.md` §3.2 の表は EDINET には適用されない）。

エラー:

| ステータス | `kind`                                      | 意味                                                                                                                    |
| ---------- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| 400        | `invalid-code`                              | 銘柄コードの形式が不正                                                                                                  |
| 404        | `document-not-found`                        | docIDインデックスに該当エントリが無い（未上場・上場廃止・インデックス未整備）                                           |
| 502        | `authentication-failed`                     | EDINET が購読キーを受け付けなかった（文言:「EDINETの認証が通りませんでした。EDINET_API_KEY の設定を確認してください」） |
| 502        | `source-unreachable` / `malformed-response` | EDINET からの取得に失敗（文言:「EDINETからのデータ取得に失敗しました。時間をおいて再試行してください」）                |

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
  "priceSen": 425000,
  "useActualForScoring": false
}
```

主なバリデーション（zod。`company-input.ts`）:

| 項目                  | 制約                                                                              |
| --------------------- | --------------------------------------------------------------------------------- |
| `code`                | 4文字固定。先頭3桁は数字、末尾1桁は数字か英大文字（例: `130A`）                   |
| `name`                | 1〜100文字                                                                        |
| `records`             | 最大60件                                                                          |
| `dividends`           | 最大60件                                                                          |
| 金額系フィールド      | 整数のみ（安全整数）。小数は弾く                                                  |
| 比率系フィールド      | 有限の実数（`NaN`/`Infinity` は弾く）                                             |
| `priceSen`            | `0` 〜 `MAX_PRICE_SEN`（1株1,000,000円相当）                                      |
| `useActualForScoring` | 任意の `boolean`。省略時は既定 `false`（③ を予想優先で採点する。設計書 §5.1・§7） |

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
  "payoutRatioSource": "forecast",
  "payoutRatioForecast": { "score": 8, "value": 32.1, "unavailableReason": null },
  "payoutRatioActual": { "score": 6, "value": 41.5, "unavailableReason": null },
  "perSource": "forecast-eps",
  "pbrSource": "actual-bps",
  "priceSen": 425000,
  "per": 14.2,
  "pbr": 2.1,
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

> 🟢 **`priceSen`/`per`/`pbr` は 2026-08-17 設計（T-077）→ 2026-08-20 実装
> （T-096 着手前のブロッカー解消）。**
> [analysis-dialog.md §7](../ui/pages/analysis-dialog.md) の要求に対応する。
> 従来 `perSource`/`pbrSource`（出所ラベル）しか返しておらず、**近似値の実数そのものが
> フロントから見えなかった**（`companies.per`/`companies.pbr` には既にある値）。
> `priceSen`/`per`/`pbr` は `null` を返しうる（未入力・未算出）。
> 単位は `per`/`pbr` とも倍（`companies` テーブルと同じ `real`）。

> **判定不能な指標は `score`/`value` が `null` になり、`unavailableReason` に理由コードが入る。**
> `0` を返すことはない（`.claude/rules/frontend.md`「データが無い場合に0を表示しない」）。

> ✅ **2026-08-06 追加。** `payoutRatioSource` は③ 予想配当性向が採点に採用した出所
> （`'forecast' | 'actual' | null`。⑩ `dividendSource` と同じ発想）。
> `payoutRatioForecast` / `payoutRatioActual` は③ の予想側・実績側それぞれの判定結果
> （`PayoutRatioSideView`。`score` / `value` / `unavailableReason`）で、**採点への採用と
> 無関係に常に両方返す**（画面が両方を表示し、採用元を併記するため。設計書 §7・
> [payout-ratio-scoring.md](../logic/payout-ratio-scoring.md) §2）。`metrics[]` 中の
> ③（`payoutRatio`）は採点に**採用した**側の値のみが入る。

400: zod 検証失敗。

## GET /api/companies/:code

保存済み銘柄を**生データから再採点**して返す（`ScoringResponse`。形は POST と同じ。
`payoutRatioSource`/`payoutRatioForecast`/`payoutRatioActual` も同様に含む）。

保存済みの `score_cards`/`transformed_metrics` をそのまま返さないのは、ロジックを直したあとに
古い整形データを見せると画面と実装が食い違うため（`usecase/read-companies.ts`）。

クエリパラメータ:

| 項目                  | 制約                                                                                                                                                |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `useActualForScoring` | 任意。`"true"` \| `"false"`（文字列）。未指定なら既定 `false`（③ を予想優先で採点する）。`true` なら③ の採点に実績を強制採用する（設計書 §5.1・§7） |

- 400: 銘柄コードの形式不正
- 400: `useActualForScoring` が `"true"`/`"false"` のいずれでもない
  （文言:「useActualForScoring は true か false で指定する」。`src/handler/app.ts`）
- 404: 該当コードなし

## GET /api/companies/:code/dividends

> 🟢 **実装済み（T-097, 2026-08-20）。** [analysis-dialog.md §5.1・§5.2](../ui/pages/analysis-dialog.md)
> の指標詳細（①配当推移の折れ線グラフ、②連続非減配年数のリスト）が使う。
> `src/handler/app.ts` に `GET /api/companies/:code` の直後のルートとして実装（無認証）。

保存済みの配当履歴を**年度昇順**（古い年→新しい年）で返す。グラフ・リストの描画順に合わせるため、
他の一覧エンドポイント（降順が既定）とは向きが逆であることに注意。

**概要（`GET /api/companies/:code`）とは別エンドポイントにした。** 指標詳細を開かない限り
配当履歴は不要で、一覧のペイロードを重くしないため
（[analysis-dialog.md §7](../ui/pages/analysis-dialog.md) が検討した2案のうち
「指標詳細を開いたときだけ追加取得する」を採用）。

レスポンス（200）:

```json
{
  "dividends": [
    { "fiscalYear": 2019, "amountSen": 5000, "isForecast": false },
    { "fiscalYear": 2026, "amountSen": 10000, "isForecast": true }
  ]
}
```

| フィールド   | 意味                                                      |
| :----------- | :-------------------------------------------------------- |
| `fiscalYear` | 決算年度                                                  |
| `amountSen`  | 年間配当合計（銭）。`null`＝データなし。`0`＝無配（別物） |
| `isForecast` | `true` なら予想（年ラベルに「（予想）」を付ける）         |

`amountSen: null` の年度も除外せず`dividends[]`に含める（データ欠損を「行が無い」ではなく
`null`で表現する。0（無配）と`null`（欠損）を混同しない §データ全般の方針と同じ）。

**同一年度に複数区分（`forecast`/`revised`/`actual`）の行がある場合、
`actual` > `revised` > `forecast` の優先順位で1件だけ選ぶ**
（1年度につき1点でグラフ・リストを描くため。⑩配当利回りの採用ルール
（`dividend-yield-scoring.md`「最新年度に予想があれば採用」）とは**別の規則**であることに注意。
あちらは「今年何を採点に使うか」、こちらは「過去の年度をどう1点に集約するか」という
異なる目的の優先順位）。この優先順位は`amountSen`の値の有無では分岐しない
（`actual`が`amountSen: null`でも`revised`/`forecast`より`actual`を採用する）。

- 404: 該当コードなし
- 400: 銘柄コードの形式不正

---

## DELETE /api/companies/:code

- 204: 削除成功
- 400: 銘柄コードの形式不正

削除の冪等性（未登録コードに対する挙動）は未確認。次に触るときに検証すること。

---

## この API に無いもの（意図的）

- **ウォッチリスト** — 要件に対応する機能が無い。`user-api.md`（旧draft）にあった案は不採用
- ~~スクリーニング・フィルタ・ページング~~ — ✅ **2026-08-17 解消。** `GET /api/companies` に
  `q`/`sort`/`page`/`perPage` を追加した（T-077）
- **認証は意図的に付けない。** [ADR-0013](../../adr/0013-multi-user-auth-small-scale.md) の
  決定どおり、検索（`GET /api/companies` 系）は guest（未ログイン）でも使える公開画面
  （[screen-list.md](../ui/screen-list.md) §2）が呼ぶため。**銘柄の登録・更新・削除
  （`POST`/`DELETE`）は admin 限定にした**（✅ T-091で実装済み。`src/handler/app.ts` の
  `adminOnly`〈`requireRole('admin')`〉ミドルウェアを通る。[ADR-0013](../../adr/0013-multi-user-auth-small-scale.md)
  制約1への対応が完了している）

## 関連ドキュメント

- [scoring-requirements.md](../../01_requirements/scoring-requirements.md) — 10指標の定義
- [schema.md](../database/schema.md) — 永続化先のテーブル定義
- [domain-model.md](../../domain-model.md) — ドメインモデル全体
- [search-page.md](../ui/pages/search-page.md) — 検索・ソート・ページングを使う画面（T-072）
- [analysis-dialog.md](../ui/pages/analysis-dialog.md) — `priceSen`/`per`/`pbr`・配当履歴を使う画面（T-073）
- [ADR-0013](../../adr/0013-multi-user-auth-small-scale.md) — 認証・admin限定の方針
