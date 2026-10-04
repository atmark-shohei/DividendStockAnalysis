# ADR-0009: 配当の二重管理を解消し `DividendRecord` に一本化する

- ステータス: ✅ 採用・実装済み（2026-07-31）
- 日付: 2026-07-31
- 関連: [market-data-source.md](../02_design/logic/market-data-source.md)、
  [dividend-yield-scoring.md](../02_design/logic/dividend-yield-scoring.md) §2.1、
  `/review-spec` によるレビュー（2026-07-31）、T-035

## 背景

**1株配当が2つの型に重複して保持されている。**

| 保持先                                  | 型                                          | 読んでいる指標                                   |
| :-------------------------------------- | :------------------------------------------ | :----------------------------------------------- |
| `Company.records[].dividendPerShareSen` | `FinancialRecord`（`company.ts:32`）        | **① 増配率 / ② 連続非減配年数 / ③ 予想配当性向** |
| `Company.dividends[].annualAmountSen`   | `DividendRecord`（`dividend-record.ts:32`） | **⑩ 配当利回り**                                 |

画面の年度別テーブルの「1株配当」列が、`handleSubmit` で**両方に同じ値を流し込んで
いる**（`CompanyForm.tsx:524-537`）。DB も `financial_records.dividend_per_share_sen` と
`dividend_records.annual_amount_sen` の両方に同じ値を持つ。同じ入力から作られるので
**今は食い違わず、誰も問題に気づいていなかった**。

これが表面化したのは [market-data-source.md](../02_design/logic/market-data-source.md)
のレビュー（`/review-spec`、2026-07-31）である。同設計書は Yahoo Finance から
**21〜28年ぶんの配当履歴**を取得して「①② が埋まる」と主張していたが、
返す型が `DividendRecord[]` だったため、**実際には ⑩ にしか効かない**ことが判明した。
①② は `seriesOf(company, (record) => record.dividendPerShareSen, 19)`
（`score-company.ts:69`）＝ `FinancialRecord` 側を読んでいる。

二重管理は「気づかないうちに片方だけ更新される」形で必ず壊れる。実際、
市場データ取り込みを入れると**取得元が別々になる**（配当履歴は Yahoo、
財務諸表は IRバンク）ため、二重管理のまま進めると食い違いが常態化する。

## 決定

**配当は `DividendRecord` に一本化する。`FinancialRecord.dividendPerShareSen` を廃止する。**

1. `FinancialRecord` から `dividendPerShareSen` を削除する
2. `financial_records.dividend_per_share_sen` カラムを削除する（マイグレーション）
3. **①②③ の入力を `DividendRecord` に切り替える**
4. 画面の年度別テーブルの「1株配当」列は**残す**。流し込み先を `dividends` だけにする

### なぜ `DividendRecord` 側に寄せるか

**意味論的にこちらが正しい。** ② 連続非減配年数は18年前まで遡る「配当履歴」の
関心事であって、財務諸表の1項目ではない。`DividendRecord` は `kind`
（`forecast` / `revised` / `actual`）という**配当固有のライフサイクル**を持っており、
`FinancialRecord.dividendPerShareSen` はその denormalize されたコピーにすぎない。

また、`FinancialRecord` に寄せると**19年ぶんの「財務レコード」のうち配当列だけが
埋まり、EPS・ROE・売上高がすべて空**という歪んだ行が大量に生まれる。

## 検討した代替案

- **案A: `FinancialRecord` 側に寄せる**（Yahoo の配当を年度テーブルの「1株配当」列に
  マージし、既存の分岐で両方を埋める） — 却下。採点ロジックに触れずに済み、
  `mergeRowsWithImport` を再利用でき、**データが画面に見えて直せる**という
  大きな利点があった（[import-review.md](../02_design/logic/import-review.md) の
  「人が判断する」原則と一致する）。しかし二重管理を温存するため、
  取得元が分かれた後に必ず食い違う。**今回の問題を先送りするだけ**と判断した
- **案B: ①② だけ `DividendRecord` に切り替え、③ は据え置く** — 却下。
  ③ だけが `FinancialRecord` の配当を読む状態が残り、二重管理が中途半端に生き残る
- **案C: 何もしない**（`market-data-source.md` の主張を「⑩ が改善する」に弱める）
  — 却下。②（現状どうやっても埋まらない指標）が埋まることが市場データ取り込みの
  主目的であり、それを諦めると導入の意義が大きく減る

## 結果・影響

### 影響範囲（実測: 13ファイル・約43箇所）

| 層       | ファイル                                        | 変更                                       |
| :------- | :---------------------------------------------- | :----------------------------------------- |
| domain   | `company/company.ts`                            | `FinancialRecord.dividendPerShareSen` 削除 |
| domain   | `company/dividend-record.ts`                    | 年度整列（下記）を追加                     |
| usecase  | `score-company.ts`                              | ①②③ の入力を差し替え                       |
| infra    | `d1/schema.ts` + マイグレーション               | カラム削除                                 |
| infra    | `d1/company-repository.ts`                      | 読み書き                                   |
| infra    | `irbank/parse-fy-data.ts`                       | `records` に配当を積むのをやめる           |
| handler  | `dto/company-input.ts` / `dto/irbank-import.ts` | DTO                                        |
| frontend | `components/CompanyForm.tsx`                    | `records.push` から配当を外す              |
| tests    | 5ファイル                                       | 期待値                                     |

### 新たに必要になるもの

1. **`DividendRecord` 用の年度整列。** ①② は「添字＝何年前」を前提にしている。
   `seriesOf`（`company.ts:120`）が `FinancialRecord` に対してやっていること
   （最新の実績年度から1年刻みで枠を作り、無い年は `null` を置く）と同じものが
   `DividendRecord` 側に要る。**単に `map()` すると欠損年で添字が詰まり、
   ①の「5年前」が実際には7年前になる。**
   実績のみを対象にする（`kind === 'actual'`）

2. **③ の予想EPSと予想配当の年度突き合わせ。**
   現在は `latestForecastRecord(company)` が返す**1つのレコードから両方**を取るので、
   同一年度であることが構造的に保証されている（`score-company.ts:90-93`）。
   一本化後は予想EPSが `FinancialRecord`、予想配当が `DividendRecord` と
   **別の型に分かれる**ため、年度で結合する必要が生じる。
   **年度が揃わないまま割ると「今期予想EPS ÷ 別年度の予想配当」になり、
   配当性向が静かに誤る。** → 下記「決定した結合規則」で決着（2026-07-31）

### 決定した結合規則（③ 予想配当性向）

> **基準年度 = 予想EPS または 予想配当の、どちらかが存在する最大の年度。
> その年度で両方が揃わなければ `null`（判定不能）。
> 古い年度へフォールバックしない。**

- 予想EPS: `FinancialRecord` の `isForecast === true`
- 予想配当: `DividendRecord` の `kind === 'forecast' | 'revised'`
  （`revised` は予想の更新版なので優先。`dividend-record.ts:49` の `KIND_PRIORITY` と同じ）

**フォールバックしない理由。** 「今期の予想EPS ÷ 前期の予想配当」は算術としては
成立するが意味を成さない。しかも画面には「予想」としか出ないので、
**いつ時点の値か分からないまま配当性向だけが表示される**。

これは ⑩ が T-049（2026-07-27）で同じ理由から採った設計と一致する
（[dividend-yield-scoring.md](../02_design/logic/dividend-yield-scoring.md) §2.1
「年度を見ずに予想を一律優先すると、FY2019 の予想が FY2024 の実績を上書きし、
画面には『予想』とだけ出るのでいつ時点の値か分からない」）。

**受入基準（実装時に踏むこと）**

- [ ] 予想EPS(FY2027) と 予想配当(FY2027) が揃う → FY2027 で採点
- [ ] 予想EPS(FY2027) はあるが予想配当が FY2026 にしか無い → **`null`**（FY2026 に落ちない）
- [ ] 予想配当(FY2027) はあるが予想EPSが FY2026 にしか無い → **`null`**
- [ ] 同一年度に `forecast` と `revised` の両方 → **`revised` を採用**
- [ ] 予想がどちらも無い → `null`

### データ移行

**既存データの移行は不要。** `dividend_records` には既に同じ値が入っており
（画面が両方に流し込んでいるため）、`financial_records.dividend_per_share_sen` を
削除するだけでよい。ただし**移行前に、既存レコードで両者が実際に一致しているかを
確認する**こと（一致しない行があれば、それ自体が二重管理が既に壊れていた証拠になる）。

### 副次的な効果

- T-035（株式分割・決算期変更をどの層で吸収するか。🔴 未決）の議論が単純になる。
  調整対象が1箇所になるため、「どの層で調整するか」の答えが配当履歴1本に絞られる
- ⑩ の `selectAnnualDividend` はそのまま使える（変更不要）

## 未解決のまま残すこと

1. 🟡 **年度テーブルに出ない配当年度の扱い。** 一本化後、Yahoo 由来の19年ぶんの
   配当は `dividends` にだけ入り、画面の年度別テーブル（既定7行）には現れない。
   **見えないデータが採点を左右する**のは
   [import-review.md](../02_design/logic/import-review.md) の原則に反する。
   表示方法（行を増やす / 別の一覧を出す / 折りたたむ）は未決
2. 🟡 **実施順序。** 本 ADR の適用と市場データ取り込みの実装のどちらを先にするか。
   市場データ取り込みは本 ADR に依存するので、**本 ADR が先**が素直だが、
   単独で実施すると「二重管理を消しただけで機能が増えない差分」になる
