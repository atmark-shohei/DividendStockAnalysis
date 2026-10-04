# 市場データ取り込み（Yahoo Finance） UI設計書

> F-30（データ入力・解析タブ）への追加機能。ロジック設計は
> [market-data-source.md](../../logic/market-data-source.md) が正。本書は画面配置・
> 表示・エラー時の挙動だけを定義する（`CLAUDE.md`「該当する設計書を読む。無ければ先に書く」）。

## 変更履歴

- **2026-08-03**: 新規作成。実装（`CompanyForm.tsx` へのボタン追加）に先立って書き起こした。

---

## 1. 概要

`/input`（`CompanyForm`）に、Yahoo Finance から株価・配当履歴・株式分割イベントを取り込む
ボタンを追加する。既存の「IRバンクから取り込む」ボタンと並置し、**保存はしない**
（取り込んだ内容はフォームの初期値になるだけ。IRバンク取り込みと同じ方針）。

## 2. 画面配置

`frontend/components/CompanyForm.tsx` の「銘柄」fieldset内、既存の
「IRバンクから取り込む」ボタンの隣に配置する。

```
[銘柄コード入力欄]
[IRバンクから取り込む] [Yahoo Financeから株価・配当を取り込む]
<取り込みに関する注記文>
<IRバンクのエラー/通知>
<Yahooのエラー/通知>  ← IRバンクとは別系統（片方の失敗がもう片方の表示を巻き込まない）
[銘柄名入力欄]
[現在株価（円）入力欄]
```

state・エラー表示・通知表示は IRバンク取り込みと完全に別系統にする（`marketImporting` /
`marketImportError` / `marketImportNotice` 等）。IRバンクと Yahoo は失敗が独立している
（`market-data-source.md` §1.1）ため、片方の失敗表示がもう片方を巻き込んではいけない。

## 3. 実行順序（IRバンク → Yahoo）

`market-data-source.md` §3.2 により、配当の年度集計には決算月
（`fiscalYearEndMonth`）が要り、これは IRバンクの年度キーからしか取れない。

**採用案（案A）: ボタンは常に活性化する。** IRバンク未実施のまま Yahoo だけを押しても
株価・分割イベントは取り込める。配当の年度集計だけができない。

- `CompanyForm` は IRバンク取り込み成功時に返る `fiscalYearEndMonth`
  （`IrBankImportResponse.fiscalYearEndMonth`）を state に保持する
- Yahoo 取り込みボタン押下時、保持している `fiscalYearEndMonth` が非 `null` なら
  `GET /api/market-data/:code?fiscalYearEndMonth=<値>` として渡す。`null`（IRバンク未実施、
  または決算期変更等で決算月が定まらなかった）ならクエリ無しで呼ぶ
- レスポンスの `dividendAggregated` が `false` のとき、通知に次の文言を出す:
  **「決算月が未取得のため、配当の年度集計は行われませんでした
  （先にIRバンクから取り込んでください）」**
- 案B（IRバンク未実施の間 Yahoo ボタンを disabled にする）は不採用。理由: 株価・分割は
  IRバンクに依存せず取得できるため、待たせる必要がない

### 3.1. `IrBankImportResponse` への `fiscalYearEndMonth` 追加（BE側の差分）

実装着手時点で `src/handler/dto/irbank-import.ts` の `IrBankImportResponse` に
`fiscalYearEndMonth` が**含まれていなかった**（`ImportedFinancials.fiscalYearEndMonth` 自体は
既存）。上記の「IRバンクが返した決算月を FE がそのまま Yahoo のクエリへ渡す」という
`src/handler/app.ts` の結線コメントの前提が崩れていたため、DTO 露出漏れとして追加した
（1フィールドの追加のみ。ドメインロジックの変更なし）。

## 4. 連打防止

`marketImporting` 相当の boolean state を導入し、リクエスト中はボタンを `disabled` にする
（IRバンク取り込みの `importing` と同型）。クライアント側の追加スロットリング
（debounce・クールダウン）は実装しない。429（レート制限）は BE 側の責務
（`market-data-source.md` §5.1）。

## 5. 表示するデータ

### 5.1. 株価

- 取得できた場合（`priceSen` が非 `null`）: 「現在株価（円）」欄が**空欄のときだけ**
  取得値で埋める（`fillBlankMultiples` と同じ「手入力を破壊しない」原則）
- 取得できなかった場合（`priceSen: null`）: 欄は触らず、通知に
  「株価は取得できませんでした」を出す
- 観測時刻（`priceAsOf`）: 通知文に併記する。JST 表示への変換は表示層でのみ行う
  （`formatPriceAsOf`）。**保存されるのは `fetchedAt`（保存時刻）だけで、`priceAsOf`
  （観測時刻）は保存されない。** 取り込み画面での一時的な参考情報にとどまる
- `priceAsOf: null` の場合は「取得時刻不明」（`formatPriceAsOf(null)`）

### 5.2. 配当履歴（年度別データ表への反映）

`dividendRecords`（年度・金額の配列）を、年度別データ表の「1株配当」欄へマージする。

**既存の `mergeRowsWithImport` は使えない。** IRバンクの業績データが無い古い年度
（Yahoo は21〜28年ぶん遡る）の配当が消えてしまうため。新規の純粋関数
`mergeDividendYears` を使う（§7 参照）。

- `annualAmountSen: null`（丸めた結果 0 銭 = 判定不能）→ 空文字（`senToEditableText(null)`）
- `annualAmountSen: 0`（カバー範囲内の空白年 = 無配）→ `'0'`（`senToEditableText(0)`）。
  **`null` と `0` を混同しない**
- 対応する業績行が無い年度は、業績欄が空のまま新規行として追加する

### 5.3. 株式分割イベント

`splits`（日付・`numerator`・`denominator` の配列）を**参考情報として表示する**。

- 「この情報は自動反映されません（分割による過去の配当・株価の遡及調整は
  取り込み結果に反映済みですが、年度別データ表の既存の入力値は自動で調整しません）」
  という趣旨の注記を必ず添える
- `numerator / denominator > 1` を「分割」、`< 1` を「併合」として文言に出す
  （`market-data-source.md` §3.5 の解釈をそのまま使う。文字列 `splitRatio` はパースしない）
- 表示形式: 箇条書き（`<ul>`）。0件なら何も表示しない

### 5.4. 銘柄名

`name`（英語名のみ、取れなければ `null`）を、**「銘柄名」欄が空欄のときだけ**入れる
（`fillBlankMultiples` と同じ「手入力を破壊しない」原則）。英語名であることを
入力欄の近くの注記に明記する。取れなかった場合（`null`）は何もしない。

### 5.5. 取得診断（`diagnostics` / `dividendDiagnostics`）

IRバンクと同じ「1件ずつ列挙・件数に潰さない」パターンを踏襲する
（`rowlessWarningText` 相当）。折りたたみ等の新規UIは作らない。

- `diagnostics`: 株価・分割の取得診断
- `dividendDiagnostics`: 配当の年度集計時の診断（`rounded` = 丸め、`unsafe-integer` = 安全整数超過）

診断は IRバンクの `CellWarning`（`field`・`valueKept` を持つ）とは異なる形状
（`ImportDiagnostic`: `block` / `fiscalYearKey` / `column` / `reason` / `raw`）で返る。
本機能では画面のセルへの解決（`resolveCellWarnings` 相当）を行わず、`rowlessWarningText`
と同じ体裁のリストとして表の外に出す（`market-data-source.md` §8-7 が「Yahoo由来の警告が
IRバンク由来のセル警告と区別できない」ことを未決事項として残しており、本機能では
セル単位の警告に解決しない方針を採る）。

## 6. エラー時の挙動

`api.ts` の `request()` の既存エラーハンドリングをそのまま使う。BE の
`toMarketDataErrorResponse`（`src/handler/dto/market-data-import.ts`）が返す
`error` 文言をそのまま表示する（IRバンクの `toIrBankErrorResponse` と同じパターン）。

| HTTP | 発生条件 | 表示文言（BE由来） |
| :--- | :--- | :--- |
| 400 | 銘柄コード形式不正 / `fiscalYearEndMonth` 不正 | 「銘柄コードの形式が不正です」等 |
| 404 | 銘柄が見つからない | 「指定された銘柄のデータが見つかりませんでした」 |
| 502 | 429・タイムアウト・パース失敗等 | 「市場データの取得に失敗しました。時間をおいて再試行してください」 |

## 7. `mergeDividendYears`（純粋関数）

```ts
export interface MergeDividendYearsResult {
  readonly rows: readonly YearRow[];
  readonly overwrittenCount: number;
}

export function mergeDividendYears(
  existingRows: readonly YearRow[],
  dividendYears: readonly { fiscalYear: number; annualAmountSen: number | null }[],
): MergeDividendYearsResult;
```

`mergeRowsWithImport` と同じ「手入力を破壊しない・行の同一性は年度だけで決める」設計方針を
踏襲するが、業績列を伴わない行の新規追加に対応する点が異なる。`CompanyForm.tsx` から
named export し、DOM を組み立てられない制約下でもテストできるようにする
（`@testing-library/react` 未導入。§8 参照）。

## 8. テスト方針

**DOM を組み立てるテストは書けない**（`@testing-library/react` 未導入）。表示ロジックは
「表示を決める純粋関数」に切り出し、`.tsx` から named export してテストする既存パターンを
踏襲する（`tests/frontend/company-form.test.tsx`）。

## 9. 関連ドキュメント

- [market-data-source.md](../../logic/market-data-source.md) — ロジック設計（正）
- [screen-list.md](../screen-list.md) — 画面一覧
- [pages/criteria-tab.md](./criteria-tab.md) — 同形式の参考例
- [import-review.md](../../logic/import-review.md) — IRバンク取り込みの警告表示パターン（本機能が踏襲する元）
