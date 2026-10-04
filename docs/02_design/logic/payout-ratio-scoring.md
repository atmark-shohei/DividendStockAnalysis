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

| 項目                        | 型               | 単位       | 備考                                                              |
| :-------------------------- | :--------------- | :--------- | :---------------------------------------------------------------- |
| `forecast.dividendSen`      | `number \| null` | 銭（整数） | 今期予想の1株配当。**年度が食い違っても `null` にしない**（§10.1）|
| `forecast.dividendFiscalYear` | `number \| null` | 年度     | 上記配当の決算年度                                                |
| `forecast.epsSen`           | `number \| null` | 銭（整数） | 今期予想の1株利益。**負（赤字）がありうる**。年度が食い違っても `null` にしない |
| `forecast.epsFiscalYear`    | `number \| null` | 年度       | 上記EPSの決算年度                                                 |
| `actual.dividendSen`        | `number \| null` | 銭（整数） | 直近実績の1株配当。年度が食い違っても `null` にしない             |
| `actual.dividendFiscalYear` | `number \| null` | 年度       | 上記配当の決算年度                                                |
| `actual.epsSen`             | `number \| null` | 銭（整数） | 直近実績の1株利益。**負（赤字）がありうる**。年度が食い違っても `null` にしない |
| `actual.epsFiscalYear`      | `number \| null` | 年度       | 上記EPSの決算年度                                                 |
| `useActualForScoring`       | `boolean`        | —          | `true` なら実績を採点へ強制採用する（画面のチェックボックス。§7） |

> ✅ **2026-09-23 変更（R1・T-108）。** `dividendFiscalYear` / `epsFiscalYear` を新設し、
> 年度の食い違いの判定を呼び出し側から `calculatePayoutRatio` の内部へ移した
> （詳細は下記「年度突き合わせ」の注記、§5、§6.4.1、§10）。

**出力**

| 項目       | 型                                    | 単位         | 備考                                                       |
| :--------- | :------------------------------------ | :----------- | :--------------------------------------------------------- |
| `score`    | `number \| null`                      | —            | **採点に採用した**値の 0〜10 の整数。判定不能なら `null`   |
| `value`    | `number \| null`                      | %（実数）    | 採点に採用した配当性向。表示用                             |
| `source`   | `'forecast' \| 'actual' \| null`      | —            | どちらを採点に採用したか。両方判定不能なら `null`          |
| `forecast` | `PayoutRatioSideResult`（§10.1）      | —            | 予想側の判定結果（`metric`・計算根拠・0点規則・該当区分の組）。**採点採用と無関係に常に返す**（表示用） |
| `actual`   | `PayoutRatioSideResult`（§10.1）      | —            | 実績側の判定結果。同上                                     |

> ✅ **2026-09-23 追記（T-108）。** 解析ダイアログの③詳細（計算式と実際に使った数値の表示）の
> ために、`forecast` / `actual` の各組へ**計算根拠**（生の入力値・年度・該当区分・0点規則）を、
> 結果全体へ**採点に使った区分表**を追加する。**点数の判定結果は変えない。** 詳細は §10。
> ✅ **2026-09-25 実装済み（T-108）。**

> `value` / `forecast.value` / `actual.value` はいずれも**配当性向（%）**。丸めていない生値
> （[dividend-yield-scoring.md](./dividend-yield-scoring.md) §2.2 と同じ
> 「判定は生値、表示のみ丸める」原則。表示層で丸めるのは1箇所だけ）。

> **金額は銭単位の整数で受け取り、途中で浮動小数点に落とさない。**
> 比率の算出でのみ小数を使い、**丸めるのは表示層の1箇所だけ**。

> ✅ **2026-09-23 変更（R1・T-108）。** 「今期予想の」「直近実績の」がそれぞれ同一年度であることの
> **判定は `calculatePayoutRatio` の内部**で行う。呼び出し側（`score-company.ts`）は
> `latestForecastRecord` / `selectLatestForecastDividend` / `latestActualRecord` /
> `selectLatestActualDividend` で選んだレコードの `dividendSen` / `dividendFiscalYear` /
> `epsSen` / `epsFiscalYear` を**null 化せずにそのまま**渡すだけで、年度の比較はしない
> （比較しないことをコメントに明記すること。うっかり比較を復活させないため）。
> [ADR-0009](../../adr/0009-dividend-single-source.md)（配当を `DividendRecord` に
> 一本化）により、EPS（`FinancialRecord`）と配当（`DividendRecord`）は別の型に分かれている。
> **予想・実績それぞれ、最新の年度で両方が揃わなければ判定不能に倒し、
> 古い年度へフォールバックしない**（同 ADR「決定した結合規則」を実績側にも適用したもの）
> という結合規則そのものは変わらない。**変わったのは判定の置き場所だけ。**
> 実績側の年度突き合わせに使うレコード選択関数は、予想側の `latestForecastRecord` /
> `selectLatestForecastDividend` に対応する **`latestActualRecord(company)`
> と `selectLatestActualDividend(company.dividends)`**（`src/domain/company/company.ts` /
> `dividend-record.ts`。2026-08-06 §7 で新設済み）。§6.4.1 の受入基準は
> domain（`calculatePayoutRatio`）のテストで検証する。

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
| その組の中でEPSと配当の年度が食い違う（予想内、または実績内。次段落） | `input-missing`          | `null`         | `—`（年度が一致しないため判定不能） |
| **EPS が負（赤字）**                                                  | —（0点。理由コードなし） | **0点**        | 算出値 / 0点（§0.3）  |
| **無配（配当 0 かつ配当性向 0%）**                                    | —（0点。理由コードなし） | **0点**        | `0.00%` / 0点（§0.4） |

**`null`（判定不能）と 0点は別物。** 画面には `0` ではなく `—` を出す。

> ✅ **2026-09-23 変更（R1・T-108）。** 年度の食い違いの判定は**この関数の内部**で行う。
> `calculatePayoutRatio` は各組の `dividendFiscalYear` / `epsFiscalYear` を受け取り、
> 配当・EPS の**両レコードが存在し**、年度が異なるときに `input-missing`
> （`fiscalYearMismatch: true`）とする。**実績側も同じ規則を独立に適用する**
> （「実績EPSの年度」と「実績配当の年度」の比較。予想と実績を互いに比較するわけではない —
> forecast と actual は完全に独立した2組）。
> **年度が食い違っても、`dividendSen` / `epsSen` / 両年度は値のまま結果へ返す**
> （表示用。呼び出し側が渡した値を `null` に変換することはない。§10.1）。

> ✅ **2026-09-25 変更（T-108）。** 年度の食い違いの画面表示を「`—`（データなし）」から
> 「`—`（年度が一致しないため判定不能）」に変えた（T-108 の画面確認でユーザーが決定）。
> 理由コードは `input-missing` のまま変えない。画面は BE が返す `fiscalYearMismatch` で
> 「データなし」と出し分ける。

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

> ✅ **2026-09-23 変更（R1・T-108）。** 以下の基準はすべて `calculatePayoutRatio`
> 自身（domain 内部の年度比較）が満たす。呼び出し側は年度を比較しないため、この基準は
> `tests/domain/scoring/payout-ratio.test.ts` で検証する（usecase 側のテストではない）。
> ✅ **2026-09-25 実装済み（T-108）。** 主な検証は `tests/domain/scoring/payout-ratio.test.ts`
> （「§6.4.1 年度突き合わせ（期末日跨ぎ相当）— calculatePayoutRatio の内部で判定する」）。
> `tests/usecase/score-company.test.ts` の年度突き合わせ（予想・実績）の describe は削除せず残し、
> usecase が値を null 化せずに渡す**結線**と、判定の置き場所を移しても結果が変わらないことの
> **end-to-end の回帰**として使う。

- [ ] 実績EPS(FY2026) と 実績配当(FY2026) が揃う → FY2026 で実績配当性向を判定できる
- [ ] 実績EPS(FY2026) はあるが実績配当が FY2025 にしか無い → **実績側は `null`**
      （FY2025 に落ちない。`calculatePayoutRatio` が年度不一致を検出して
      `input-missing`（`fiscalYearMismatch: true`）にする。`dividendSen`/`epsSen`
      そのものは `null` にならず値のまま返る — §10.1）
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
   ✅ 2026-09-25（T-108）: 要約行（`frontend/format.ts` の `payoutRatioBreakdownText`。概要モードの比較表の備考列と詳細画面の要約行で共用）は、年度の食い違い（`fiscalYearMismatch`）を「年度が一致しないため判定不能」と表示する。
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
  - ✅ **2026-09-23 変更（R1・T-108）。** 年度突き合わせは `calculatePayoutRatio`（domain）の
    内部へ移した。usecase は選んだレコードの値と年度を null 化せずに渡すだけで、年度を比較しない
    （§2「年度突き合わせ」の注記・§5・§6.4.1）。この箇条は 2026-08-06 時点の記録として残す
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

## 実装（2026-08-06。実績・ソース切替を含めて実装済み。✅ 2026-09-25 T-108 の計算根拠を含めて更新）

- 判定: `src/domain/scoring/payout-ratio.ts`
  - `calculatePayoutRatio`（`PayoutRatioInput` → `PayoutRatioResult`。§5.1 のソース選択規則）。
    ✅ 2026-09-25（T-108）: **年度の突き合わせ（§6.4.1）もこの関数の内部**（非公開の
    `calculateSidePayoutRatio`）で行い、他のどの検査よりも先に判定する。各組は
    `PayoutRatioSideResult`（§10.1）、結果全体に `bands`（採点に使った区分表）を返す
  - `payoutRatioToMetricScore`（`PayoutRatioResult` → `MetricScore`。⑩
    `dividendYieldToMetricScore` に相当）
- 区分表: `src/domain/scoring/bands.ts` の `PAYOUT_RATIO_BANDS`（予想・実績で共有。変更なし）
- 区分表ルックアップ（✅ 2026-09-25 T-108。§10.2 R3）:
  - `src/domain/scoring/score-band.ts` の `lookupBandIndex`（添字を返す。`lookupPoints` はこのラッパー）
  - `src/domain/scoring/metric-lookup.ts` の `scoreByBandsWithIndex`（`{ metric, bandIndex }` を返す。
    `scoreByBands` はこのラッパー）。③以外の9指標の呼び出しは変更なし
- 年度突き合わせ（§6.4.1）に使うレコード選択:
  - `src/domain/company/company.ts` の `latestActualRecord`（`latestForecastRecord` の対）
  - `src/domain/company/dividend-record.ts` の `selectLatestActualDividend`
    （`selectLatestForecastDividend` の対。`ActualDividend` を返す）
- 結線（`useActualForScoring` の受け渡し・`payoutRatioSource` の付与）:
  - `src/usecase/score-company.ts`
    - ✅ 2026-09-25（T-108）: **年度を比較しない。** 選んだレコードの値と年度を null 化せずに
      `calculatePayoutRatio` へそのまま渡す。`CompanyScoring` は `payoutRatioForecast` /
      `payoutRatioActual` を `PayoutRatioSideResult` のまま持ち、`payoutRatioBands` を追加（§10.1）
  - `src/usecase/analyze-company.ts`（`useActualForScoring` を中継。`SCORING_CALC_VERSION`
    も本決定の反映として更新済み）
  - `src/usecase/read-companies.ts`（`getCompanyScoring` が `useActualForScoring` を中継）
- handler（POST body・GET クエリの両方で `useActualForScoring` を受け取り、
  `ScoringResponse` に `payoutRatioSource`/`payoutRatioForecast`/`payoutRatioActual` を追加）:
  - `src/handler/dto/company-input.ts`
    - ✅ 2026-09-25（T-108）: `toScoringResponse` 内の `toPayoutRatioSideView` が
      `PayoutRatioSideResult` を平らな `PayoutRatioSideView` に詰め替える。`ScoringResponse` に
      `payoutRatioBands` を追加
  - `src/handler/app.ts`
- テスト: `tests/domain/scoring/payout-ratio.test.ts`（§6.1〜6.6 に加え、
  ✅ 2026-09-25（T-108）: **§6.4.1（年度突き合わせ）と §10.3 の主な検証はここ**）、
  `tests/domain/scoring/score-band.test.ts`（新規。`lookupBandIndex` と `lookupPoints` の一致）、
  `tests/domain/scoring/metric-lookup.test.ts`（新規。`scoreByBandsWithIndex` と `scoreByBands` の一致）、
  `tests/domain/company/dividend-record.test.ts`（`selectLatestActualDividend`）、
  `tests/domain/company/company.test.ts`（`latestActualRecord`/`latestForecastRecord`）、
  `tests/usecase/score-company.test.ts`（ソース選択・evidence・`payoutRatioBands` の結線と、
  年度突き合わせの end-to-end の回帰）、
  `tests/handler/company-input.test.ts`（新規。`toScoringResponse` の平坦化・`payoutRatioBands`）、
  `tests/handler/company-routes.test.ts`（T-101 上書き時の `payoutRatioBands`）、
  `tests/integration/api.test.ts`（POST/GET の `useActualForScoring` と計算根拠の結線）

## 10. 詳細画面向けの計算根拠（2026-09-23 決定。T-108。✅ 2026-09-25 実装済み）

### 背景

解析ダイアログの③詳細（[analysis-dialog.md](../ui/pages/analysis-dialog.md) §5.3.1）で
「計算式と、実際の計算に使った数値」を表示する。現状の出力（§2）は配当性向（%）・点数・
理由コードしか持たず、**分子・分母・年度・どの区分に当たったか**が画面から見えない。

### 10.1 追加する出力（各組 = `forecast` / `actual` のそれぞれ）

> ✅ **2026-09-23 変更（R2・T-108）。** 各組の型として新しい値オブジェクト
> `PayoutRatioSideResult` を新設する。**全指標共通の `MetricScore` は拡張しない**
> （③以外の9指標が計算根拠を持たない非対称を型で保つため。`MetricScore` に
> `fiscalYearMismatch` 等を足すと、③専用のフィールドが共通型に漏れ出す）。
>
> ```ts
> interface PayoutRatioSideResult {
>   readonly metric: MetricScore; // score / value / unavailableReason（既存。§2 の内訳と同じ）
>   readonly evidence: {
>     readonly dividendSen: number | null;
>     readonly dividendFiscalYear: number | null;
>     readonly epsSen: number | null;
>     readonly epsFiscalYear: number | null;
>   };
>   readonly fiscalYearMismatch: boolean;
>   readonly zeroScoreRule: 'negative-eps' | 'no-dividend' | null;
>   readonly matchedBandIndex: number | null;
> }
> ```
>
> `PayoutRatioResult.forecast` / `PayoutRatioResult.actual`（§2）はこの型になる
> （旧 `MetricScore` 直置きから変更。**点数の判定結果 `metric.score`/`metric.value`/
> `metric.unavailableReason` は変わらない**）。
>
> ✅ **2026-09-25 訂正（T-108 実装時のユーザー決定）。** usecase の `CompanyScoring` は
> `payoutRatioForecast` / `payoutRatioActual` を **`PayoutRatioSideResult` のまま（ネストのまま）**
> 持ち、③の区分表は `payoutRatioBands` として持つ。**平らにする（`metric` と `evidence` の中身を
> 展開する）のは handler の `toScoringResponse` だけ**（`src/handler/dto/company-input.ts` の
> `toPayoutRatioSideView`）で、DTO `PayoutRatioSideView`（[glossary.md](../../glossary.md)）として
> 画面まで運ぶ。（旧記述「`CompanyScoring` と DTO は平らにして運ぶ」は誤り）

| 項目（`evidence` 配下） | 型                                        | 単位       | 意味                                                                                                                                                                  |
| :----------------------- | :----------------------------------------- | :--------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dividendSen`        | `number \| null`                           | 銭（整数） | その組で**選ばれた**配当レコードの1株配当（予想: `selectLatestForecastDividend`、実績: `selectLatestActualDividend`）。**年度が食い違っても `null` にしない**（表示用） |
| `dividendFiscalYear` | `number \| null`                           | 年度       | 上記配当レコードの決算年度。レコードが無ければ `null`                                                                                                                 |
| `epsSen`             | `number \| null`                           | 銭（整数） | その組で選ばれた業績レコード（予想: `latestForecastRecord`、実績: `latestActualRecord`）の EPS。**負がありうる**。年度が食い違っても `null` にしない                  |
| `epsFiscalYear`      | `number \| null`                           | 年度       | 上記業績レコードの決算年度。レコードが無ければ `null`                                                                                                                 |

| 項目（`PayoutRatioSideResult` 直下） | 型                                        | 単位 | 意味                                                                                                                                     |
| :------------------------------------ | :----------------------------------------- | :--- | :---------------------------------------------------------------------------------------------------------------------------------------- |
| `fiscalYearMismatch` | `boolean`                                  | —    | 配当と EPS の**両レコードが存在し**、年度が異なるとき `true`。このとき判定は §5 のとおり `input-missing`（判定不能）のまま                |
| `zeroScoreRule`      | `'negative-eps' \| 'no-dividend' \| null`  | —    | §0.3（赤字）/ §0.4（無配）の規則で 0点にしたとき、その規則。区分表を引いて 0点になった場合（70%以上）は `null`                            |
| `matchedBandIndex`   | `number \| null`                           | —    | 区分表（下表の `bands`）の何番目の区分に当たったか（0始まり）。**判定不能・`zeroScoreRule` が非 `null` のときは `null`**                 |

**結果全体に追加する出力**

| 項目    | 型                     | 意味                                                                                                                                     |
| :------ | :--------------------- | :--------------------------------------------------------------------------------------------------------------------------------------- |
| `bands` | `readonly ScoreBand[]` | **この採点に実際に使った③の区分表。** 指標カスタマイズ（T-101）で上書きされていればその表、未設定なら `PAYOUT_RATIO_BANDS`。予想・実績で共通。**`calculatePayoutRatio` が判定に使った表をそのまま返す**（Y1。usecase・handler は表を組み立て直さない） |

### 10.2 判定経路の一本化（必須）

- **`matchedBandIndex` は、点数を決めたのと同じ区分表ルックアップから得る。**
  「点数用」と「ハイライト用」で別々に区分を判定しない（境界の扱いがずれると、
  画面のマーカー行と点数が食い違う）。✅ **2026-09-23 決定（R3・T-108）:**
  - `score-band.ts` に `lookupBandIndex(bands, compare): number | null` を新設する
    （`lookupPoints` と同じ肯定形の判定・同じ `NaN` の倒し方。**添字**を返す点だけが違う）
  - 既存の `lookupPoints` はこれをラップして点数だけ取り出す薄いラッパーにする
    （呼び出し側のシグネチャ・戻り値は変えない）
  - `metric-lookup.ts` に添字も返す版 `scoreByBandsWithIndex(bands, value): { metric: MetricScore; bandIndex: number | null }`
    を新設し、既存の `scoreByBands` はこれに委ねる（`{ metric }` だけを取り出すラッパーにする）
  - **③以外の9指標が呼ぶ公開関数・戻り値は変えない**（`lookupPoints`/`scoreByBands` のシグネチャは不変）
  - 区分表の外（`value-out-of-band`）は `bandIndex: null`
- **FE は区分を判定しない**（`.claude/rules/frontend.md`「計算・判定をしない」）。
  FE は `matchedBandIndex` の行にマーカーを描くだけ
- **「実際の計算に使った値」と「表示用の生値」の関係:** 年度が一致したときは
  `evidence.dividendSen` / `evidence.epsSen` がそのまま §3 の式に渡った値である。
  年度が食い違ったとき（`fiscalYearMismatch: true`）は、✅ **2026-09-23 変更（R1）**
  `evidence` の値・年度は`null` に変換されず**値のまま**返るが、§5 のとおり
  `calculatePayoutRatio` 内部の判定は `input-missing`（判定不能）として扱われ、
  この値は式の計算には使われていない。画面は「年度が一致しないため判定不能」と
  表示する（値は参考表示）

### 10.3 受入基準（追加）

> ✅ **2026-09-25 実装済み（T-108）。** 以下は主に `tests/domain/scoring/payout-ratio.test.ts`
> （`§10 matchedBandIndex` / `§10 bands` / `§10 zeroScoreRule` / `§10 evidence` / `§6.4.1` の describe）で
> 検証する。usecase の結線（`payoutRatioBands`・evidence を null 化しない）は
> `tests/usecase/score-company.test.ts`、R4 は `tests/domain/scoring/score-band.test.ts`・
> `metric-lookup.test.ts`、DTO の平坦化は `tests/handler/company-input.test.ts`。

- [ ] 各組について、`matchedBandIndex !== null` ならば `bands[matchedBandIndex].points === metric.score`
      （§6.1 の全境界値 `0` / `24.999…` / `25.0` / `60.0` / `69.999…` / `70.0` で確認する）
- [ ] 区分表を上書きした場合（T-101）、`bands` が上書き後の表になり、`matchedBandIndex` もその表の添字になる
- [ ] 赤字（EPS < 0）→ `metric.score: 0`、`zeroScoreRule: 'negative-eps'`、`matchedBandIndex: null`
- [ ] 無配（配当 0、EPS > 0）→ `metric.score: 0`、`zeroScoreRule: 'no-dividend'`、`matchedBandIndex: null`
- [ ] 配当性向 70% 以上 → `metric.score: 0`、`zeroScoreRule: null`、`matchedBandIndex` は最下位区分の添字
- [ ] EPS が 0 → `unavailableReason: 'division-by-zero'`、`evidence.dividendSen`/`evidence.epsSen`（=0）は値のまま返る
- [ ] EPS レコードが無い → `evidence.epsSen: null`、`evidence.epsFiscalYear: null`、`evidence.dividendSen` は値のまま返る
- [ ] 予想EPS(FY2027) と予想配当(FY2026) → `fiscalYearMismatch: true`、`unavailableReason: 'input-missing'`、
      `evidence.dividendSen`・`evidence.epsSen`・両年度は**値のまま**返る（`null` にならない）
- [ ] 実績側にも上記の年度の食い違いを同様に適用し、予想側の状態に影響されない
- [ ] 既存の §6.1〜§6.6 の結果（`score` / `value` / `source` / `unavailableReason`）が**1件も変わらない**
      （`SCORING_CALC_VERSION` を上げない根拠）
- [ ] **（R4）** `lookupPoints`/`scoreByBands` を `lookupBandIndex`/`scoreByBandsWithIndex` の
      ラッパーに組み替えた後、`tests/domain/scoring/` の全指標（①〜⑩）の既存テストが
      期待値を変えずに全パスする
- [ ] **（Y2）** 配当 0 かつ EPS 負（赤字かつ無配）→ `zeroScoreRule: 'negative-eps'`
      （`payout-ratio.ts` の現行の判定順どおり、EPS 負の判定が無配判定より先に来るため
      赤字を優先する。§0.3 と §0.4 が両方成立する唯一のケース）。
      ✅ 2026-09-25（T-108）: このとき `metric.value` は `-0`（`(0 / 負) * 100`。JSON では `0`）になる。
      結果不変のため変更しない（テストは `toEqual(-0)` で比べる）
- [ ] **（Y2）** 配当が負の値 → `unavailableReason: 'input-invalid'`、`zeroScoreRule: null`、
      `matchedBandIndex: null`。`evidence.dividendSen`/`evidence.epsSen` の値・年度は
      そのまま返る（配当性向そのものは計算せず `metric.value` は `null`）
