# 予想配当性向 スコアリング 仕様書（指標③）

> **スコア表の原典:** [scoring-requirements.md](../../01_requirements/scoring-requirements.md) の指標③（SSoT）
> **出典の相違と決定:** [scoring-source-comparison.md](../../01_requirements/scoring-source-comparison.md)
> 参考資料との差分と、それに対する決定は §8 にある。
> **実績配当性向の追加とソース切替の決定は §7 にある（2026-08-06）。**

## 1. 概要

- **分類:** 増配余力

今期予想の当期純利益（EPS）に対する配当金の割合。**低いほど増配余力が大きい**と判断し
高得点になる。

> ⚠️ **2026-08-06 追記。** 外部サイト（Yahoo!ファイナンス等）の「配当性向」は
> **直近実績ベース**であることが多く、当システムの予想ベースの値とは一致しない
> （§7 参照）。表示不備ではなく指標の定義差であるため、実績側の値も算出・表示した上で、
> **どちらをスコアリングに使うかをユーザーが選べる**ようにする。

## 2. 入出力

**入力**

`forecast`（予想）と `actual`（実績）を同じ形の組で受け取り、どちらを採点に使うかを
`useActualForScoring` で指定する。

| 項目                   | 型               | 単位       | 備考                                                              |
| :--------------------- | :--------------- | :--------- | :---------------------------------------------------------------- |
| `forecast.dividendSen` | `number \| null` | 銭（整数） | 今期予想の1株配当                                                 |
| `forecast.epsSen`      | `number \| null` | 銭（整数） | 今期予想の1株利益。**負（赤字）がありうる**                       |
| `actual.dividendSen`   | `number \| null` | 銭（整数） | 直近実績の1株配当                                                 |
| `actual.epsSen`        | `number \| null` | 銭（整数） | 直近実績の1株利益。**負（赤字）がありうる**                       |
| `useActualForScoring`  | `boolean`        | —          | `true` なら実績を採点へ強制採用する（画面のチェックボックス。§7） |

**出力**

| 項目       | 型                                    | 単位         | 備考                                                       |
| :--------- | :------------------------------------ | :----------- | :--------------------------------------------------------- |
| `score`    | `number \| null`                      | —            | **採点に採用した**値の 0〜10 の整数。判定不能なら `null`   |
| `value`    | `number \| null`                      | %（実数）    | 採点に採用した配当性向。表示用                             |
| `source`   | `'forecast' \| 'actual' \| null`      | —            | どちらを採点に採用したか。両方判定不能なら `null`          |
| `forecast` | `{ score, value, unavailableReason }` | `value` は % | 予想側の判定結果。**採点採用と無関係に常に返す**（表示用） |
| `actual`   | `{ score, value, unavailableReason }` | `value` は % | 実績側の判定結果。同上                                     |

> `value` / `forecast.value` / `actual.value` はいずれも**配当性向（%）**。丸めていない生値
> （[dividend-yield-scoring.md](./dividend-yield-scoring.md) §2.2 と同じ
> 「判定は生値、表示のみ丸める」原則。表示層で丸めるのは1箇所だけ）。

> **金額は銭単位の整数で受け取り、途中で浮動小数点に落とさない。**
> 比率の算出でのみ小数を使い、**丸めるのは表示層の1箇所だけ**。

> ⚠️ **「今期予想の」「直近実績の」がそれぞれ同一年度であることは、呼び出し側の責務になる。**
> [ADR-0009](../../adr/0009-dividend-single-source.md)（配当を `DividendRecord` に
> 一本化）により、EPS（`FinancialRecord`）と配当（`DividendRecord`）は別の型に分かれている。
> **予想・実績それぞれ、最新の年度で両方が揃わなければ判定不能に倒し、
> 古い年度へフォールバックしない**（同 ADR「決定した結合規則」を実績側にも適用する）。
> 実績側の年度突き合わせには、予想側の `latestForecastRecord` /
> `selectLatestForecastDividend` に対応する **`latestActualRecord(company)`
> （新規）と `selectLatestActualDividend(company.dividends)`（新規）** を使う
> （`src/domain/company/company.ts` / `dividend-record.ts`）。年度が揃わなければ
> その側の `dividendSen` / `epsSen` に `null` を渡す。

## 3. 計算式

$$\text{配当性向 (\%)} = \left( \frac{\text{1株配当}}{\text{EPS}} \right) \times 100$$

**予想・実績で同じ式を、それぞれの組（`forecast` / `actual`）に独立して適用する。**
予想は「配当」ブロックの最新予想と「業績」ブロックの最新予想 EPS、実績は両ブロックの
最新実績から求める。CSV に `配当性向` 列があればそれを優先してよい
（`scoring-requirements.md` §2.4）。この優先は予想・実績どちらの組にも同様に適用する。

## 4. スコア判定

区分の解釈は **「下限以上、上限未満」**（[§0.1](../../01_requirements/scoring-requirements.md)）。
最上位行のみ「下限以上」、最下位行のみ「上限以下」。**予想・実績どちらの組にも同じ表を使う。**

| 下限 | 上限 | 点数 |
| :--- | :--- | :--- |
| 0%   | 25%  | 10   |
| 25%  | 30%  | 9    |
| 30%  | 35%  | 8    |
| 35%  | 40%  | 7    |
| 40%  | 45%  | 6    |
| 45%  | 50%  | 5    |
| 50%  | 55%  | 4    |
| 55%  | 60%  | 3    |
| 60%  | 70%  | 2    |
| 70%  | 以上 | 0    |

> ⚠️ **2026-07-27 に変更。** 原典の `60〜65% → 2点` / `65〜70% → 1点` を
> **`60〜70% → 2点` に統合**した（§8）。この指標に 1点の行は無い。

## 5. 例外処理

**予想・実績それぞれ独立に判定し、どちらも同じ規則（§0.3 赤字→0点 / §0.4 無配→0点）を適用する。
理由コードは既存実装（`payout-ratio.ts`）の `UnavailableReason` をそのまま使い、
予想・実績で同じ語彙にする（指標ごとに理由コードを分けない。⑩ は理由ごとに画面表示が
異なるため独自語彙を持つが、③ は原典どおり画面表示を1種類（`—`）にしか分けないので、
共通 `UnavailableReason` で足りる）。**

| 状況                                                                  | 理由コード               | その組のスコア | 画面表示              |
| :-------------------------------------------------------------------- | :----------------------- | :------------- | :-------------------- |
| EPS が `null`                                                         | `input-missing`          | `null`         | `—`（データなし）     |
| 配当が `null`                                                         | `input-missing`          | `null`         | `—`（データなし）     |
| EPS または配当が数値として壊れている（`NaN`/`Infinity`/安全整数外）   | `input-invalid`          | `null`         | `—`（データなし）     |
| EPS が 0                                                              | `division-by-zero`       | `null`         | `—`（ゼロ除算）       |
| その組の中でEPSと配当の年度が食い違う（予想内、または実績内。次段落） | `input-missing`          | `null`         | `—`（データなし）     |
| **EPS が負（赤字）**                                                  | —（0点。理由コードなし） | **0点**        | 算出値 / 0点（§0.3）  |
| **無配（配当 0 かつ配当性向 0%）**                                    | —（0点。理由コードなし） | **0点**        | `0.00%` / 0点（§0.4） |

**`null`（判定不能）と 0点は別物。** 画面には `0` ではなく `—` を出す。

> **年度の食い違いはこの関数の外側（呼び出し側）で `null` に変換して渡す。**
> `calculatePayoutRatio` 自身は年度を知らない（`fiscalYear` を受け取らない）。
> 呼び出し側が「予想EPSの年度」と「予想配当の年度」を比較し、一致しなければ
> `forecast.dividendSen` / `forecast.epsSen` を `null` にしてから渡す。
> **実績側も同じ規則を独立に適用する**（「実績EPSの年度」と「実績配当の年度」の比較。
> 予想と実績を互いに比較するわけではない — forecast と actual は完全に独立した2組）。
> この関数の内部では、結果として単に「入力が `null`」＝ `input-missing` に見える。

### 5.1 採点への採用（ソース選択。2026-08-06 追記。詳細は §7）

予想・実績それぞれの判定結果から、**採点に使う1つ**を次の順で選ぶ。

1. `useActualForScoring === true`（チェックボックスで実績を明示指定）
   → **実績を強制採用する。** 実績が判定不能でも予想へフォールバックしない
   （`source: 'actual'`。実績が判定不能なら `score: null, source: null`）
2. `useActualForScoring === false`（既定）かつ予想が判定可能
   → 予想を採用する（`source: 'forecast'`）
3. `useActualForScoring === false` かつ予想が判定不能・実績が判定可能
   → **実績にフォールバックする**（`source: 'actual'`）
4. 両方が判定不能
   → `score: null, value: null, source: null`。`unavailableReason` は**予想側の理由**を返す
   （既定の優先順が予想であるため。実装コメントに明記すること）

**予想・実績それぞれの判定結果（`forecast` / `actual`）は、採点への採用と無関係に
常に両方返す。** 画面が両方を表示し、採用元を併記できるようにするため
（⑩ 配当利回りの `dividendSource` と同じ発想）。

> 総合点の集計時のみ、**採点に採用した**結果の `null` を 0点として合算する
> （[§0.5](../../01_requirements/scoring-requirements.md)。分母は常に 100点）。
> 総合点の隣に有効指標数を併記すること。

## 6. 受入基準

実装時にこの6系統をすべてテストすること。1つでも欠けたら未完了とする。

### 6.1 境界値ちょうど（予想・実績それぞれの組に適用）

- [ ] `25.0%` → **9点**（10点ではない）
- [ ] `24.999...%` → 10点
- [ ] `60.0%` → **2点**
- [ ] `70.0%` → **0点**
- [ ] `69.999...%` → **2点**（1点の行は無い）
- [ ] `0.0%` かつ配当 > 0 → 10点
- [ ] `0.0%` かつ配当 == 0（無配）→ **0点**

### 6.2 負の値

**EPS が負なら 0点**（§0.3）。表の「0%〜25% → 10点」は正の配当性向にのみ適用する。
これを守らないと**赤字企業が満点**になる。**予想・実績どちらの組でも成立すること。**

### 6.3 無配・0

**無配（配当額 0）は 0点**（§0.4）。配当性向 0% は数値上は最上位区分だが、
高配当銘柄を探す目的に反するため 0点とする。配当額が 0 かどうかで分岐すること。
**予想・実績どちらの組でも成立すること。**

### 6.4 データ欠損

`null` を返す条件: EPS または配当が `null`、あるいは EPS が 0。**予想・実績それぞれ独立に判定する。**

- [ ] 上記の各条件で、その組が `null` を返す（**0 が返らない**）
- [ ] 画面表示が `—` になる（`0` や `0.00%` にならない）
- [ ] 予想の年度と実績の年度が異なっていても、両方が独立に判定できる
      （片方の欠損が他方の判定に影響しない）

#### 6.4.1 年度突き合わせ（ADR-0009 の結合規則を実績側にも適用）

予想側は ADR-0009 で既に受入基準がある（同 ADR「決定した結合規則」）。
**実績側にも同じ形の基準を追加する。**

- [ ] 実績EPS(FY2026) と 実績配当(FY2026) が揃う → FY2026 で実績配当性向を判定できる
- [ ] 実績EPS(FY2026) はあるが実績配当が FY2025 にしか無い → **実績側は `null`**
      （FY2025 に落ちない。呼び出し側が `actual.epsSen` / `actual.dividendSen` を
      `null` にして渡す）
- [ ] 実績配当(FY2026) はあるが実績EPSが FY2025 にしか無い → **実績側は `null`**
- [ ] 予想側は年度が揃うが実績側は揃わない（またはその逆） → **揃った側だけ判定できる**
      （forecast と actual は独立。片方の年度不一致が他方に伝播しない）

### 6.5 ソース選択（新規）

- [ ] `useActualForScoring: false`、予想が判定可能 → 予想を採用（`source: 'forecast'`）
- [ ] `useActualForScoring: false`、予想が判定不能・実績が判定可能 → **実績にフォールバック**（`source: 'actual'`）
- [ ] `useActualForScoring: false`、両方が判定不能 → `score: null, source: null`、理由は予想側のもの
- [ ] `useActualForScoring: true`、実績が判定可能（予想も判定可能でも） → **実績を強制採用**（`source: 'actual'`）
- [ ] `useActualForScoring: true`、実績が判定不能 → `score: null, source: null`（**予想へフォールバックしない**）

### 6.6 表示用の内訳

- [ ] `forecast` / `actual` の両方が、採点への採用と無関係に常に判定結果を返す
- [ ] 予想が判定不能でも `actual` フィールドには実績側の判定結果が入る（逆方向も同様）

## 7. 実績配当性向の追加とスコアリングソースの切替（2026-08-06 決定）

### 背景

7294（Yorozu Corporation）で、当システムの③が 61.79%、Yahoo!ファイナンスの配当性向が
36.3% と表示され「バグでは」と問い合わせがあった。調査の結果、計算に誤りはなく、
**定義が異なる**ことが原因と判明した。

| 出所                 | 分子            | 分母                | 7294 の値 |
| :------------------- | :-------------- | :------------------ | :-------- |
| 当システム（変更前） | 予想1株配当     | 予想EPS（FY2027/3） | 61.79%    |
| Yahoo!ファイナンス   | 直近実績1株配当 | 実績EPS（FY2026/3） | 36.3%     |

会社予想PER（`companies.per_source = 'forecast-eps'`）も予想EPSを使っており、
Yahoo 側のPERが同じ倍率で出るなら、Yahoo が実績ベースであることの裏取りになる。

外部の配当性向表示は実績ベースが多いと見られる（未確認・要出典）一方、原典
（YouTube「高配当ラボ」由来の参考資料）は明確に「**予想**配当性向」であり、
③ の分類は「増配余力」（今後配当を増やせるかを見る先行指標）である。
**実績ベースに変更するのではなく、両方を算出・表示し、選択可能にする。**

### 決定

1. **実績配当性向を新たに算出する。** 予想と同じ計算式・区分表・§0.3/§0.4 の例外規則を
   直近実績の EPS・1株配当に適用する。原典が定義していない拡張だが、③ と同一の指標
   （分類・向き・区分表）を別の期間に適用するだけなので、新しい指標番号は割らない。
2. **画面には予想・実績の両方を表示する。** ⑩ の `dividendSource` 表示と同じ発想。
3. **既定（未チェック）は予想を優先し、予想が判定不能なときのみ実績にフォールバックする。**
   これは⑩ の年間配当選択（`dividend-yield-scoring.md` §2.1「予想があれば優先」）と
   同じ優先順で、**既存の挙動を変更する**（変更前は予想が判定不能なら無条件で `null`）。
   変更理由: 予想EPSが取れない・大きく振れる銘柄で③が不当に判定不能または高性向に
   振れることを緩和する。
4. **チェックボックスで実績を強制採用できる。** 明示的に実績を選んだ場合は予想へ
   フォールバックしない（③「静かに別の値にすり替わる」ことを避ける。ADR-0009 の
   「フォールバックしない」原則と同じ考え方）。
5. **この選択は永続化しない。** `UserScoringPolicy`（ユーザーごとの閾値上書き）は
   [ADR-0005](../../adr/0005-thresholds-fixed-for-now.md) により未導入のため、
   `useActualForScoring` はリクエスト単位の一時指定とする。認証・ユーザー設定が
   決まった時点（T-003/T-004）で永続化を検討する。

### この設計書の範囲外（後続タスク）

- **usecase**: `score-company.ts` で `forecast` / `actual` それぞれの年度突き合わせを行い、
  `useActualForScoring` を受け取って `calculatePayoutRatio` に渡す
- **handler**: DTO にチェックボックスの値を受け取るフィールドを追加する
- **frontend**: 評価基準タブ（または会社詳細）に「実績配当性向を使う」チェックボックスを
  追加し、③ の表示に予想・実績の両方の値と採用元を併記する（画面設計は `new-screen-spec`、
  実装は `impl-from-spec` / `usecase-add` に回す）

## 8. 参考資料との差分と決定

参考資料 `high_dividend_10_indicators_scoring.md`（YouTube「高配当ラボ」由来）の
**③（予想配当性向）** に相当する。

70%以上 → 0点 まで、60% 未満の全行が一致していた。

| 項目     | 原典（SSoT） | 参考資料              |
| :------- | :----------- | :-------------------- |
| 60%〜65% | 2点（原典）  | 2点（60〜70% で一括） |
| 65%〜70% | 1点（原典）  | 2点（同上）           |

**影響:**

配当性向 65〜70% の銘柄で 1点差が出ていた。相違は1行のみ。

### 決定（2026-07-27）

✅ **参考資料に合わせ、`60〜70% → 2点` に統合した（10段）。** 上のスコア表は変更済み。

65〜70% は本来かなり高い配当性向で低評価の帯であり、1点差の識別に意味が薄い。
表が単純になる利得のほうが大きいと判断した。

> ⚠️ **この指標だけ 10段**になる（他は 11段）。実装時に「1点を返す経路が無い」ことを
> 意図的なものとしてコメントに書くこと。バグと誤認されやすい。

## 9. 既存実装との対応

`getPayoutRatioScore()` として実装あり。ただし**赤字と無配を 0点にしていない**（§0.3 / §0.4 の欠陥がそのまま入っている）。段数も原典の11段。

旧実装（[reference/legacy-web/](../../../reference/legacy-web/README.md)）は**再利用しない**（T-008）。
挙動の記録としてのみ参照する。

## 実装（2026-08-06。実績・ソース切替を含めて実装済み）

- 判定: `src/domain/scoring/payout-ratio.ts`
  - `calculatePayoutRatio`（`PayoutRatioInput` → `PayoutRatioResult`。§5.1 のソース選択規則）
  - `payoutRatioToMetricScore`（`PayoutRatioResult` → `MetricScore`。⑩
    `dividendYieldToMetricScore` に相当）
- 区分表: `src/domain/scoring/bands.ts` の `PAYOUT_RATIO_BANDS`（予想・実績で共有。変更なし）
- 年度突き合わせ（§6.4.1）:
  - `src/domain/company/company.ts` の `latestActualRecord`（`latestForecastRecord` の対）
  - `src/domain/company/dividend-record.ts` の `selectLatestActualDividend`
    （`selectLatestForecastDividend` の対。`ActualDividend` を返す）
- 結線（実績側の年度突き合わせ・`useActualForScoring` の受け渡し・`payoutRatioSource` の付与）:
  - `src/usecase/score-company.ts`
  - `src/usecase/analyze-company.ts`（`useActualForScoring` を中継。`SCORING_CALC_VERSION`
    も本決定の反映として更新済み）
  - `src/usecase/read-companies.ts`（`getCompanyScoring` が `useActualForScoring` を中継）
- handler（POST body・GET クエリの両方で `useActualForScoring` を受け取り、
  `ScoringResponse` に `payoutRatioSource`/`payoutRatioForecast`/`payoutRatioActual` を追加）:
  - `src/handler/dto/company-input.ts`
  - `src/handler/app.ts`
- テスト: `tests/domain/scoring/payout-ratio.test.ts`（§6.1〜6.4 に加え、
  **§6.4.1・§6.5（ソース選択）・§6.6（表示用の内訳）も実装・テスト済み**）、
  `tests/domain/company/dividend-record.test.ts`（`selectLatestActualDividend`）、
  `tests/domain/company/company.test.ts`（`latestActualRecord`/`latestForecastRecord`）、
  `tests/usecase/score-company.test.ts`（実績側の年度突き合わせ・ソース選択の結線）、
  `tests/integration/api.test.ts`（POST/GET の `useActualForScoring` 結線）
