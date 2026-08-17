# ポートフォリオ集計ロジック

> ステータス: 🟡 設計のみ（2026-08-16）。実装は T-102 待ち
> 出典: [design_mock](../../design_mock/README.md) §4「ポートフォリオ」、
> [今後やりたいこと.md](../../adr/今後やりたいこと.md)
> 対応する機能ID: [F-57](../../01_requirements/features.md)
> 呼び出し元: [portfolio-page.md](../ui/pages/portfolio-page.md)（T-081）

## 変更履歴

- **2026-08-16**: 新規作成（T-082）

---

## 1. 概要

1ポートフォリオ（保有銘柄の集合）から、評価額合計・評価損益・2種の平均利回り・
スコア平均の5つの集計値を算出する**純粋関数**。DB・HTTP に触らない。

この文書が対象とするのは**集計だけ**。個々の指標のスコア判定（①〜⑩）は
[scoring-requirements.md](../../01_requirements/scoring-requirements.md) が正で、
ここでは「既に算出済みの総合点・配当利回り」を入力として受け取る。

## 2. 入出力

### 2.1 入力: 保有銘柄1件（`Holding`）

| フィールド            | 型                | 単位                         | `null` の意味                               |
| :-------------------- | :---------------- | :--------------------------- | :------------------------------------------ |
| `quantity`            | `number`          | 株（正の整数）               | —（必須入力。`null` を許さない）            |
| `acquisitionPriceSen` | `Sen`（`number`） | 銭（取得単価/株）            | —（必須入力）                               |
| `currentPriceSen`     | `Sen \| null`     | 銭（現在株価/株）            | 銘柄の株価が未入力                          |
| `dividendYieldBp`     | `number \| null`  | bp（1bp=0.01%。⑩と同じ表現） | ⑩が判定不能                                 |
| `totalScore`          | `number`          | 点（0〜`maxTotalScore`）     | **無い。** 保存済み銘柄の総合点は常に確定値 |

> ⚠️ **`totalScore` の出所は指標カスタマイズの実装状況で変わる。**
> 現在（T-100/T-101 未実装）は `score_cards.total_score`（全ユーザー共通）をそのまま使う。
> 指標カスタマイズ実装後は、**閲覧しているユーザー自身の設定に基づく総合点**
> （選択指標数×10 が分母。[ADR-0012](../../adr/0012-indicator-customization-scaling-and-denominator.md)）
> に切り替える。この関数のシグネチャ自体は変わらない（呼び出し側が渡す値が変わるだけ）。

### 2.2 入力: ポートフォリオ全体

```ts
readonly holdings: readonly Holding[]  // 0〜100件
```

### 2.3 出力（`PortfolioMetrics`）

| フィールド                   | 型               | 単位 | `null` を返す条件                                                          |
| :--------------------------- | :--------------- | :--- | :------------------------------------------------------------------------- |
| `totalValueSen`              | `Sen`            | 銭   | 返さない。保有0件・価格全欠損なら `0`                                      |
| `evaluableValueCount`        | `number`         | 件   | —（`totalValueSen` の内訳を示す有効件数。§3.1）                            |
| `unrealizedGainLossSen`      | `Sen`            | 銭   | 返さない。同上                                                             |
| `weightedYieldPercent`       | `number \| null` | %    | 評価額の合計が `0`（算出対象が無い）                                       |
| `costBasisYieldPercent`      | `number \| null` | %    | 取得原価の合計が `0`                                                       |
| `yieldEvaluableHoldingCount` | `number`         | 件   | —（`weightedYieldPercent`/`costBasisYieldPercent` 共通の母数。§3.3・§3.4） |
| `scoreAverage`               | `number \| null` | 点   | 保有 `0` 件                                                                |

> ⚠️ **`yieldEvaluableHoldingCount` は 2026-08-17 追加**（T-088レビューで発見。`review-spec`）。
> 画面側（[portfolio-page.md](../ui/pages/portfolio-page.md)）は「利回り欠損銘柄を除いた
> 母数を併記する」（`—`（4.21%（10/12銘柄）と同じ思想）と定めていたが、当初この出力に
> 対応するフィールドが無かった。`evaluableValueCount`（§3.1。評価額だけの母数）とは
> **別の集合**（評価額と利回りの両方が非nullの銘柄数。§3.3・§3.4の対象集合）であるため、
> 兼用せず専用フィールドとして追加した。

**金額は銭単位の整数。** 比率（`weightedYieldPercent` 等）だけ `number`（実数）を許す
（`.claude/CLAUDE.md`「金額の計算に浮動小数点を使わない」の対象は金額であり、
最終的な比率表示は他の指標（ROE・営業利益率）と同じく `real` 相当で構わない。
ただし**金額の積み上げ（分子・分母）はすべて銭の整数で行い、除算は最後の1回だけ**行う）。

## 3. 計算ロジック

### 3.1 評価額合計・有効件数

```
評価額ᵢ = currentPriceSenᵢ === null ? null : quantityᵢ × currentPriceSenᵢ
totalValueSen = Σ(評価額ᵢ が null でない銘柄の評価額ᵢ)
evaluableValueCount = 評価額ᵢ が null でない銘柄の数
```

- 価格未取得の銘柄は**合計から除外**する（0円として合算しない。無配と未取得を
  混同しない既存原則と同様、「計算できない」と「0円」を区別する）
- **画面は `evaluableValueCount` を必ず併記する**（§0.5 の「有効指標数併記」と同じ思想。
  一部銘柄の評価額が欠けていることを黙って隠さない）

### 3.2 評価損益

```
取得原価ᵢ = quantityᵢ × acquisitionPriceSenᵢ   （常に算出可能。必須入力のため）
評価損益ᵢ = 評価額ᵢ === null ? null : 評価額ᵢ − 取得原価ᵢ
unrealizedGainLossSen = Σ(評価損益ᵢ が null でない銘柄の評価損益ᵢ)
```

- `evaluableValueCount` と同じ母数（価格未取得の銘柄は評価損益も算出不能）

### 3.3 平均利回り（評価額加重）

```
対象集合 = 評価額ᵢ と dividendYieldBpᵢ の両方が非nullの銘柄
yieldEvaluableHoldingCount = 対象集合の件数
分子 = Σ(評価額ᵢ × dividendYieldBpᵢ)   （対象集合のみ）
分母 = Σ(評価額ᵢ)                      （対象集合の評価額の合計）
weightedYieldPercent = 分母 === 0 ? null : 分子 ÷ 分母 ÷ 100
```

- **評価額と利回りの両方が算出できる銘柄だけ**を対象にする。片方が `null` の銘柄は
  分子・分母の両方から除外する（部分的に加算すると加重の意味が壊れる）
- 分母が `0`（対象銘柄が1件も無い）のとき `null` を返す。`0%` にしない
  （「利回りが0%」と「計算できなかった」は別物）
- `÷100` は bp（1bp=0.01%）を% に変換するため
- `yieldEvaluableHoldingCount` は `weightedYieldPercent` が `null` でも `0` を返す
  （分母0のときも対象件数自体は「0件」という事実として返す）

### 3.4 取得単価利回り

```
年間配当ᵢ = 評価額ᵢ × dividendYieldBpᵢ ÷ 10000   （評価額・利回りともに非nullの銘柄のみ）
分子 = Σ年間配当ᵢ
分母 = Σ取得原価ᵢ   （同じ銘柄集合の取得原価の合計）
costBasisYieldPercent = 分母 === 0 ? null : 分子 ÷ 分母 × 100
```

- 「年間配当ᵢ = 評価額ᵢ × 利回りᵢ」は design_mock の footnote が示す式をそのまま採用した。
  これは `評価額ᵢ × (年間配当/現在株価) = 数量ᵢ × 年間配当（1株）` と代数的に等価であり、
  1株配当を別途取得しなくても既存の ⑩ の算出値（bp）だけで求まる点で合理的
- **対象銘柄の集合は §3.3 と同じ**（評価額・利回りともに非nullの銘柄）。
  取得原価は必須入力なので常に算出できるが、分子（年間配当）が算出できない銘柄を
  分母だけに含めると比率が歪むため、**分母も同じ銘柄集合に絞る**
- 分母が `0` のとき `null` を返す

### 3.5 スコア平均

```
scoreAverage = holdings.length === 0 ? null : Σ(totalScoreᵢ) ÷ holdings.length
```

- **保有数量で重み付けしない**（今後やりたいこと.md「スコアは保有数量にかかわらず算出する」）。
  1株だけ保有していても100株保有していても同じ重み
- `totalScore` は §2.1 のとおり常に確定値なので、個別銘柄側の `null` 除外は不要。
  **保有 `0` 件のときだけ `null`** を返す（`0点` にしない。ゼロ除算を隠さない）

## 4. 例外処理

| 状況                                        | 挙動                                                                                                                       |
| :------------------------------------------ | :------------------------------------------------------------------------------------------------------------------------- |
| 保有 `0` 件                                 | 5つの出力すべてが「算出不能」側になる（§3 の各式のとおり）。`totalValueSen`/`unrealizedGainLossSen` は `0`、他3つは `null` |
| 全銘柄の価格が未取得                        | `totalValueSen = 0`、`evaluableValueCount = 0`、利回り2種は `null`                                                         |
| 全銘柄の配当利回りが判定不能（`null`）      | 利回り2種は `null`（評価額があっても対象銘柄が0件になるため）                                                              |
| 無配銘柄（`dividendYieldBp = 0`）を含む     | **`0` として計算に含める。** `null` とは異なる。0点評価と同じ扱い                                                          |
| 評価損益が負                                | そのまま負の値を返す。符号の正規化はしない（表示層で `▲`/`▼` に変換）                                                      |
| `quantity` や `acquisitionPriceSen` が0以下 | この関数の対象外。入力バリデーション（画面側・登録API側）で防ぐ                                                            |

## 5. 受入基準

> `new-logic-spec` の「4系統」テンプレートはスコア区分表を前提にしており、
> 集計ロジックには境界値ちょうどの区分が無い。代わりにポートフォリオ集計固有の
> エッジケースで網羅する。

| 系統                      | 例                                                                                                 |
| :------------------------ | :------------------------------------------------------------------------------------------------- |
| 保有0件（データなし相当） | 保有0件のポートフォリオで `totalValueSen=0`、`scoreAverage=null`、利回り2種が `null` を返す        |
| 無配（0）                 | `dividendYieldBp=0` の銘柄を含む集合で、その銘柄の年間配当ᵢが `0` として合算される（除外されない） |
| データ欠損（`null`）      | `currentPriceSen=null` の銘柄が `totalValueSen`・`weightedYieldPercent` の両方から除外される       |
| 負の値                    | 取得単価より現在株価が低い銘柄で `unrealizedGainLossSen` が負の値を返す                            |
| 境界値ちょうど            | — （区分表を持たない集計ロジックのため該当なし）                                                   |

- ✅ 評価額が `null` の銘柄1件・非nullの銘柄1件が混在するとき、`totalValueSen` は
  非null銘柄の評価額のみの合計になり、`evaluableValueCount=1` になる
- ✅ 全銘柄の評価額が算出できるとき、`weightedYieldPercent` は単純な加重平均と一致する
  （手計算した期待値と比較するテストケースを用意する）
- ✅ `costBasisYieldPercent` も同様に、手計算した期待値と比較するテストケースを用意する
  （2026-08-17追加。T-088レビューで `weightedYieldPercent` にしか対応する検証が
  無いことが指摘された。§3.4 の式は §3.3 と単位変換係数が異なる（`÷100` と `÷10000`）ため、
  実装時に取り違えやすく、独立した検証が要る）
- ✅ `weightedYieldPercent` と `costBasisYieldPercent` が `null` のとき、
  `yieldEvaluableHoldingCount` は `0` を返す（`null` にしない）
- ✅ 100件の保有銘柄でも1回のループで完了する（O(n)。ネストしたループを作らない）

## 6. 参考資料との差分と決定

design_mock の footnote は式を文章で示すのみで、`null`/`0` の扱いや除外集合の
明確な定義が無かった。本書で以下を明文化した。

- 評価額・利回りのどちらかが `null` の銘柄を、平均計算から**明示的に除外**する
  （試作は「実データから算出する」としか書いておらず、除外の要否は本書で決定）
- 分母 `0` のときに `0%` ではなく `null` を返す（`.claude/CLAUDE.md` の
  「`null` と 0点は別物」原則をこの集計にも適用）

## 7. 既存実装との対応

未実装（T-102）。旧実装（`reference/legacy-web/`）にポートフォリオ機能は無い。

## 8. 関連ドキュメント

- [portfolio-page.md](../ui/pages/portfolio-page.md) — この計算結果を表示する画面（T-081）
- [portfolio-api.md](../api/portfolio-api.md) — この計算を呼ぶ API（T-083）
- [scoring-requirements.md §0.5](../../01_requirements/scoring-requirements.md) — 総合点の定義
- [ADR-0012](../../adr/0012-indicator-customization-scaling-and-denominator.md) — 総合点の分母が
  可変になる将来変更（§2.1 の注記）
- [dividend-yield-scoring.md](./dividend-yield-scoring.md) — `dividendYieldBp` の出所（⑩）
