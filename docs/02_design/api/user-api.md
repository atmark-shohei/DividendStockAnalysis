# 銘柄・ウォッチリスト API 仕様

> ステータス: 🟡 draft — エンドポイントの形は仮。DB 設計の確定後に見直す。

## 共通仕様

- ベースパス: `/api`
- リクエスト・レスポンスともに JSON
- 金額は**銭単位の整数**で返す。フロント側で表示単位に変換する
- 日時は ISO 8601 の UTC（`2026-07-26T00:00:00Z`）
- すべてのデータ応答に `fetchedAt` を含める

### エラー形式

```json
{ "error": "<machine_readable_code>", "message": "<人間向けの説明>" }
```

内部情報（SQL・パス・スタックトレース）を含めない。

| ステータス | code | 意味 |
|---|---|---|
| 400 | `invalid_request` | 入力形式不正 |
| 404 | `not_found` | 対象なし |
| 409 | `already_exists` | 重複追加 |
| 502 | `upstream_unavailable` | 外部データ源の障害 |
| 500 | `internal_error` | 想定外 |

---

## 銘柄

### GET /api/stocks

スクリーニング付きの銘柄一覧。

クエリパラメータ:

| 名前 | 型 | 既定 | 説明 |
|---|---|---|---|
| `minYield` | number | — | 配当利回りの下限（%） |
| `maxPayoutRatio` | number | — | 配当性向の上限（%） |
| `sector` | string | — | 業種 |
| `sort` | string | `yield_desc` | `yield_desc` / `code_asc` |
| `page` | int | 1 | |
| `perPage` | int | 50 | 最大 100 |

レスポンス（200）:
```json
{
  "items": [
    {
      "code": "9999",
      "name": "テスト商事",
      "sector": "卸売業",
      "closeSen": 300000,
      "annualDividendSen": 16000,
      "dividendYieldBp": 533,
      "isForecast": false,
      "fetchedAt": "2026-07-26T00:00:00Z"
    }
  ],
  "page": 1,
  "perPage": 50,
  "total": 1
}
```

> `dividendYieldBp` はベーシスポイント（1bp = 0.01%）の整数。
> 浮動小数点を API 境界に出さないための措置。533 → 5.33%。
>
> 計算できない場合（株価0・データ欠損）は **`null`** を返す。**0 を返さない**。

### GET /api/stocks/:code

銘柄詳細。配当実績の推移を含む。

```json
{
  "code": "9999",
  "name": "テスト商事",
  "dividends": [
    { "fiscalYear": 2024, "period": "annual", "amountSen": 16000, "isForecast": false }
  ],
  "consecutiveDividendYears": 12,
  "consecutiveIncreaseYears": 3,
  "fetchedAt": "2026-07-26T00:00:00Z"
}
```

404: 該当コードなし。

---

## ウォッチリスト

### GET /api/watchlist

登録銘柄の一覧。各要素は `GET /api/stocks` の item と同じ形＋ `note`。

### POST /api/watchlist

```json
{ "code": "9999", "note": "任意メモ" }
```

- 201: 追加成功
- 400: 銘柄コードの形式不正
- 404: 該当銘柄が存在しない
- 409: すでに登録済み

### DELETE /api/watchlist/:code

- 204: 削除成功（**冪等**。未登録でも 204 を返す）

---

## 未決定

- [ ] 認証の有無（`docs/02_design/api/auth-api.md` 参照）
- [ ] データ更新のトリガー（手動 `POST /api/ingest` を作るか）
- [ ] ポートフォリオ API を作るか
