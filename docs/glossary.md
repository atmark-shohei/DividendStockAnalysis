# ユビキタス言語 用語集

コード内の型名・関数名はこの用語集の英語名をそのまま使う。新しい概念はまずここに追加する。

> **スコアの数値・閾値の正は `docs/01_requirements/scoring-requirements.md`（SSoT）。**
> 本ファイルは**名前と概念の正**であり、閾値そのものは重複させない。
>
> 2026-07-28 更新: `.claude/docs/glossary.md` からここへ移動し、実装の実態に合わせた
> （`docs/glossary-update-proposal.md` の提案を適用）。`.claude/` は Claude 向けの
> 設定（規約・agents・skills）だけを置く場所とする。

## 会社・財務

| 日本語           | 英語（コード名）             | 種別             | 定義                                                                                                                                                                                                             |
| ---------------- | ---------------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 会社             | `Company`                    | 集約ルート       | スコアリング対象の企業。財務レコード・配当履歴・貸借対照表・市場指標を保持する                                                                                                                                   |
| 財務レコード     | `FinancialRecord`            | エンティティ     | 1年度ぶんの生データ（EPS・ROE・売上高・営業利益率・1株配当）。**年度降順**で持つ                                                                                                                                 |
| 整形指標         | `TransformedMetric`          | エンティティ     | 財務レコードから計算された指標（CAGR・平均等）。計算時点の値と計算バージョンを保存する                                                                                                                           |
| 年度             | `FiscalYear`                 | 値オブジェクト   | 決算年度。2024年3月期なら 2024                                                                                                                                                                                   |
| 銭               | `Sen`                        | 値オブジェクト   | 金額の最小単位。1円 = 100銭。**金額は必ずこの整数で扱い、浮動小数点にしない**                                                                                                                                    |
| 配当レコード     | `DividendRecord`             | エンティティ     | 1年度ぶんの配当。**額が `null` は「データなし」で、無配（0）とは別物**                                                                                                                                           |
| 配当区分         | `DividendRecordKind`         | 値オブジェクト   | `forecast`（予想）/ `revised`（修正）/ `actual`（実績）。修正は予想の更新版                                                                                                                                      |
| 採用配当         | `SelectedDividend`           | 値オブジェクト   | 利回り計算に採用した年間配当と、その採用元                                                                                                                                                                       |
| 配当の採用元     | `DividendSource`             | 値オブジェクト   | `forecast` / `actual`。**画面に必ず併記する**                                                                                                                                                                    |
| 貸借対照表       | `BalanceSheetSnapshot`       | 値オブジェクト   | ⑥ が使う流動資産・投資有価証券・負債総額・前期末配当総額                                                                                                                                                         |
| 市場指標         | `MarketMultiples`            | 値オブジェクト   | ⑨ が使う PER（会社予想）と PBR（実績）                                                                                                                                                                           |
| 取り込み金額     | `ImportedAmount`             | 値オブジェクト   | IRバンク取り込みで得た金額と、それがどの決算年度の値かの組（`valueSen` / `fiscalYear`）。⑥ の負債総額・前期末の配当総額の取り込みに使う。保存はしない（`docs/02_design/logic/balance-sheet-derivation.md` §2.3） |
| 実績配当         | `ActualDividend`             | 値オブジェクト   | ③ 実績側が実績EPSと年度を突き合わせるための実績配当（`fiscalYear` / `amountSen`）。`ForecastDividend` の対（2026-08-06 追加）                                                                                    |
| 最新実績レコード | `latestActualRecord`         | ドメインサービス | `Company.records` から最新の実績（`isForecast: false`）レコードを返す。`latestForecastRecord` の対                                                                                                               |
| 実績配当の選択   | `selectLatestActualDividend` | ドメインサービス | 配当履歴（`DividendRecord[]`）から実績（`kind: 'actual'`）のうち最新年度のものを選ぶ。`selectLatestForecastDividend` の対                                                                                        |

## 市場データ（Yahoo Finance）

> 仕様の正: `docs/02_design/logic/market-data-source.md`。IRバンク（`FinancialSource`）とは
> 別の外部データ源ポート。決算月（`fiscalYearEndMonth`）は IRバンク経由で受け渡す。

| 日本語           | 英語（コード名）        | 種別             | 定義                                                                                                                                                                                                             |
| ---------------- | ----------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 市場データ       | `MarketData`            | 値オブジェクト   | Yahoo から取り込んだ株価・配当履歴（権利落ちベース）・株式分割の1銘柄分。決算年度への集計はしない                                                                                                                |
| 市場データ源     | `MarketDataSource`      | ポート           | Yahoo から `MarketData` を取り込む。定義は domain、実装は `src/infra/yahoo/`                                                                                                                                     |
| 市場データエラー | `MarketDataError`       | 値オブジェクト   | 取り込みが成立しなかった理由の判別ユニオン（`kind` で判別）                                                                                                                                                      |
| 配当支払い       | `DividendPayment`       | 値オブジェクト   | 権利落ちベースの1回分の配当。**`amountYenText` は未検証の文字列表現**（`JSON.parse` の丸め誤差を避けるため数値化しない）。`DividendRecord.annualAmountSen`（検証済み・銭単位の年度合計）とは別物。混同しないこと |
| 分割イベント     | `SplitEvent`            | 値オブジェクト   | 株式分割・併合。`numerator`/`denominator` をそのまま保持する。**参考表示のみ**。スコアリング・自動反映には使わない（§8-17）                                                                                      |
| 決算年度への集計 | `toFiscalYearDividends` | ドメインサービス | `DividendPayment[]` を決算月（`fiscalYearEndMonth`）ごとの `DividendRecord[]` へ集計する純粋関数。円→銭の変換もここで行う                                                                                        |
| 決算月           | `fiscalYearEndMonth`    | 値オブジェクト   | 決算月（1〜12）。`ImportedFinancials` のフィールド。IRバンクの年度キーから導出し、Yahoo 側の集計に受け渡す。単一に定まらなければ `null`                                                                          |
| 株価の観測時刻   | `priceAsOf`             | 値オブジェクト   | 株価が観測された時刻。**保存されるのは `fetchedAt`（取得時刻）のみで、`priceAsOf` 自体は保存されない一時的な参考情報**。画面表示のみに使い、`FinancialRecord` 等へ永続化しない                                   |

## EDINET財務履歴データ取り込み

> 仕様の正: `docs/02_design/logic/edinet-history-import.md`。IRバンク（`FinancialSource`）・
> Yahoo（`MarketDataSource`）とは別の外部データ源ポート。④⑦が要求する「6期以上前」の
> EPS・売上高、⑥が要求する流動資産・投資有価証券を補完する。

| 日本語                     | 英語（コード名）                | 種別           | 定義                                                                                                     |
| -------------------------- | -------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------- |
| EDINET履歴取得源           | `EdinetHistorySource`            | ポート         | EDINET有価証券報告書から④⑦用の年度別EPS・売上高、⑥用の貸借対照表項目を取得する。定義はdomain、実装は`src/infra/edinet/` |
| EDINET年度別データ         | `EdinetHistoryYear`              | 値オブジェクト | 1年度ぶんのEDINET由来EPS・売上高（銭）と出所docID                                                        |
| EDINET貸借対照表スナップショット | `EdinetBalanceSheetSnapshot`  | 値オブジェクト | ⑥用。前期末時点の流動資産・投資有価証券（銭）と出所docID                                                 |
| EDINET履歴取得結果         | `EdinetHistoryResult`            | 値オブジェクト | `EdinetHistorySource.fetchHistory`の戻り値。年度別データ最大6件・遡及修正フラグ・貸借対照表を持つ         |
| docIDインデックスの1件     | `EdinetDocumentIndexEntry`       | 値オブジェクト | `(companyCode, fiscalYear)` → `docId`の対応。`documents.json`の`secCode`から`companyCode`へ変換して保存する |
| docIDインデックス読み取り  | `EdinetDocumentIndexLookup`      | ポート         | `fetchHistory`が読むだけの窓口。`findDocId`（特定年度）・`findLatest`（最新年度）を持つ                   |
| docIDインデックス永続化    | `EdinetDocumentIndexRepository`  | ポート         | 日次バッチが書き込む窓口。`upsertMany`・`lastRefreshedAt`・`recordRefresh`を持つ。定義はdomain、実装はD1  |
| 書類一覧取得源             | `EdinetDocumentsListSource`      | ポート         | 日次バッチ（`refresh-edinet-document-index`）が使う、指定日の書類一覧取得ポート。フィルタ・変換済みのdomain型を返す |
| 遡及修正フラグ             | `historyRestated`                | 値オブジェクト | `EpsCagrInput`/`RevenueCagrInput`の入力。`true`なら`unavailable('restated-history')`に倒す               |
| ④用遡及修正フラグ          | `epsHistoryRestated`             | 値オブジェクト | `Company`のフィールド。EDINET取り込みの重複4期突き合わせで検出。既定`false`（EDINET未実施）              |
| ⑦用遡及修正フラグ          | `revenueHistoryRestated`         | 値オブジェクト | 同上（売上高）                                                                                            |
| データ出所（明細）         | `sourceDocId`                    | 値オブジェクト | `financial_records`の1行がどの有報（docID）由来かを示す。IRバンク・手入力由来なら`NULL`。現状書き込み経路なし（CR-4スコープ外） |
| データ出所（貸借対照表）   | `bsSourceDocId`                  | 値オブジェクト | `companies`テーブル。⑥用`currentAssetsSen`/`investmentSecuritiesSen`の出所。同上                          |
| 遡及修正による判定不能     | `'restated-history'`             | 値オブジェクト | `UnavailableReason`の新種別。④⑦専用。EDINETの重複4期が一致せず系列の連続性が保証できない                  |
| 履歴取り込み               | `importEdinetHistory`            | ユースケース   | `EdinetHistorySource`への薄い委譲。**保存はしない**（取得のみ）                                           |
| docIDインデックス再構築    | `refreshEdinetDocumentIndex`     | ユースケース   | 日次バッチ本体。`documents.json`を走査し`EdinetDocumentIndexRepository.upsertMany()`を呼ぶ               |
| EDINETフィルング突き合わせ | `mergeEdinetFilings`             | ドメインサービス | 最新有報＋1年前有報の重複4期を突き合わせ、6期分の年度別データと遡及修正フラグを組み立てる純粋関数        |
| パース結果キャッシュの1件           | `EdinetDocumentSummary`          | 値オブジェクト | 有報1本（`docId`単位）のパース結果。`ParsedSummaryCsv`と同じ形（④⑤⑥⑦用のEPS・売上高・ROE・貸借対照表・診断）。定義は`src/infra/edinet/document-summary-cache.ts`。**T-054で`operatingIncomeSenByOffset`（⑧用、長さ2固定）を追加済み** |
| パース結果キャッシュ                | `EdinetDocumentSummaryCache`     | ポート         | `docId`をキーに`EdinetDocumentSummary`を読み書きする。**`docId`は不変文書の識別子なのでTTL・無効化を持たない**。定義・実装ともinfra（domainを経由しない。§4.8.2）。`find`/`save`とも読み書き失敗を`throw`せず`null`/無視で吸収する契約 |
| パース結果キャッシュ実装（D1）      | `D1EdinetDocumentSummaryCacheRepository` | 実装（infra/d1） | `EdinetDocumentSummaryCache`のD1実装。テーブルは`edinet_document_summary`（`doc_id`主キー）。壊れた/旧版の行は`schema_version`不一致または形チェック失敗として`null`（ミス扱い）を返す |
| キャッシュ形の版                    | `schema_version`                 | 値オブジェクト | `edinet_document_summary`のカラム。次のいずれかを変更したら必ず上げる: `EdinetDocumentSummary`の形／候補要素IDリストの変更／単位検証ロジックの変更／数値パースロジックの変更（詳細は`docs/02_design/logic/edinet-history-import.md` §4.8.3）。不一致の行はキャッシュミス扱い（`CURRENT_SCHEMA_VERSION`） |
| パース結果キャッシュ全削除（管理用）| `POST /api/admin/edinet/document-summary-cache/clear` | APIエンドポイント | `edinet_document_summary`を全行削除する管理用エンドポイント。`schema_version`の上げ忘れに対する保険。認証は`edinetIndexAdmin`と同じ`X-Admin-Token`パターン。応答`{ cleared: number }`（設計書に記載の無い実装判断。要ドキュメント反映） |

## スコアリング

| 日本語               | 英語（コード名）           | 種別             | 定義                                                                                                                                                                                                            |
| -------------------- | -------------------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 指標                 | `MetricKey`                | 値オブジェクト   | スコアリング対象の指標の種類（①〜⑩）。**ちょうど10種**                                                                                                                                                          |
| CAGR                 | `cagrPercent`              | 計算             | 年平均成長率。基本形は `(終値/始値)^(1/年数)-1`。始値≦0・年数0は計算不能。**始値・終値の取り方は指標ごとに異なる**（④ は中央値、①⑦ は端点）                                                                     |
| スコア               | `Score`                    | 値オブジェクト   | **0〜10 の整数**。整形指標を区分表で判定した結果                                                                                                                                                                |
| 指標スコア           | `MetricScore`              | 値オブジェクト   | 1指標の判定結果。**「点数」と「判定不能＋理由」を型で排他にした判別可能ユニオン**。両方が同時に立つ形は型エラーになる                                                                                           |
| 判定不能理由         | `UnavailableReason`        | 値オブジェクト   | 計算できなかった理由。**「計算不能」と「計算した結果が 0点」を区別するために持つ**                                                                                                                              |
| 区分                 | `ScoreBand`                | 値オブジェクト   | 点数1つ分の範囲。`minInclusive`（含む）/ `maxExclusive`（含まない）/ `points`。最上位区分のみ上限が開く                                                                                                         |
| スコア閾値           | `ScoreThreshold`           | 値オブジェクト   | **11段階（0〜10点）を作る境界値10個。** 区分の解釈は**下限以上・上限未満**（§0.1）。③ だけは 10段（1点が無い）                                                                                                  |
| デフォルト閾値       | `DefaultThreshold`         | 値オブジェクト   | システム標準の閾値。`src/domain/scoring/bands.ts` の定数がその実体                                                                                                                                              |
| スコアリング         | `buildScoreCard`           | ドメインサービス | 整形指標×閾値→全指標のスコアを算出する。**総合点と有効指標数の算出もここ**（表示層で合算しない）                                                                                                                |
| 総合点               | `TotalScore`               | 値オブジェクト   | 全10指標の合算。**判定不能は 0点として合算し、分母は常に 100**（§0.5）                                                                                                                                          |
| 有効指標数           | `EffectiveMetricCount`     | 値オブジェクト   | 判定できた指標の数。**総合点の隣に必ず併記する**（例「有効 8/10」）                                                                                                                                             |
| スコアカード         | `ScoreCard`                | read model       | 1社分の全指標スコア一覧。レーダーチャートの入力                                                                                                                                                                 |
| 計算バージョン       | `calcVersion`              | 値オブジェクト   | 整形指標を計算したロジックの版。**閾値・計算式を変えたら必ず上げる**（再監査のため）                                                                                                                            |
| ③ 配当性向の入力     | `PayoutRatioInput`         | 値オブジェクト   | ③ の入力。予想・実績それぞれの片側入力（`PayoutRatioSideInput`）と `useActualForScoring` の組（2026-08-06 §7 で予想単独から拡張）                                                                               |
| ③ 配当性向の片側入力 | `PayoutRatioSideInput`     | 値オブジェクト   | ③ の予想・実績どちらの組にも使う片側の入力（`dividendSen` / `epsSen`）                                                                                                                                          |
| ③ 配当性向の判定結果 | `PayoutRatioResult`        | 値オブジェクト   | ③ の判定結果。採点に採用した出所 `source`（`forecast` / `actual` / `null`）と、予想・実績それぞれの `MetricScore`（`forecast` / `actual`）を採点への採用と無関係に常に持つ判別可能ユニオン                      |
| ③ 配当性向の変換     | `payoutRatioToMetricScore` | ドメインサービス | `PayoutRatioResult` を全指標共通の `MetricScore` に変換する（⑩ `dividendYieldToMetricScore` に相当）。両方判定不能なら予想側の理由を優先し、無ければ実績側の理由にフォールバックする                            |
| ③ の採用元           | `payoutRatioSource`        | 値オブジェクト   | ③ が採点に採用した出所（`forecast` / `actual` / `null`）。⑩ `dividendSource` と同じ発想で画面に併記する（`CompanyScoring` / `ScoringResponse` のフィールド）                                                    |
| ③ 予想側の内訳       | `payoutRatioForecast`      | 値オブジェクト   | ③ 予想側の判定結果（`MetricScore`）。採点への採用と無関係に常に返す（表示用。`CompanyScoring` / `ScoringResponse` のフィールド）                                                                                |
| ③ 実績側の内訳       | `payoutRatioActual`        | 値オブジェクト   | ③ 実績側の判定結果。同上                                                                                                                                                                                        |
| ③ 内訳の画面向け型   | `PayoutRatioSideView`      | DTO              | `ScoringResponse` の `payoutRatioForecast` / `payoutRatioActual` に使う画面向け型。`MetricScore` の内訳（`score` / `value` / `unavailableReason`）を DTO 形に落としたもの（`src/handler/dto/company-input.ts`） |
| 実績優先フラグ       | `useActualForScoring`      | 値オブジェクト   | ③ の採点に実績を強制採用するか。`true` なら実績が判定不能でも予想へフォールバックしない。既定 `false`。**リクエスト単位の一時指定で永続化しない**（`UserScoringPolicy` 未導入のため。設計書 §7 決定5）          |

## 🔴 未決（決着するまでコードで使わない）

認証の要否（T-003 / T-004）が未決のため、以下は**まだ実装に登場させない**。
単一ユーザーに決まった場合、この3語は不要になる。

| 日本語           | 英語（コード名）    | 種別       | 定義                                                   |
| ---------------- | ------------------- | ---------- | ------------------------------------------------------ |
| スコアリング方針 | `UserScoringPolicy` | 集約ルート | ユーザーごとの閾値上書き設定。未設定指標はデフォルトへ |
| マスターユーザー | `MasterUser`        | ロール     | 会社データ・デフォルト閾値を管理できるユーザー         |
| 一般ユーザー     | `Viewer`            | ロール     | 閲覧と自分の閾値上書きができるユーザー                 |

## 命名で使わない語（禁止シノニム）

- `Boundary`, `Limit` → `ScoreThreshold` に統一
- `ProcessedData`, `NormalizedData` → `TransformedMetric` に統一
- `Rank`, `Grade`, `Rating` → `Score` に統一
- `Firm`, `Corporation` → `Company` に統一
- `Yen`, 単独の `Amount` → 金額は `Sen` に統一。円で持たない

> 遵守状況（2026-07-28 実測）: `src/` 全体で違反 **0件**。
