# 市場データ取り込み 仕様書（株価・配当履歴・株式分割）

> ステータス: 🟢 実装済み（2026-08-25 確認、T-106）。
> 実装: `src/usecase/import-market-data.ts`・`src/infra/yahoo/`
> （`chart-client.ts`・`parse-chart.ts`）。
> ルート: `GET /api/market-data/:code`（`src/handler/app.ts`）。
> テスト: `tests/usecase/import-market-data.test.ts`・`tests/handler/market-data-import.test.ts`。
>
> 2026-07-30 起票。実データで取得可能性を検証したうえで書いている（§2）。
> 財務諸表の取り込みは [irbank-json-import.md](./irbank-json-import.md) が正で、
> **本仕様はそれを置き換えない。補完する。**

## 1. 概要

Yahoo Finance のチャートエンドポイントから、**株価・配当履歴・株式分割イベント**を
取り込むポートを定義する。IRバンクの JSON では埋まらない指標を埋めるのが目的。

### 1.1. なぜ別ポートにするか

既存の `FinancialSource`（`src/domain/company/financial-source.ts`）に相乗りさせない。
**扱う関心事が違う。**

|              | `FinancialSource`（既存）               | `MarketDataSource`（本仕様）        |
| :----------- | :-------------------------------------- | :---------------------------------- |
| 返すもの     | EPS・ROE・売上高・営業利益・BPS・予想値 | 株価・配当履歴・分割イベント        |
| 更新の周期   | 四半期                                  | 株価は日次、配当は権利落ちごと      |
| 取得元       | IRバンク（`fy-data-all.json`）          | Yahoo Finance（`v8/finance/chart`） |
| 失敗したとき | 取り込み自体が成立しない                | **株価が無くても財務は使える**      |

1つのインターフェースに統合すると、どちらの実装も**半分のフィールドを `null` で
埋めて返すことになり、型が意味を失う**。失敗の波及範囲も違う（株価が取れなくても
④⑤⑧ は採点できる）ので、分けて片方だけ失敗できるようにする。

### 1.2. スコープ外

- **財務諸表は取らない。** このエンドポイントに EPS・売上高は含まれない（§2.2）。
  ④ EPS CAGR と ⑦ 売上CAGR は**引き続き埋まらない**（§6）
- 株価の履歴は取らない。⑨⑩ が使うのは最新値だけで、時系列は現時点で用途が無い
- 自動更新・定期取得はしない。ユーザーが取り込みボタンを押したときだけ取る

## 2. 実データによる検証（2026-07-30 実施）

**推測ではなく実際に叩いて確認した結果**を根拠にしている。

```
GET https://query1.finance.yahoo.com/v8/finance/chart/{code}.T
    ?range=max&interval={1d|1mo}&events=div%7Csplit
```

**`1d` と `1mo` の両方で叩き、`events`（配当・分割）が同じ内容で返ることを確認した。**
§3.1 の生データの例は `1mo` の応答から取っている。実装は `1mo` を使う（§5）。

### 2.1. 取得できたもの（9433 / 7203 / 8306 / 1301 で確認）

| 項目                      | 結果                                                                 |
| :------------------------ | :------------------------------------------------------------------- |
| `meta.longName`           | ✅ ただし**英語名のみ**（`KDDI Corporation`）。日本語名は無い        |
| `meta.regularMarketPrice` | ✅ 3,051（円）                                                       |
| `meta.regularMarketTime`  | ✅ Unix 秒。**観測時刻が取れる**（§3.3）                             |
| `events.dividends`        | ✅ **21〜28年ぶん**（9433 は 2000年〜、7203 は 1999年〜）            |
| `events.splits`           | ✅ 日付＋`numerator`/`denominator`                                   |
| User-Agent                | ✅ UA なしで HTTP 200 ⚠️ **2026-08-04 に再現しなくなった**（§2.1.1） |

#### 2.1.1. User-Agent の再計測（2026-08-04）

**2026-07-30 の「UA なしで 200」は 2026-08-04 時点で再現しない。**
上表の行は当時の計測記録としてそのまま残し、ここに現在の事実を書く。

`wrangler dev`（workerd）上で `GET /api/market-data/9433` が 502 になり、
サーバーログは `market data import failed source-unreachable`、応答時間 109ms
（タイムアウト5秒・リトライ待機1秒を経ていない速さ）。§5.1 の「429 を受けたら
即座に諦める」パスを通っていた。

ローカルのエコーサーバーで各ランタイムの送信ヘッダーを実測した結果:

| ランタイム              | 送信ヘッダー                                                                               | Yahoo の応答 |
| :---------------------- | :----------------------------------------------------------------------------------------- | :----------- |
| Node fetch（undici）    | accept, accept-language, sec-fetch-mode, **user-agent: node**, accept-encoding, connection | **200**      |
| workerd（wrangler dev） | accept, cf-worker（**User-Agent を一切送らない**）                                         | **429**      |

workerd 上で User-Agent だけを変えた検証（銘柄 9433）:

| 条件                                         | 結果                    |
| :------------------------------------------- | :---------------------- |
| UA 無し                                      | **429**                 |
| `user-agent: node`                           | **200**（30,487 bytes） |
| `user-agent: DividendStockAnalysis/1.0`      | 200（30,487 bytes）     |
| `user-agent: node` + Node 同等の付随ヘッダー | 200                     |

**結論: workerd の fetch は User-Agent を送らず、Yahoo の WAF が UA 無しの
リクエストを 429 で拒否する。** UA を付ければ 200 が返るので、認証要求でも
恒常的なレート制限でもない（ADR-0010 の見直しトリガーには該当しない）。
実装は `user-agent: node` を送る（§5）。

### 2.2. 取得できないもの

- **EPS・ROE・売上高・営業利益・BPS**（チャートエンドポイントの守備範囲外）
- **決算月**。`meta` に決算期の情報は無い（`exchangeName: JPX` などしか無い）。
  → **IRバンクの年度キー（`2026/03`）から取るしかない**。§3.2 の前提になる
- **日本語の銘柄名**

### 2.3. 配当がIRバンクと一致することの確認

9433 の権利落ち日を決算年度に集計すると、IRバンクの値と**4期すべて一致した**。

| 権利落ち日（中間 / 期末） | 金額      | 決算年度    | 合計   | IRバンク      |
| :------------------------ | :-------- | :---------- | :----- | :------------ |
| 2022-09-29 / 2023-03-30   | 32.5 + 35 | 2023年3月期 | 67.5円 | **67.5円** ✅ |
| 2023-09-28 / 2024-03-28   | 35 + 35   | 2024年3月期 | 70円   | **70円** ✅   |
| 2024-09-27 / 2025-03-28   | 35 + 37.5 | 2025年3月期 | 72.5円 | **72.5円** ✅ |
| 2025-09-29 / 2026-03-30   | 40 + 40   | 2026年3月期 | 80円   | **80円** ✅   |

**2025年3月に 1:2 分割があるにもかかわらず一致している。** 両者とも分割調整後の
値を返しているということであり、**データ源をまたいでも値がずれない**ことの裏付けになる。

> ⚠️ ただし確認したのは 9433 の直近4期だけである。他の銘柄・古い年度で同じ保証は無い。
> §7 の受入基準で複数銘柄を踏む。

## 3. 正規化ロジック

### 3.1. 取るのは `date` であって、キーではない

`events.dividends` / `events.splits` は**オブジェクトのキーと `date` フィールドが違う**。

```json
{
  "1740754800": { "date": 1743120000, "numerator": 2, "denominator": 1, "splitRatio": "2:1" }
}
```

キー `1740754800` は 2025-03-01（JST）、`date` は 2025-03-28。
**キーを日付として使うと1か月ずれる。** 必ず `date` を読む。

`date` は UTC の 0時に正規化されている（`1743120000` = `2025-03-28T00:00:00Z`）ので、
日付成分は JST でも同じ日になる。ただしこれは観測に基づく前提であり、
**日付境界の判定は UTC の日付成分で行う**と決めておく（実装とテストを一致させるため）。

### 3.2. 権利落ち日 → 決算年度

**暦年で合算してはいけない。** 日本企業は中間（9月末）と期末（翌3月末）に分かれるため、
暦年で足すと期をまたぐ。実際 9433 を暦年集計すると 2026年が 40円（中間だけ）になり、
前年 77.5円からの**半減として見えてしまう**。

決算月 `fiscalYearEndMonth`（IRバンクの年度キー由来）を受け取り、次の規則で集計する。

> 決算年度 `Y` の期間 = `Y-1` 年の `M+1` 月1日 〜 `Y` 年の `M` 月末日
> （`M` = 決算月。`M = 12` なら `Y` 年1月1日〜12月31日）

3月期なら 2025-04-01 〜 2026-03-31 の権利落ちが「2026年3月期」になる。§2.3 の一致は
この規則で得られたものである。

**決算月が取れない銘柄は集計しない。** 推測で3月を既定にしない
（12月期・9月期の銘柄で全年度が1つずれ、増配率が嘘になる）。

#### 決算月をどこから取るか（✅ 2026-07-31 決着。旧 §8-2）

Yahoo は決算月を返さない（§2.2）。**IRバンクの年度キーから導出する。**

`parse-fy-data.ts` の `FISCAL_YEAR_KEY = /^(\d{4})\/(\d{2})$/` は月を第2グループで
捕捉しながら**年しか使っていない**。ここを次のように変える。

> **業績・配当・財務の各ブロックに現れた年度キーの「月」を集め、
> 重複を除く。ちょうど1つなら決算月。0個または2個以上なら `null`。**

`ImportedFinancials`（`financial-source.ts`）に `fiscalYearEndMonth: number | null`
を追加して持ち回る。

**2個以上を `null` にするのは決算期変更の検出を兼ねる**（§8-5）。
`2025/03` と `2026/12` が混在する銘柄は決算月を変えているので、
単一スカラーでは正しく集計できない。**推測せず `null` にして集計を止め、
`reason: 'unknown-note'` 相当の診断を残す**（穴のある集計を黙って通さない）。

⚠️ **IRバンクの年度キーは直近5期ぶんしか無い。** Yahoo の配当は21〜28年ぶんある
ので、**決算月が既知なのは直近5期だけ**である。それより古い年度には
「直近5期と同じ決算月が続いていた」という仮定を置くことになる（§8-5）。

#### 進行中の年度は集計しない（🔴 レビュー指摘、2026-07-31）

上の規則だけでは、**期間がまだ終わっていない年度を部分集計してしまう。**
3月期の銘柄を10月に取り込むと、FY2027 は中間配当だけの 40円が
`kind: 'actual'`（＝「年間配当の合計」）として出る。結果:

- ②: `latest(40) < previous(80)` で減配と判定され **0年**（`consecutive-years.ts:56`）
- ①: 半期分と5年前を比較して大幅減配に見える
- ⑩: IRバンクに予想行が無い銘柄では、この 40円が最新実績として採用される

`DividendRecord.annualAmountSen` の定義（「年間配当の合計」）を破る値を作るのが本質。

> **期間末日が取得時点より後の年度は、レコードを作らない。**

§2.3 の検証が綺麗に一致したのは、2026-07-30 時点で FY2027 の権利落ちが
まだ1件も無かったからにすぎない。数か月後に同じ検証をすれば破綻する。

#### 「配当イベントが1件も無い年度」（🔴 レビュー指摘、2026-07-31）

`payments` は**支払いがあった回だけ**の配列なので、そのままでは
「その年度に権利落ちが1件も無い」ケース（無配転落・配当停止）を表現できない。
レコードを作らないと年度行が欠け、`seriesOf` が `null` を置き、
② は `unavailable('input-missing')` に倒れる（`consecutive-years.ts:54-55`）。
**実際には減配（無配）なので打ち切って年数を確定すべき場面で、判定不能に化ける。**

IRバンクの `"-"`（不明）と違い、**この経路では「イベントが無い＝配当が無かった」と
断定できる**（カバー範囲内に限る）。

> **カバー範囲 = 最古の権利落ち日を含む年度 〜 直近の完了year。
> その内側の空白年は `0`（無配）、外側はレコードを作らない。**

`CLAUDE.md`「`null`（判定不能）と 0点は別物」に直接触れる箇所である。

### 3.3. 株価と観測時刻

`regularMarketPrice` と `regularMarketTime` を**必ずセットで**返す。

`CLAUDE.md`「取得した株価・配当データは必ず『取得時刻』とセットで保存する」に対し、
現在の `fetchedAt` は**保存した時刻**であって株価を観測した時刻ではない
（[import-review.md §8-3](./import-review.md) に未解決として記載済み）。
`regularMarketTime` はこの穴を塞ぐ。

- `regularMarketTime` は Unix 秒。**UTC の ISO 8601 文字列**にして返す（`CLAUDE.md`）
- 表示層でのみ JST に変換する
- 株価があるのに観測時刻が無い応答は、**株価ごと捨てる**（いつ時点か分からない値を
  最新として表示しない）
- 円→銭は `Math.round(price * 100)`。0以下、または業務上限 `MAX_PRICE_SEN`
  （1株100万円。`dividend-record.ts:46`）超は**取り込まない**。
  DTO が `senValue.min(0).max(MAX_PRICE_SEN)` で弾く（`company-input.ts:78`）ため、
  ここで落とさないと保存時に 400 になる

> 🔴 **この仕様は `priceAsOf` を保存しない。** `companies` テーブルにも `Company` 型にも
> 該当する列が無く、本仕様の §9 もスキーマ変更を含まない。したがって
> **[import-review.md](./import-review.md) §8-3（株価の観測時刻を持たない）は塞がらない。**
> 本仕様が塞ぐのは「取り込み画面で、いま取った株価がいつ時点かを示す」ところまでで、
> 保存後の一覧・スコア表示は従来どおり `fetchedAt`（保存時刻）しか持たない。
> スキーマまで通すかは §8-8。

### 3.4. 円 → 銭の変換

配当額は小数で来る（実測: `0.745833`）。分割調整の結果、**銭の整数にならない値がある**。

- **合算してから丸める。** 各回を丸めてから足すと誤差が積む
  - 例: `0.745833 + 0.745833 = 1.491666` 円 = `149.1666` 銭 → **149銭**
  - 各回を丸めると `75 + 75 = 150銭` で **1銭ずれる**
- 丸めたら `reason: 'rounded'` の診断を残す（`parse-fy-data.ts` と同じ方針）
- 銭にして安全整数を超えたら `unsafe-integer` として値を捨てる
- **丸めた結果 0 銭になる年度は `0`（無配）ではなく `null`（判定不能）にする。**
  0 は無配を意味し、① のゼロ除算・② の減配判定を引き起こす。
  1銭未満の配当は「無配」ではないので、0 に丸めてはいけない

> ✅ **`amountYen: number`（円・小数）を domain の型に置くかは決着済み**（2026-08-03・
> §8-9・案B採用）。`CLAUDE.md`・`.claude/rules/backend.md` の「浮動小数点で金額計算を
> しない」に従い、`DividendPayment.amountYenText: string`（数値リテラルの文字列。
> **未検証・未変換のまま**）を採用した。infra 側（`parse-chart.ts`）がレスポンス本文
> （テキスト）から数値リテラルを文字列のまま正規表現で抜き出し、`JSON.parse` の
> 丸め誤差（Yahoo の `number` は double）を経由させない。数値への変換・銭への丸めは
> 決算年度への集計時（`toFiscalYearDividends`）に行う（§3.4 の順序どおり）。
> 詳細・決定理由は §8-9 を参照。

### 3.5. 分割イベント

`numerator` / `denominator` を**そのまま使う。`splitRatio` の文字列をパースしない。**

| 実測値                                 | 意味                   |
| :------------------------------------- | :--------------------- |
| 9433: `numerator: 100, denominator: 1` | 1株 → 100株（分割）    |
| 1301: `numerator: 1, denominator: 10`  | 10株 → 1株（**併合**） |

文字列の `"100:1"` と `"1:10"` は向きが逆で、**文字列から向きを判断すると併合を
分割と取り違える**。数値フィールドなら `numerator / denominator > 1` が分割、
`< 1` が併合として一意に決まる。

## 4. 型

### 4.1. ポート（domain）

`src/domain/company/market-data-source.ts`。**素TS。HTTP も Yahoo も現れない。**

```ts
/**
 * 1回ぶんの配当。決算年度への集計前の生データ。
 *
 * `amountYenText` は数値ではなく**数値リテラルの文字列**（例: `"0.745833"`）。
 * `JSON.parse` を経由すると Yahoo の `number`（double）が丸め誤差を持つため、
 * infra 側がレスポンス本文から文字列のまま抜き出す（§3.4・§8-9・案B採用）。
 * 数値への変換・銭への丸めは決算年度への集計時（`toFiscalYearDividends`）に行う。
 */
export interface DividendPayment {
  /** 権利落ち日。`YYYY-MM-DD`（UTC の日付成分。§3.1） */
  readonly exDividendDate: string;
  /** 円の金額を表す数値リテラルの文字列。分割調整済み（§3.4） */
  readonly amountYenText: string;
}

export interface SplitEvent {
  /** `YYYY-MM-DD` */
  readonly date: string;
  /** 分割後 / 分割前。`> 1` が分割、`< 1` が併合（§3.5） */
  readonly numerator: number;
  readonly denominator: number;
}

export interface MarketData {
  readonly code: string;
  /** **英語名のみ。** 日本語名は取れない（§2.2）。取れなければ `null` */
  readonly name: string | null;
  /** 銭。取れなければ `null` */
  readonly priceSen: number | null;
  /** 株価の観測時刻。UTC の ISO 8601。**株価があるなら必ず非 `null`**（§3.3） */
  readonly priceAsOf: string | null;
  /** 権利落ち日の昇順。**決算年度への集計はここではしない**（§4.2） */
  readonly dividendPayments: readonly DividendPayment[];
  /** スコアリング・自動反映には使わない。参考情報として画面へ表示するために保持する（§8-17） */
  readonly splits: readonly SplitEvent[];
  readonly diagnostics: readonly ImportDiagnostic[];
}

export type MarketDataError =
  | { readonly kind: 'invalid-code'; readonly code: string }
  | { readonly kind: 'source-not-found'; readonly code: string }
  | { readonly kind: 'source-unreachable'; readonly detail: string }
  | { readonly kind: 'malformed-response'; readonly detail: string }
  | { readonly kind: 'unexpected-shape'; readonly detail: string };

export interface MarketDataSource {
  /** **保存はしない。** 取得だけ */
  fetchByCode(code: string): Promise<Result<MarketData, MarketDataError>>;
}
```

**`fetchByCode` は決算月を受け取らない。** 取得と集計を混ぜないため（§4.2）。

`ImportDiagnostic` は既存のものを再利用する（`financial-source.ts`）。`block` は
「取り込み元の区画名」と定義済みで IRバンク専用ではない。本仕様では `'配当'` /
`'株価'` を使う。

### 4.2. 集計（domain の純粋関数）

`src/domain/company/dividend-fiscal-year.ts`。**ネットワークを知らない。**

```ts
/** ドメインは throw しない。決算月が使えない形なら集計せずエラーを返す */
export type DividendFiscalYearError = { readonly kind: 'invalid-fiscal-year-end-month' };

export interface FiscalYearDividends {
  readonly records: readonly DividendRecord[];
  readonly diagnostics: readonly ImportDiagnostic[];
}

/**
 * @param payments 権利落ち日の昇順である必要はない
 * @param fiscalYearEndMonth 決算月（1〜12の整数）。IRバンクの年度キーから導出したもの
 * @param asOf 取得時点。**呼び出し側が渡す。**関数内で `Date.now()` を読まない
 *   （§7.1「取得時点は引数で渡す」。テストできなくなるのを避ける）
 */
export function toFiscalYearDividends(
  payments: readonly DividendPayment[],
  fiscalYearEndMonth: number,
  asOf: Date,
): Result<FiscalYearDividends, DividendFiscalYearError>;
```

集計をポートから外に出す理由は2つ。

1. **決算月は別のデータ源（IRバンク）から来る。** ポートに渡すと、Yahoo の実装が
   IRバンクの都合を知ることになる
2. **単体テストが書ける。** 日付境界（3/31 と 4/1）・12月期を
   ネットワーク無しで踏める（決算期変更は §8-5 のとおり対象外）

返す `DividendRecord` の `kind` は**すべて `'actual'`**。権利落ちは実績であり、
予想配当はこの経路では取れない（予想は引き続き IRバンク）。

### 4.3. ⚠️ この出力が ①② に届くには [ADR-0009](../../adr/0009-dividend-single-source.md) が要る

**本仕様は ADR-0009 に依存する。先に適用しないと §6 の「①② ✅」は成立しない。**

`DividendRecord` を返しても、現状の ①② は**それを読んでいない**。

| 指標                        | 現状の入力                                            | 出所                                       |
| :-------------------------- | :---------------------------------------------------- | :----------------------------------------- |
| ① 増配率 / ② 連続非減配年数 | `seriesOf(company, (r) => r.dividendPerShareSen, 19)` | **`Company.records`（`FinancialRecord`）** |
| ③ 予想配当性向              | `latestForecastRecord(company)?.dividendPerShareSen`  | 同上                                       |
| ⑩ 配当利回り                | `selectAnnualDividend(company.dividends)`             | `Company.dividends`（`DividendRecord`）    |

つまり `DividendRecord[]` を返すだけでは **⑩ にしか効かない**（`score-company.ts:69,76,86-93`）。
21〜28年ぶんの配当を取っても ①② は現状のまま埋まらない。

ADR-0009 は配当を `DividendRecord` に一本化し、①②③ の入力をそちら側へ切り替える
決定である。**適用順は ADR-0009 → 本仕様。**

あわせて ADR-0009 が要求する年度整列（`seriesOf` 相当。実績のみ・添字＝何年前）が
`DividendRecord` 側に必要になる。本仕様の `toFiscalYearDividends` は
**年度ごとの合計を作るところまで**で、整列はその関数の責務ではない。

## 5. 取得（infra）

`src/infra/yahoo/chart-client.ts`。**ここだけがネットワークを知る。**
パースは `parse-chart.ts`（純粋関数）に分ける。`fy-data-client.ts` と同じ構成にする
（規約面で取得できなくなったときに前段だけ差し替えるため。ADR-0007 と同じ理由）。

```
GET https://query1.finance.yahoo.com/v8/finance/chart/{code}.T
    ?range=max&interval=1mo&events=div%7Csplit
```

- **`interval=1mo` にする。** 必要なのは `meta` と `events` だけで、日足の価格配列は
  使わない。`1d` だと 25年ぶんで数千件の無駄な配列が返る
- ティッカーは `{code}.T`（東証）。銘柄コードの形式検証は `fy-data-client.ts` と同じ
  `^\d{3}[0-9A-Z]$`
- タイムアウト 5秒、リトライは**1回だけ**（既存と同じ。`.claude/rules/backend.md`）
- **User-Agent は `node` を送る。** ブラウザを騙る文字列は使わない（規約違反の意図が
  あると解釈されうる）。
  - 2026-07-30 時点は UA 無しで 200 が返っていたため「UA を付けない」と定めていた（§2.1）
  - **2026-08-04 の再計測でこれは成り立たなくなった。** workerd の fetch は
    User-Agent を一切送らず、Yahoo の WAF が UA 無しのリクエストを 429 で拒否する。
    UA を `node` にすると 200 が返る（§2.1.1）

### 5.1. レート制限

yfinance 利用者から `Too Many Requests`（429）の報告がある。本仕様は**ユーザーの
操作1回につき1銘柄1リクエスト**なので通常は踏まないが、429 を受けたら
**リトライせず**（`fy-data-client.ts:109-111` と同じ扱い）`source-unreachable` を返す。
タイムアウトと 5xx は1回だけリトライし、なお失敗なら同じく `source-unreachable`。

一覧の全銘柄を一括更新するような機能は**作らない**（§1.2）。

## 6. 何が埋まり、何が埋まらないか

[irbank-json-import.md §6.2](./irbank-json-import.md) の表を、本仕様の併用後で更新した姿。

| 指標               | 必要              | 現状       | 併用後 | 根拠                                       |
| :----------------- | :---------------- | :--------- | :----- | :----------------------------------------- |
| ① 増配率           | 配当6期           | ❌         | ✅※    | 配当が21〜28年ぶん                         |
| ② 連続非減配年数   | 最大18期          | ❌         | ✅※    | 同上。**今どうやっても埋まらなかった指標** |
| ③ 予想配当性向     | 予想EPS＋予想配当 | △          | △      | 変わらず（予想はIRバンク）                 |
| ④ EPS CAGR         | EPS実績6期        | ❌         | ❌     | **EPSは取れない**（§2.2）                  |
| ⑤ ROE平均          | ROE実績5期        | △          | △      | 変わらず                                   |
| ⑥ 配当維持可能年数 | 貸借対照表        | ❌         | ❌     | 手入力のまま                               |
| ⑦ 売上CAGR         | 売上実績6期       | ❌         | ❌     | **売上は取れない**（§2.2）                 |
| ⑧ 営業利益率       | 実績5期           | △          | △      | 変わらず                                   |
| ⑨ MIX係数          | EPS・BPS＋株価    | 株価手入力 | ✅     | 株価が自動で入る                           |
| ⑩ 配当利回り       | 予想配当＋株価    | 株価手入力 | ✅     | 同上                                       |

**①② が解ける**のが本仕様の価値である。④⑦ は解けない。

> ※ **①② の ✅ は [ADR-0009](../../adr/0009-dividend-single-source.md) の適用が前提。**
> 本仕様だけを実装しても ①② は埋まらない（§4.3）。ADR-0009 を適用しない場合、
> 本仕様で改善するのは **⑨⑩ だけ**になる。

## 7. 受入基準

### 7.1. 決算年度への集計（`toFiscalYearDividends`）

- [ ] 3月期・権利落ち `2025-09-29`(35) と `2026-03-30`(40) → 2026年度に 7,500銭
- [ ] 3月期・`2026-03-31` は 2026年度、`2026-04-01` は 2027年度（**期末日ちょうどの境界**）
- [ ] 12月期・`2025-01-01` と `2025-12-31` はどちらも 2025年度
- [ ] 12月期・`2024-12-31` は 2024年度（`M=12` の折り返し）
- [ ] 9月期・`2025-10-01` は 2026年度
- [ ] 年1回配当（期末のみ）でも正しい年度に入る
- [ ] 年4回配当（四半期配当）が同じ年度に合算される
- [ ] **合算してから丸める**: `0.745833 + 0.745833` → **149銭**（150銭ではない）
- [ ] 丸めたら `reason: 'rounded'` が1件出る
- [ ] 丸めが起きなければ `rounded` は出ない（`35 + 40` は丸めない）
- [ ] 銭にして安全整数を超える額 → `unsafe-integer` を出し、その年度は `null`
- [ ] 配当が0件 → 空配列（`null` ではない）。例外を投げない
- [ ] **配当額 0 の支払いがある年度は `0` を返す**（`null` にしない。無配と欠損は別物）
- [ ] `fiscalYearEndMonth` が `0` / `13` / 小数 / `NaN` → 集計せずエラー（推測で3月にしない）
- [ ] 返す `DividendRecord` の `kind` はすべて `'actual'`

**進行中の年度（§3.2）**

- [ ] 3月期・取得時点 `2026-10-01`・権利落ちが `2025-09-29`(35) `2026-03-30`(40)
      `2026-09-28`(40) → **FY2027 のレコードを作らない**（FY2026 の 7,500銭のみ）
- [ ] 期間末日ちょうど（3月期・取得時点 `2026-03-31`）は FY2026 を**作る**
- [ ] 取得時点は引数で渡す（`Date.now()` を関数内で読まない。テストできなくなる）

**カバー範囲内の空白年（§3.2）**

- [ ] 権利落ちが 2020年度と 2023年度にしかない → **2021・2022年度は `0`（無配）**
- [ ] 最古の権利落ちより前の年度は**レコードを作らない**（`null` ですらない）
- [ ] 全年度が空白（配当が1件も無い）→ 空配列

**丸めの境界**

- [ ] 丸めた結果 0 銭になる年度 → **`null`**（`0` にしない。§3.4）

**分割をまたぐ継続性（§2.3 で約束した検証）**

- [ ] 9433 の実フィクスチャで、2025年3月の 1:2 分割をまたぐ FY2024〜FY2026 が
      **すべて分割調整後の基準で連続**する（FY2025 が 72.5円、FY2026 が 80円）
- [ ] 1301（併合）の実フィクスチャでも同様に連続する

### 7.1.1. 決算月の導出（`parse-fy-data.ts` の変更分）

- [ ] 年度キーが `2022/03`〜`2026/03` のみ → `fiscalYearEndMonth: 3`
- [ ] 年度キーが `2022/12`〜`2026/12` のみ → `12`
- [ ] **`2025/03` と `2026/12` が混在 → `null`**（決算期変更。推測しない）＋診断を1件出す
- [ ] 年度キーが1件も無い → `null`
- [ ] `null` のとき、配当の集計を行わない（§7.4）
- [ ] 既存の年度パース（`2026/03` → 2026）の挙動は変わらない（回帰）

### 7.2. パース（`parse-chart.ts`）

- [ ] `events.dividends` の**キーではなく `date`** を日付として読む
      （`{"1740754800": {"date": 1743120000}}` → `2025-03-28`）
- [ ] `numerator: 1, denominator: 10`（1301 の併合）を**併合として保持**する
      （`numerator/denominator < 1`）
- [ ] `numerator: 100, denominator: 1`（9433）を分割として保持する
- [ ] `regularMarketTime` が無い応答 → **`priceSen` も `null` にする**（§3.3）
- [ ] `regularMarketPrice` が無い → `priceSen` は `null`、他は返す
- [ ] `longName` が無ければ `shortName`、両方無ければ `name: null`
- [ ] `events` 自体が無い応答（配当実績の無い銘柄）→ 空配列。エラーにしない
- [ ] `chart.result` が空 → `unexpected-shape`
- [ ] `chart.error` が非 `null` → `source-not-found`
- [ ] 実データのフィクスチャ（9433 / 1301）で通す。**手書きの理想形で作らない**
      （`.claude/rules/backend.md`）

### 7.3. 取得（`chart-client.ts`）

- [ ] 銘柄コードが形式違い → 外部へ問い合わせず `invalid-code`
- [ ] 404 → `source-not-found`
- [ ] 429 → `source-unreachable`（**リトライを増やさない**。§5.1）
- [ ] 5xx → 1回だけリトライして、なお失敗なら `source-unreachable`
- [ ] タイムアウト → 1回だけリトライ
- [ ] **テストで実 API を叩かない**（`fetch` を注入する）
- [ ] エラー本文に URL・スタックトレースを含めない（`.claude/rules/backend.md`）

### 7.4. 結線

- [ ] Yahoo の取得に失敗しても、IRバンクの財務データだけで取り込みが成立する
- [ ] 決算月が IRバンクから取れなければ、配当の集計をせず株価だけ入る
- [ ] `priceAsOf` を**表示用文字列に変換する純粋関数**が、UTC の ISO 8601 を
      JST の表記にする（`2026-07-30T06:30:00Z` → `2026年7月30日 15:30`）
- [ ] 同関数は `null` を受けたら「取得時刻不明」相当を返す（空文字にしない）

> ✅ **`dividendAggregated` フィールド**（2026-08-03 決着。ユーザー確定事項）。
> `fiscalYearEndMonth` が `null`（IRバンク未実施のまま Yahoo だけを実行した）ときは
> 配当集計をスキップし、`GET /api/market-data/:code` の応答に `dividendAggregated: false`
> を返す（`true` なら集計を実行した）。FE 側はこの値で
> 「決算月が未取得のため、配当の年度集計は行われませんでした」を通知する
> （`src/usecase/import-market-data.ts` の `MarketDataImportResult.dividendAggregated`、
> `src/handler/dto/market-data-import.ts` の `MarketDataImportResponse.dividendAggregated`）。

> **DOM を組み立てるテストは書けない**（`@testing-library/react` 未導入。
> `tests/frontend/company-form.test.tsx` 冒頭）。したがって「画面に出る」ことは
> 直接検証せず、`import-review.md` §7.4 と同じく**表示を決める純粋関数**で検証する。

## 8. 未決事項

1. ✅ **利用規約**（2026-07-31 決着）。
   [ADR-0010](../../adr/0010-yahoo-chart-endpoint.md) に記録した。
   **個人利用に限る。公開・収益化はしない。** ADR-0008 が Yahoo を却下したのは
   `quoteSummary`（Cookie＋Crumb が要る）の話で、本仕様の `v8/finance/chart` は
   認証不要という違いも同 ADR に明記した

2. ✅ **決算月の取得経路**（2026-07-31 決着）。§3.2 の「決算月をどこから取るか」に
   規則を書いた。`ImportedFinancials` に `fiscalYearEndMonth: number | null` を
   追加し、IRバンクの年度キーの月から導出する。**§9 の実装表に
   `financial-source.ts` / `parse-fy-data.ts` を追加済み**
3. ✅ **③ の予想EPS × 予想配当の年度結合**（2026-07-31 決着）。
   [ADR-0009](../../adr/0009-dividend-single-source.md) の「決定した結合規則」を参照。
   **最新の予想年度で両方が揃わなければ判定不能に倒す。古い年度へフォールバックしない**
4. ✅ **2つの取り込みの実行順とエンドポイントの形状**（2026-08-03 決着）。
   Yahoo は決算月を IRバンクに依存するので「IRバンク → Yahoo」になる。
   エンドポイントは**2本に分ける**（`GET /api/irbank/:code` と
   `GET /api/market-data/:code`）。`fiscalYearEndMonth` は IRバンク取り込みが
   返した値を、フロントがそのまま `GET /api/market-data/:code` のクエリで渡す
   （`src/handler/app.ts` の実装コメントに明記済み）。Yahoo だけを実行したとき
   （`fiscalYearEndMonth` 未指定）は配当の集計をせず株価だけ入れる（§7.4）
5. 🟡 **決算期変更（変則決算）は扱わない。** §3.2 の規則は決算月を**単一スカラー**で
   受け取るため、決算月を変えた企業を表現できない。移行期の変則決算（例: 9か月）は
   12か月枠に収まらず、隣接年度と重複または空白になる。
   **「決算月は全期間一定」と仮定する**（§3.2 のとおり、複数の月が現れたら
   集計せず診断を出す）。T-035 の残り半分はここでは解決しない。
   あわせて、IRバンクの年度キーは直近5期ぶんしか無いため、
   **それより古い年度は「同じ決算月が続いていた」という仮定に立つ**
6. 🟡 **分割の遡及調整。** Yahoo の調整値は**現在の株数を基準に過去へ遡及する**ため、
   新しい分割が起きると過去年度の値がすべて変わる。保存済みデータは旧基準のまま残り、
   [import-review.md](./import-review.md) §5.5 の規則2（「取り込みが `null` のセルは
   既存を残す」）と組み合わさると**新旧基準が同じ系列に混在する**。
   「市場データ取り込み時は配当を全年度置換する」等の規則が要る
7. ✅ **`ImportDiagnostic` に入れる値**（2026-08-03 決着）。`block` は `'配当'` /
   `'株価'`。`column` は `'配当明細'`（配当。集計前の1エントリ単位であることを示す。
   決算年度集計後の `'年間配当'`（`dividend-fiscal-year.ts`）とは別名にして区別する）
   / `'株価'`（株価。複数列が無いため `block` と同じ固定文字列）。`fiscalYearKey` は
   取り込み元・段階によって次の3パターンに分かれる（`financial-source.ts` の
   `ImportDiagnostic.fiscalYearKey` コメントと表現を揃えている）。
   - `column='配当明細'`（集計前・パース診断・`parse-chart.ts`）: 権利落ち日
     （`YYYY-MM-DD`。読めなければ `'unknown'`）
   - `column='年間配当'`（集計後・`dividend-fiscal-year.ts`）: 集計後の決算年度そのもの
     （例: `'2001'`。権利落ち日でも `'unknown'` でもない）
   - `column='株価'`: 決算年度に紐付かないため常に `'unknown'`

   `resolveField`（`import-review.ts:58-67`）は `block='配当'` × `column='一株配当'`
   （IRバンクの1回ごとの単価）しか `dividendYen` に解決しないため、
   **Yahoo 由来の警告（`column='配当明細'`/`'年間配当'`/`'株価'`）は
   IRバンク由来のセル警告と区別できないことを前提に、行外の警告として表示する**
   （区別できないこと自体を問題とせず、行外警告に倒すことをここで決定した）

8. 🟡 **`priceAsOf` をスキーマまで通すか。** 本仕様は取り込み画面での提示までとし、
   `companies` テーブルには保存しない（§3.3）。したがって
   [import-review.md](./import-review.md) §8-3 は塞がらない
9. ✅ **金額を float で持つか整数で持つか**（2026-08-03 決着。案B採用）。
   `DividendPayment.amountYenText` に**未検証の文字列のまま**持ち、決算年度への集計時
   （`toFiscalYearDividends`）にマイクロ円スケール（1/1,000,000円の整数）へ変換してから
   銭へ丸める。`JSON.parse` を経由すると Yahoo の `number`（double）が丸め誤差を持つため、
   infra 側（`parse-chart.ts`）がレスポンス本文（テキスト）から数値リテラルを文字列のまま
   正規表現で抜き出す（`.claude/rules/backend.md` 「浮動小数点で金額計算をしない」）
10. 🟡 **`dividend_records` の主キー衝突。** `(code, fiscalYear, kind)`
    （`schema.ts:75`）なので、同一年度の `'actual'` が IRバンクと Yahoo で衝突する。
    突き合わせ（下記11）を「人が判断」に倒すとしても、**保存時にどちらを書くかは
    決まっている必要がある**
11. 🟡 **配当の突き合わせをするか。** IRバンクと Yahoo の両方から配当が取れるので、
    食い違いを検出できる（§2.3 では一致した）。**食い違ったらどちらを採用するかは
    決めていない。** `import-review.md` の枠組みで「人が判断する」に倒すのが素直
12. 🟡 **銘柄名が英語のみ。** 日本語名がほしいなら手入力を残すか、別の取得元が要る。
    **英語名で自動入力して、ユーザーが上書きできる**形を推奨するが未決
13. 🟡 **`meta.symbol` と要求コードの一致検査**（`code-mismatch` 相当）が無い。
    また §2.1 の実測は数字4桁の4銘柄のみで、`^\d{3}[0-9A-Z]$` が通す
    英字混じりコード（`130A.T`）が Yahoo で引けるか未確認
14. 🟡 **丸め診断が大量に出る。** 100分割銘柄では全年度で `rounded` が出る。
    `import-review.md` §5.3 は「件数に潰さない。1件ずつ出す」なので25件並ぶ。
    表示方針を決めること
15. 🟡 **`suspicious-jump` の裏取り。** 分割イベントが取れるので、
    [import-review.md §4](./import-review.md) の「複数年にまたがった分割は検知できない」
    という既知の限界を解消しうる。急変した年度と分割日を突き合わせ、
    **「これは分割です」と断定できる**ようになる。本仕様の範囲外（段階2）
16. 🟢 **株価の履歴は取らない**（§1.2）。将来チャート表示をするなら再検討
17. ✅ **`splits` の扱い**（2026-08-03 決着。ユーザー確定事項）。
    **参考表示のみ許可する。** スコアリング・自動反映には使わない（用途は上記15）。
    `GET /api/market-data/:code` の応答に `splits` を含め、画面へ表示するためだけに
    保持する。将来の自動反映（分割検知・急変判定への活用）はこの決定の対象外

## 9. 実装（予定）

| 対象                 | ファイル                                                                                     |
| :------------------- | :------------------------------------------------------------------------------------------- |
| ポート               | `src/domain/company/market-data-source.ts`（新規）                                           |
| 決算年度への集計     | `src/domain/company/dividend-fiscal-year.ts`（新規）                                         |
| パース               | `src/infra/yahoo/parse-chart.ts`（新規）                                                     |
| 取得                 | `src/infra/yahoo/chart-client.ts`（新規）                                                    |
| ユースケース         | `src/usecase/import-market-data.ts`（新規）                                                  |
| **決算月の持ち回り** | `src/domain/company/financial-source.ts` / `src/infra/irbank/parse-fy-data.ts`（§3.2）       |
| 結線                 | `src/handler/app.ts` / `src/handler/dto/`（新規DTO） / `frontend/components/CompanyForm.tsx` |
| フィクスチャ         | `tests/fixtures/yahoo/9433.json` / `1301.json`（実物から作る）                               |
| テスト               | `tests/domain/company/dividend-fiscal-year.test.ts` / `tests/infra/yahoo/*.test.ts`          |

**[ADR-0009](../../adr/0009-dividend-single-source.md) の適用分（13ファイル）は
この表に含まない。** 別の差分として先に入れる。

### 着手順

0. **[ADR-0009](../../adr/0009-dividend-single-source.md) を適用する**（配当の一本化）。
   これを飛ばすと ①② は埋まらず、本仕様の主目的が達成できない（§4.3）
1. **決算月の持ち回りを通す**（§3.2「決算月をどこから取るか」）。
   `ImportedFinancials.fiscalYearEndMonth` の追加。§3.2 の集計はこれが無いと動かない
2. §4.2 の集計（`dividend-fiscal-year.ts`）。ネットワーク非依存で単体テストが書ける
3. §5 の取得とパース。フィクスチャは実物から作る
4. 結線（ユースケース・画面）
5. §8-15（`suspicious-jump` の裏取り）は別途

> 規約の判断（[ADR-0010](../../adr/0010-yahoo-chart-endpoint.md)）は記録済みなので、
> 着手順から外した。**外部を叩く実装（上記3）に入る前に同 ADR を読むこと。**
