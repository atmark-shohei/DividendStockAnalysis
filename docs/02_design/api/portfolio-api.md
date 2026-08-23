# ポートフォリオ・指標設定 API 仕様

> ステータス: 🟢 実装済み（2026-08-23、T-103。`src/handler/portfolio-routes.ts`）
> 呼び出し元: [portfolio-page.md](../ui/pages/portfolio-page.md)（T-081）・
> [indicator-custom-page.md](../ui/pages/indicator-custom-page.md)
> 集計の計算式: [portfolio-metrics.md](../logic/portfolio-metrics.md)（正）
> 認証・ロール: [ADR-0013](../../adr/0013-multi-user-auth-small-scale.md)

## 変更履歴

- **2026-08-16**: 新規作成（T-083）
- **2026-08-23**（T-103実装時に判明した仕様を追記）:
  - `PATCH /api/portfolios/:id/holdings/:code` は対象の `code` が保有されていない場合 404
    （`holding-not-found`）
  - `PATCH` のリクエストボディは `quantity`/`acquisitionPriceSen` の両方省略（空更新）を
    400で拒否する
  - `quantity`/`acquisitionPriceSen` に上限値（`MAX_HOLDING_QUANTITY`/`MAX_PRICE_SEN`）を追加し、
    超過時は400
  - ポートフォリオID生成方式（`pf_` + 16進数16桁）を明記
  - `GET /api/portfolios` の一覧の並び順（作成日時昇順）を明記

---

## 共通仕様

[company-api.md](./company-api.md) §共通仕様に準じる（金額は銭の整数、日時は UTC ISO 8601、
zod は handler 境界のみ）。加えてこの文書のエンドポイントは**すべてログイン必須**。

### 認証

- セッション Cookie（[ADR-0013](../../adr/0013-multi-user-auth-small-scale.md) §決定4）で判定する
- 未ログインは全エンドポイントで **401**（`{ "error": "ログインが必要です" }`）
- **他人のポートフォリオ・指標設定へはアクセスできない。** `portfolioId` がリクエスト元の
  セッションのユーザーに属さない場合は **404**（403 ではなく404。存在の有無を漏らさない。
  `auth-api.md` の「アカウントの存在有無を漏らさない」と同じ考え方）

### エラー形式

`company-api.md` と同じ形（`{ "error": "..." }`。400 は zod の `issues` を含む）。

| ステータス | 用途                                                        |
| :--------- | :---------------------------------------------------------- |
| 200 / 201  | 成功                                                        |
| 204        | 削除成功（本文なし）                                        |
| 400        | 入力形式不正（zod）／銘柄コード形式不正                     |
| 401        | 未ログイン                                                  |
| 403        | ポートフォリオ数の上限（10）／保有銘柄数の上限（100）に到達 |
| 404        | 対象なし、または他ユーザーのリソース                        |
| 409        | 同じポートフォリオに同じ銘柄コードを重複追加                |

---

## ポートフォリオ

### GET /api/portfolios

ログイン中のユーザーのポートフォリオ一覧。**保有銘柄の明細は含まない**（一覧は軽量に保つ。
1000社規模の N+1 を避ける方針を踏襲）。

```json
{
  "portfolios": [{ "id": "pf_01…", "name": "メインNISA", "holdingCount": 4 }],
  "maxPortfolios": 10
}
```

- **並び順は作成日時昇順（作成順）。** 評価額順・名前順などの並び替えオプションは無い
  （§未決定「保有銘柄の並び順」とは別の論点。実装 `D1PortfolioRepository.listSummariesByUserId`）

### POST /api/portfolios

```json
{ "name": "メインNISA" }
```

- 201。**上限（10）到達時は 403**（`{ "error": "ポートフォリオは最大10個までです" }`）
- `name` は1〜50文字（zod）。空文字は400
- **ID生成方式**: `pf_` + 16進数16桁（`crypto.getRandomValues(8byte)` を16進文字列化。例
  `pf_1a2b3c4d5e6f7089`）。衝突時の内部的なリトライ挙動（衝突検出・再生成）はAPI利用者に
  関係しない内部実装のため、この文書には記載しない（400/500のレスポンス形は変わらない）

### DELETE /api/portfolios/:id

- 204。**冪等にしない。** 存在しない・他ユーザーのものは 404
  （`user-api.md` 旧案の「削除は冪等」とは異なる方針。ポートフォリオの削除は
  保有銘柄をカスケード削除する重い操作であり、誤操作の兆候を隠さないため
  204 で握りつぶさず、存在確認を明示する）

---

## ポートフォリオ集計・保有銘柄

### GET /api/portfolios/:id

**集計値はサーバー側で計算して返す。** [portfolio-metrics.md](../logic/portfolio-metrics.md) の
`PortfolioMetrics` をそのまま JSON にした形。フロントは再計算しない
（[portfolio-page.md](../ui/pages/portfolio-page.md) §8）。

```json
{
  "id": "pf_01…",
  "name": "メインNISA",
  "metrics": {
    "totalValueSen": 62840000,
    "evaluableValueCount": 3,
    "unrealizedGainLossSen": 4120000,
    "weightedYieldPercent": 3.42,
    "costBasisYieldPercent": 4.1,
    "yieldEvaluableHoldingCount": 3,
    "scoreAverage": 68.2
  },
  "holdings": [
    {
      "code": "7203",
      "name": "トヨタ自動車",
      "quantity": 100,
      "acquisitionPriceSen": 280000,
      "currentPriceSen": 314200,
      "valueSen": 31420000,
      "unrealizedGainLossSen": 3420000,
      "dividendYieldPercent": 3.18,
      "totalScore": 62,
      "maxTotalScore": 100,
      "effectiveMetricCount": 8,
      "totalMetricCount": 10
    }
  ]
}
```

- `metrics` の `null` 許容フィールド（`weightedYieldPercent` 等）は `portfolio-metrics.md` §2.3 のとおり。
  **`0` に丸めない。データが無いときは JSON の `null` をそのまま返す**
- `yieldEvaluableHoldingCount` は `weightedYieldPercent`/`costBasisYieldPercent` 共通の母数
  （2026-08-17追加。`portfolio-metrics.md` §2.3）。`portfolio-page.md` の
  「利回り欠損銘柄を除いた母数を併記する」に対応する
- 保有銘柄1件ごとの `valueSen`/`unrealizedGainLossSen`/`dividendYieldPercent` が
  算出不能な場合も同様に `null`（現在株価未取得など）
- `effectiveMetricCount`/`totalMetricCount`（2026-08-17追加）は `score_cards` の既存カラムを
  そのまま返す。`portfolio-page.md` §4.1 の「スコア（N/10）」表示に使う
  （有効指標数の併記は §0.5 の恒久的な要件。省略しない）
- 404: 存在しない、または他ユーザーのポートフォリオ

### POST /api/portfolios/:id/holdings

保有銘柄を1件追加する。

```json
{ "code": "7203", "quantity": 100, "acquisitionPriceSen": 280000 }
```

| 条件                                            | 応答                                                       |
| :---------------------------------------------- | :--------------------------------------------------------- |
| `code` の形式不正                               | 400                                                        |
| `code` に対応する銘柄が未登録                   | 404（`{ "error": "指定された銘柄は登録されていません" }`） |
| 同じポートフォリオに同じ `code` が既にある      | 409（追加ではなく `PATCH` で数量・単価を更新すること）     |
| 保有銘柄が既に100件                             | 403                                                        |
| `quantity` ≤ 0 または `acquisitionPriceSen` ≤ 0 | 400                                                        |
| `quantity` が上限（`MAX_HOLDING_QUANTITY`=1,000,000株）超過、または `acquisitionPriceSen` が上限（`MAX_PRICE_SEN`=100,000,000銭=1,000,000円）超過 | 400 |

- 201。レスポンスは追加した保有銘柄1件分（`GET` の `holdings[]` の要素と同じ形）
- **`quantity`/`acquisitionPriceSen` の上限値**は、`calculatePortfolioMetrics`/
  `describeHoldingValuation` が `quantity × currentPriceSen` 等の積を追加のオーバーフロー
  チェック無しで計算する前提（[portfolio-metrics.md](../logic/portfolio-metrics.md)）を、
  入力境界で保証するために設けている（`MAX_HOLDING_QUANTITY × MAX_PRICE_SEN` が
  `Number.MAX_SAFE_INTEGER` の安全域に収まる値）

### PATCH /api/portfolios/:id/holdings/:code

保有数量・取得単価を更新する。

```json
{ "quantity": 150, "acquisitionPriceSen": 275000 }
```

- 200。両方または片方だけの更新を許す（zod で optional）
- 0以下の値、または上限値（`MAX_HOLDING_QUANTITY`/`MAX_PRICE_SEN`。§POST と同じ）超過は 400
- **両方省略した空更新（`{}`）は 400**（`{ "error": "入力が不正です。項目を確認して再送信してください" }`。
  `quantity`/`acquisitionPriceSen` のどちらかを指定する必要がある）
- 対象の `code` がそのポートフォリオに保有されていない場合は **404**
  （`{ "error": "指定された保有銘柄は見つかりません" }`）

### DELETE /api/portfolios/:id/holdings/:code

- 204（冪等。未保有でも 204）。**ポートフォリオ本体の削除とは方針が異なる**
  （§ポートフォリオ の削除は非冪等・404 を返すが、保有銘柄1件の削除は
  他の一覧削除操作（`DELETE /api/companies/:code` 等）と同じ冪等方針に揃える）

---

## 指標カスタマイズ

[indicator-custom-page.md](../ui/pages/indicator-custom-page.md) §6 が要求する形。
計算方法は [ADR-0012](../../adr/0012-indicator-customization-scaling-and-denominator.md) が正。

### GET /api/indicator-settings

ログイン中のユーザーの設定。**未設定（初回アクセス）なら全10指標選択・
デフォルト基準値相当を返す**（保存済みレコードが無くても 404 にしない）。

```json
{
  "selected": ["dividendGrowthRate", "consecutiveYears", "..."],
  "basisValues": { "dividendGrowthRate": 30, "roeAverage": 15.0 }
}
```

- `selected` は [`MetricKey`](../../../src/domain/shared/metric-key.ts) の配列。5〜10件
- `basisValues` は選択した指標のうち、基準値を持つもの（MIX係数は含まれない）
- 未設定ユーザーの応答は `basisValues` に `bands.ts` のデフォルト満点境界をそのまま入れる
  （フロントが「デフォルト値とは何か」を知らなくて済むようにする）

### PUT /api/indicator-settings

全置き換え（部分更新ではない。指標カスタマイズ画面は「設定を保存」で一括送信するため）。

```json
{
  "selected": ["dividendGrowthRate", "roeAverage", "..."],
  "basisValues": { "dividendGrowthRate": 25.0, "roeAverage": 12.0 }
}
```

| 検証                                                                                     | 失敗時の応答                                                            |
| :--------------------------------------------------------------------------------------- | :---------------------------------------------------------------------- |
| `selected` の件数が 5〜10 の範囲外                                                       | 400                                                                     |
| `basisValues` に MIX係数のキーが含まれる                                                 | 400（`{ "error": "MIX係数の基準値は指定できません" }`）                 |
| `selected` に含まれる指標（**MIX係数を除く**）の `basisValues` が欠けている              | 400                                                                     |
| **基準値が0以下**（[indicator-custom-page.md](../ui/pages/indicator-custom-page.md) §4） | 400（`{ "error": "満点となる基準値は 0 より大きい値にしてください" }`） |
| §3の `min`/`max`（きざみ含む）の範囲外                                                   | 400                                                                     |

- **サーバー側の検証はフロントのバリデーションと独立に行う**（`.claude/rules/backend.md`）。
  フロントの `<NumberInput>` の `min`/`max` はUXのためであり、信頼の境界はここ
- 200。保存後の設定をそのまま返す（`GET` と同じ形）
- **保存前に `validateBands()` 相当のドメイン検証を通す**
  （比例スケーリング後の10境界が単調増加であることを確認する。ADR-0005 の既定規約）

> ⚠️ **2026-08-17 訂正。** 旧版は「`basisValues` にMIX係数を含めたら400」と
> 「`selected` の指標すべてに `basisValues` が要る」の2規則が両立せず、
> **⑨MIX係数を選択したまま保存する経路が存在しなかった**（T-088レビューで発見。
> ⑨は選択・除外はできるが基準値は持たない。§GET の記載どおり）。
> 後者の規則から MIX係数を明示的に除外した。

---

## 未決定

- [ ] ポートフォリオ名の重複を許すか（現時点では許す想定。一意制約は張らない）
- [ ] 保有銘柄の並び順（追加順 / 評価額順）をユーザーが選べるか
- [ ] admin による他ユーザーのポートフォリオ閲覧（サポート目的）を許すか。
      現状は許さない（§共通仕様「他人のポートフォリオへはアクセスできない」に admin も含む）

## 関連ドキュメント

- [schema.md](../database/schema.md) — テーブル定義（正。T-078）
- [company-api.md](./company-api.md) — 共通仕様・エラー形式の元
- [portfolio-page.md](../ui/pages/portfolio-page.md) — この API を呼ぶ画面
- [portfolio-metrics.md](../logic/portfolio-metrics.md) — 集計の計算式（正）
- [indicator-custom-page.md](../ui/pages/indicator-custom-page.md) — 指標設定を使う画面
- [ADR-0012](../../adr/0012-indicator-customization-scaling-and-denominator.md) — スケーリング方式
- [ADR-0013](../../adr/0013-multi-user-auth-small-scale.md) — 認証・セッション
