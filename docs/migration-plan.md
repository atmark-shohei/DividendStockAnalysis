# 軽量DDD 移行計画と実施記録

> 作成: 2026-07-28 / ステータス: 🟢 **移行完了（残課題あり。§6 参照）**
> 対象規約: `.claude/CLAUDE.md`（軽量DDD / レイヤード）
> 決定の記録: [docs/adr/](./adr/) — ADR-0001 〜 ADR-0006
> 参照: `CLAUDE.md`, `.claude/rules/backend.md`, `.claude/rules/frontend.md`,
> [scoring-requirements.md](./01_requirements/scoring-requirements.md)（スコアの SSoT）

---

## 0. この文書の読み方

- **第1部 現状監査** — 移行前（2026-07-27 時点）に実測した事実
- **第2部 ギャップ分析** — 目標構成との差分と、重大度付きの指摘
- **第3部 用語の突き合わせ** — 用語集 ⇄ コードの実態
- **第4部 移行計画と実施結果** — 実際にやったこと、各ステップの完了条件と実測
- **第5部 最初の1ユースケース** — UC-01 の作業手順（実施済み）
- **第6部 残課題** — 移行の対象外にしたもの

重大度: **S1 = 移行を始める前に潰す** / **S2 = 移行の途中で必ず踏む** /
**S3 = 移行後でよい**

---

# 第1部 現状監査（移行前 / 2026-07-27）

## 1.1 実測した環境

`npm test` 実測: **96 passed（4 files）** / 269ms

| 項目           | 実測値                                               |
| :------------- | :--------------------------------------------------- |
| フレームワーク | Next.js 15.5 (App Router) / React 19.2               |
| 言語           | TypeScript 5.9 `strict` + `noUncheckedIndexedAccess` |
| テスト         | Vitest 4.1                                           |
| パッケージ管理 | **npm**（pnpm ではない）                             |
| DB             | **無し。** 依存にも設定にも一切存在しない            |
| 認証           | 無し（T-003 / T-004 未決）                           |
| API Route      | 無し（`src/app` は `layout.tsx` と `page.tsx` のみ） |
| Lint           | eslint 9 + next 設定。**import 制限ルール無し**      |

## 1.2 ディレクトリ構成（移行前）

```
src/
  app/          layout.tsx / page.tsx …… プレースホルダのみ。ロジック無し
  components/   .gitkeep のみ（空）
  lib/
    input/      parse-price.ts
    scoring/    score-table.ts / dividend-yield.ts
  types/        .gitkeep のみ（空）
tests/          smoke / parse-price / dividend-yield / score-table
reference/legacy-web/   app.js (794行) …… 旧実装。移植しない(T-008)
```

**実装済みの機能は指標⑩（配当利回り）1本だけ。**

## 1.3 DB アクセス方法

**移行前は DB アクセスが存在しなかった。** 関連する事実:

- `docs/02_design/database/schema.md` は PostgreSQL 風のたたき台（🟡 draft）
- `.claude/CLAUDE.md` は **Cloudflare D1 + Drizzle** を前提
- 旧実装は **Firestore に直書き**（`reference/legacy-web/app.js:593-601`）
- T-002 / T-008 で「Firestore か localStorage か」は未決

→ **3つの互いに矛盾する前提が並んでいた。** [ADR-0001](./adr/0001-runtime-cloudflare-workers.md) で D1 に決着。

## 1.4 テストの有無（移行前）

| 対象                                | テスト   | 質                                                    |
| :---------------------------------- | :------- | :---------------------------------------------------- |
| `src/lib/scoring/dividend-yield.ts` | 445行    | **厚い。** 境界値・無配・欠損・安全整数の逸脱まで網羅 |
| `src/lib/scoring/score-table.ts`    | 92行     | 区分表の穴・重複・最上位の開区間を検証                |
| `src/lib/input/parse-price.ts`      | 120行    | 全角正規化・区切り位置・小数桁                        |
| 残り9指標                           | **無し** | 未実装                                                |

> この96件が「動作を変えずに移し替える」ための**回帰網**になった。
> 移行を⑩から始めた最大の理由。

## 1.5 ドメインロジックの所在（移行前の全列挙）

### (A) 現行 `src/` — 移行対象

| #   | ロジック                     | 移行前                              | 移行後                                  |
| :-- | :--------------------------- | :---------------------------------- | :-------------------------------------- |
| A1  | 区分表からの点数ルックアップ | `lib/scoring/score-table.ts:37`     | `domain/scoring/score-band.ts`          |
| A2  | 区分表の穴・重複の検証       | `lib/scoring/score-table.ts:60`     | `domain/scoring/score-band.ts`          |
| A3  | 区分表の型 `ScoreBand`       | `lib/scoring/score-table.ts:11`     | `domain/scoring/score-band.ts`          |
| A4  | ⑩のスコア表定数              | `lib/scoring/dividend-yield.ts:75`  | `domain/scoring/bands.ts`               |
| A5  | 年間配当の採用ルール         | `lib/scoring/dividend-yield.ts:134` | **`domain/company/dividend-record.ts`** |
| A6  | 利回りの算出と採点           | `lib/scoring/dividend-yield.ts:200` | `domain/scoring/dividend-yield.ts`      |
| A7  | 業務上限 `MAX_PRICE_SEN`     | `lib/scoring/dividend-yield.ts:168` | `domain/company/dividend-record.ts`     |
| A8  | 算術上限 `MAX_DIVIDEND_SEN`  | `lib/scoring/dividend-yield.ts:182` | `domain/scoring/dividend-yield.ts`      |
| A9  | 株価入力のパース・正規化     | `lib/input/parse-price.ts:42`       | **`handler/dto/price-input.ts`**        |

> A5 と A6 の同居が移行前の唯一の層違反だった。「どの配当を採用するか」は
> 会社の財務データの話、「その値を何点にするか」は採点の話で、前者は①③からも使う。

### (B) 旧実装 `reference/legacy-web/app.js` — 移植しない（T-008）

**全ドメインロジックが、DOM 操作と Firestore 書き込みと同じ1ファイルにある。**
新規実装時に同じ構造を再現しないための反面教師リスト。

| #   | ロジック                       | 行               | 同居しているもの                     |
| :-- | :----------------------------- | :--------------- | :----------------------------------- |
| B1  | ⑤ ROE 5年平均                  | `app.js:189-194` | 8指標ぶんの計算が1関数内             |
| B2  | ⑦ 売上高 CAGR                  | `app.js:199-211` | 〃                                   |
| B3  | ④ EPS CAGR                     | `app.js:216-227` | 〃                                   |
| B4  | ③ 予想配当性向                 | `app.js:230-246` | 〃                                   |
| B5  | ① 増配率 CAGR                  | `app.js:249-261` | 〃                                   |
| B6  | ② 連続非減配年数               | `app.js:264-275` | 〃                                   |
| B7  | ⑧ 営業利益率 5年平均           | `app.js:278-293` | 〃                                   |
| B8  | ⑩ 配当利回り                   | `app.js:296-311` | 〃                                   |
| B9  | スコア表7本（`if` 連鎖）       | `app.js:479-574` | ロジックとデータが未分離             |
| B10 | **総合点の合算**               | `app.js:645-656` | **カード描画関数の中**               |
| B11 | 表示用の閾値表 `CRITERIA_DATA` | `app.js:701-762` | **判定用の表と別に手書きで二重定義** |
| B12 | CSV の年度・数値パース         | `app.js:123-180` | ファイル読み込み・DOM 更新           |
| B13 | TSV の配当履歴パース           | `app.js:424-453` | 〃                                   |

> `app.js` は `const forecasts` を `app.js:184` と `app.js:232` で二重宣言しており、
> **構文エラーで読み込みすらできない**（T-008 で「直さない」と決定済み）。

---

# 第2部 ギャップ分析

## 2.1 目標構成と現状の対応表

| 目標（`.claude/CLAUDE.md`）                         | 移行前                                   | 移行後 |
| :-------------------------------------------------- | :--------------------------------------- | :----- |
| `src/domain/company/`                               | 無し                                     | 🟢     |
| `src/domain/scoring/`                               | `src/lib/scoring/` が実質これ            | 🟢     |
| `src/domain/shared/`（`Result` 型・ドメインエラー） | **完全に無し**                           | 🟢     |
| `src/usecase/`                                      | **無し**                                 | 🟢     |
| `src/infra/d1/`                                     | **無し。** DB 自体が無い                 | 🟢     |
| `src/handler/`（Hono ルート・zod）                  | **無し**                                 | 🟢     |
| `src/index.ts`（Worker エントリ・DI）               | **無し**                                 | 🟢     |
| `frontend/`（React + Vite + Recharts）              | **無し**                                 | 🟢     |
| `db/migrations/`                                    | 無し                                     | 🟢     |
| `docs/glossary.md`                                  | `.claude/docs/glossary.md`（パス不一致） | 🟢     |
| `docs/domain-model.md`                              | **無し**                                 | 🟢     |
| `docs/adr/`                                         | **無し**                                 | 🟢     |
| branded type + ファクトリ                           | `type Sen = number` の別名のみ           | 🟡 §6  |
| `Result<T, E>` でエラーを返す                       | 各関数が独自の結果型                     | 🟢     |
| domain が外部パッケージを import しない             | 偶然守れていた。**強制する仕組みが無い** | 🟢     |
| ユーザーごとの閾値上書き                            | 無し                                     | 🔴 §6  |
| zod で handler の入出力検証                         | zod 未導入                               | 🟢     |

## 2.2 【S1】ドメインロジックの漏れ・生値の流通

### S1-1 規約が2つあり、両立しない技術スタックを指していた 🔴 → ✅ 解決

[ADR-0001](./adr/0001-runtime-cloudflare-workers.md) で `.claude/CLAUDE.md` を正とし、
Cloudflare Workers へ載せ替えた。ルート `CLAUDE.md` も実測どおりに更新済み。

### S1-2 `Score` が生の `number`。判定不能と 0点が型で区別されていなかった → ✅ 解決

```ts
// 移行前: 次の2つを型が許してしまう
//   score: null かつ unavailableReason: null（何も分からない）
//   score: 5 かつ unavailableReason: 'price-zero'（矛盾）
```

`unavailableReason` を判別子にした判別可能ユニオンにして塞いだ
（[ADR-0003](./adr/0003-metric-score-discriminated-union.md)）。
不正な形が型エラーになることは `tests/domain/shared/kernel.test.ts` で
`@ts-expect-error` により固定してある。

### S1-3 閾値がハードコードされ、ポリシーを注入できなかった → 🟡 保留（意図的）

認証の要否（T-003 / T-004）が未決のため、`UserScoringPolicy` は導入しない
と決めた（[ADR-0005](./adr/0005-thresholds-fixed-for-now.md)）。
ただし全10指標が `scoreByBands(BANDS, value)` の1行を通る形にしてあるので、
あとから機械的に引数化できる。

### S1-4 区分表の妥当性検証が実行時に走らない → 🟡 保留（意図的）

閾値が定数である限り、テストでの検証で足りる。**ユーザー入力の閾値を
受け取るようになったら実行時検証が必須**になるため、`validateBands()` を
`Result<_, DomainError>` を返す形で用意した（ADR-0005 に条件を明記）。

### S1-5 旧実装: 総合点の合算が描画関数の中にあった → ✅ 回避

`buildScoreCard`（`domain/scoring/scoring-service.ts`）をドメインサービスとして
新規実装した。§0.5 の3点（欠損は0点で合算 / 分母は常に100 / 有効指標数を返す）を
`tests/domain/scoring/scoring-service.test.ts` で固定してある。

## 2.3 【S2】検証なしで生の数値が流れている箇所

> 現行 `src/` の⑩は移行前からこの観点で模範的だった。以下は**旧実装**の話。

| #    | 箇所                         | 生値が流れる経路                                         | 新実装での対応                      |
| :--- | :--------------------------- | :------------------------------------------------------- | :---------------------------------- |
| S2-1 | `app.js:65` / `76`           | `parseFloat(DOM値)` を **`NaN` 検査なし**で計算へ        | handler の zod ＋ 各指標の `isSen`  |
| S2-2 | `app.js:168`                 | CSV の全数値を `parseFloat`。**単位検証なし**            | 🔴 取り込み未実装（§6）             |
| S2-3 | `app.js:281-287`             | 営業利益率が**2経路で単位が混在**                        | 入力を `%` 1本に統一                |
| S2-4 | `app.js:444-447`             | TSV の配当を雑に数値化。桁ずれ・分割調整の検証なし       | 🔴 取り込み未実装（§6）             |
| S2-5 | `app.js:594-601`             | Firestore に `scores` を**検証なしで保存**               | D1 へ型付きで保存＋計算バージョン   |
| S2-6 | `app.js:189-311`             | 全指標で計算不能時も **0点のまま返す**                   | `MetricScore` で型ごと分離          |
| S2-7 | `app.js:207` / `223` / `257` | `Math.pow` の結果の `NaN`/`Infinity` が未検査            | `cagrPercent` が有限性を検査        |
| S2-8 | `lib/input/parse-price.ts`   | 形式検証（handler相当）と銭への変換（domain相当）が1関数 | `handler/dto/price-input.ts` へ移設 |

## 2.4 【S2】その他の構造的な差分

| #     | 指摘                                                | 対応                                                                              |
| :---- | :-------------------------------------------------- | :-------------------------------------------------------------------------------- |
| S2-9  | `Sen` が別名にすぎず円と銭を取り違えられる          | 🟡 branded 化したが集約まで未到達（[ADR-0004](./adr/0004-sen-branding-scope.md)） |
| S2-10 | domain の外部 import 禁止を**強制する仕組みが無い** | ✅ `eslint.config.mjs` の `no-restricted-imports` で error                        |
| S2-11 | 用語集のパス不一致                                  | ✅ `docs/glossary.md` へ移動（[ADR-0006](./adr/0006-glossary-location.md)）       |
| S2-12 | 指標を横断する型（`MetricKey`）が無い               | ✅ `domain/shared/metric-key.ts`。要素数10をテストで固定                          |
| S2-13 | `docs/adr/` が無く、決定が task ファイルに散在      | ✅ ADR-0001〜0006 を作成                                                          |

## 2.5 【S3】設計と実装のずれ

| #    | 指摘                                                 | 対応                                  |
| :--- | :--------------------------------------------------- | :------------------------------------ |
| S3-1 | `features.md` の F-10 が 🔴 のまま（実装済みだった） | ✅ 実測に合わせて更新                 |
| S3-2 | ④ は設計書が中央値ベース、旧実装は端点 CAGR          | ✅ 設計書どおり中央値で新規実装       |
| S3-3 | 旧実装は判定用と表示用の閾値表を二重定義             | 🔴 評価基準タブ（F-31）は未実装（§6） |
| S3-4 | `todo-list.md` Phase 1 の完了項目が 🔴 のまま        | ✅ 更新                               |

---

# 第3部 用語の突き合わせ

対象: 用語集（移行前 20語）⇄ `src/**` の export

## 3.1 用語集**側**を直したもの（実装のほうが正しかった）

| 用語                          | 移行前の定義                        | 修正後                                             | 根拠                            |
| :---------------------------- | :---------------------------------- | :------------------------------------------------- | :------------------------------ |
| **Score**                     | 「**1〜10** の整数」                | 「**0〜10** の整数」                               | §0.3 / §0.4 / §0.5 が 0点を要求 |
| **ScoreThreshold**            | 「**10段階**／昇順**9個**の境界値」 | 「**11段階（0〜10点）**／境界値**10個**」          | 区分表は11要素。③ だけ10段      |
| **UserScoringPolicy** ほか3語 | 断定形で定義済み                    | 「🔴 未決。コードで使わない」節へ隔離              | T-003 / T-004                   |
| **CAGR**                      | 「(終値/始値)^(1/年数)-1」          | 「**始値・終値の取り方は指標ごとに異なる**」と注記 | ④ は中央値ベース                |
| **ScoringService**            | 「全指標のスコアを算出」            | 「**総合点と有効指標数の算出もここ**」と明記       | S1-5（旧実装は描画層で合算）    |

## 3.2 用語集に**追加**したもの（実装にあって用語集に無かった）

`ScoreBand` / `Sen` / `DividendRecord` / `DividendRecordKind` / `SelectedDividend` /
`DividendSource` / `UnavailableReason` / `TotalScore` / `EffectiveMetricCount` /
`FiscalYear` — の10語。加えて移行で生まれた `MetricScore` / `MetricKey` /
`BalanceSheetSnapshot` / `MarketMultiples` / `calcVersion` も追加した。

## 3.3 コード**側**を用語集に合わせたもの

| 移行前                                    | 移行後                                            |
| :---------------------------------------- | :------------------------------------------------ |
| `DividendYieldResult.score: number\|null` | 判別可能ユニオン。`Score` は branded              |
| `type Sen = number`                       | `Sen = number & { __brand }` + `createSen`        |
| （存在しない）                            | `MetricKey` / `MetricScore` / `UnavailableReason` |

## 3.4 禁止シノニムの遵守状況

`Rank` / `Grade` / `Rating` / `Boundary` / `Limit` / `ProcessedData` /
`NormalizedData` / `Firm` / `Corporation` を `src/` 全体で検索 → **違反0件**（実測）。

---

# 第4部 移行計画と実施結果

## 4.0 前提

1. **ランタイムは Cloudflare Workers へ載せ替える**（ADR-0001）
2. **既存96テストは1件も落とさない。** 各ステップで `npm test` が全パスすること
3. **移し替えのステップでは振る舞いを変えない。** テストの差分が
   `import` パスだけであることを証拠にする
4. パッケージ管理は npm を継続（ADR-0002）

## 4.1 移行順序の考え方

**依存が少なく、ロジックが濃いところから。**

- 純粋関数 > 副作用あり（DB・HTTP・DOM）
- 入力が単一系列 > 複数系列の突き合わせが要る
- テストが既にある > これから書く

10指標に当てはめた順序:

| 順  | 指標                | 依存の少なさ                         | 結果 |
| :-- | :------------------ | :----------------------------------- | :--- |
| 1   | ⑩ 配当利回り        | **既にテスト96件がある**             | 🟢   |
| 2   | ⑤ ROE 5年平均       | 単一系列の単純平均。最も簡単         | 🟢   |
| 3   | ⑧ 営業利益率5年平均 | 単一系列                             | 🟢   |
| 4   | ⑦ 売上高 CAGR       | 年度整合が要る                       | 🟢   |
| 5   | ④ EPS CAGR          | 〃 ＋**中央値**                      | 🟢   |
| 6   | ① 増配率 CAGR       | 〃 ＋ 分割調整（T-035 は未決のまま） | 🟢   |
| 7   | ③ 予想配当性向      | 2系列 + 予想/実績の区別              | 🟢   |
| 8   | ② 連続非減配年数    | 系列の連続性判定                     | 🟢   |
| 9   | ⑨ MIX 係数          | **新規データ項目**。前例なし         | 🟢   |
| 10  | ⑥ 配当維持可能年数  | **新規データ項目**。前例なし         | 🟢   |

## 4.2 ステップ一覧と実施結果

### STEP 0 — 前提の決着 ✅

4件を ADR に記録: ランタイム（0001）/ パッケージ管理（0002）/
`MetricScore` の形（0003）/ 閾値ポリシー（0005）。用語集の置き場所（0006）と
`Sen` の適用範囲（0004）も追加。

### STEP 1 — 共有カーネル（`src/domain/shared/`）✅

`Result` / `DomainError` / `Sen` + `createSen` / `Score` + `createScore` /
`MetricScore` / `MetricKey`。

**完了条件の実測:**

- ✅ 「点数と判定不能理由が同時に立つ」形が**型エラー**（`@ts-expect-error` で固定）
- ✅ `MetricKey` がちょうど10個（総合点の分母100の根拠）
- ✅ `npm test` 全パス

### STEP 2 — ⑩を新レイアウトへ移設（振る舞い不変）✅

| 移す元                           | 移す先                                              |
| :------------------------------- | :-------------------------------------------------- |
| `src/lib/scoring/score-table.ts` | `src/domain/scoring/score-band.ts`                  |
| `dividend-yield.ts` の A4/A6/A8  | `src/domain/scoring/dividend-yield.ts` + `bands.ts` |
| `dividend-yield.ts` の A5/A7     | `src/domain/company/dividend-record.ts`             |

**完了条件の実測:**

- ✅ `npm test` → **96 passed。テストファイルの差分は0行**
- ✅ `src/lib/scoring/*` は re-export のみ（`@deprecated`）
- ✅ `src/domain/**` がフレームワークを import していない

### STEP 3 — 境界を機械的に守らせる ✅

`eslint.config.mjs` に `no-restricted-imports` を追加。
`src/domain/**` からの hono / drizzle / zod / `cloudflare:*` / react / recharts /
`../usecase` / `../infra` / `../handler` / `@/lib` を **error**。
`src/usecase/**` からの hono / drizzle / `../infra` / `../handler` も error。

**完了条件の実測:** ✅ `npm run lint` エラー0

### STEP 4 — `parsePriceInput` の責務分割 ✅

`src/handler/dto/price-input.ts` へ移設（`src/lib/input/parse-price.ts` は re-export）。

**完了条件の実測:** ✅ 期待値を1つも変えずに移設。「未入力」「読めない」「0」「負」の
4区別が保たれている

### STEP 5 — 閾値ポリシー 🟡 保留

ADR-0005 のとおり導入しない。`validateBands()` は用意済み。

### STEP 6..13 — 残り9指標 ✅

各指標で: 設計書を読む → **テストを先に書く**（4系統）→ `domain/scoring/` に実装 →
`features.md` を更新。

**完了条件の実測（全指標）:**

- ✅ 境界値ちょうど・上限直下のテストが全区分ぶんある
- ✅ 負値・無配・欠損の3系統のテストがある
- ✅ 判定不能が `0点` ではなく `MetricScore` の判定不能側で返る
- ✅ 区分表は `bands.ts` の1ファイルに集約（T-014）。全表を `assertContiguous` に通す

> 実装中に設計書の曖昧点が2件見つかり、設計書側に確定事項を追記した:
> ② の遡及年数（19年分必要）と ④ の赤字転落時の扱い。

### STEP 14 — `usecase` 層と総合点（F-20）✅

`usecase/score-company.ts`（1ユースケース=1関数）と
`domain/scoring/scoring-service.ts`（総合点はドメインサービス）。

**完了条件の実測:**

- ✅ 欠損を0点として合算し分母が常に100
- ✅ 有効指標数を返す（`80/100（有効 8/10）`）
- ✅ `usecase` が DB・HTTP を知らない（eslint が保証）

### STEP 15 — `infra` / `handler` / `index.ts` / `frontend` ✅

- `infra/d1/`: Drizzle スキーマ5テーブル + `D1CompanyRepository`
- `handler/`: Hono ルート + zod DTO
- `index.ts`: DI の組み立て。API 以外は Workers Assets へ
- `frontend/`: React + Vite + Recharts

**完了条件の実測:**

- ✅ `npm test` → **379 passed（17 files）**。うち16件は実 workerd + D1 の結線テスト
- ✅ `wrangler dev` で起動し、`POST /api/companies` が10指標を採点
  （74/100・有効 10/10）、`GET` / `DELETE` / 404 / 400 も期待どおり

## 4.3 移行台帳

| ID  | ロジック                 | 移行元                          | 移行先                              | 状態 |
| :-- | :----------------------- | :------------------------------ | :---------------------------------- | :--- |
| A1  | `lookupPoints`           | `lib/scoring/score-table.ts`    | `domain/scoring/score-band.ts`      | 🟢   |
| A2  | `assertContiguous`       | 〃                              | 〃（＋`validateBands`）             | 🟢   |
| A3  | `ScoreBand`              | 〃                              | 〃                                  | 🟢   |
| A4  | `DIVIDEND_YIELD_BANDS`   | `lib/scoring/dividend-yield.ts` | `domain/scoring/bands.ts`           | 🟢   |
| A5  | `selectAnnualDividend`   | 〃                              | `domain/company/dividend-record.ts` | 🟢   |
| A6  | `calculateDividendYield` | 〃                              | `domain/scoring/dividend-yield.ts`  | 🟢   |
| A7  | `MAX_PRICE_SEN`          | 〃                              | `domain/company/dividend-record.ts` | 🟢   |
| A8  | `MAX_DIVIDEND_SEN`       | 〃                              | `domain/scoring/dividend-yield.ts`  | 🟢   |
| A9  | `parsePriceInput`        | `lib/input/parse-price.ts`      | `handler/dto/price-input.ts`        | 🟢   |

**`src/lib/` は再エクスポートだけになった。** 削除しない理由は、既存96テストが
移行ブリッジ経由の呼び出しも検証しているため。呼び出し側が無くなった時点で消す。

## 4.4 移行済み／未移行の境界の管理

| 手段                     | 内容                                                             |
| :----------------------- | :--------------------------------------------------------------- |
| **① ディレクトリ**       | `src/domain/**` は移行済みのみ。`src/lib/**` は re-export だけ   |
| **② re-export ブリッジ** | 移設元に `@deprecated` を残す                                    |
| **③ eslint**             | domain / usecase の禁止 import を **error**、`@/lib` 参照を warn |
| **④ 移行台帳**           | §4.3 を1機能移すごとに更新                                       |

---

# 第5部 UC-01「1銘柄の配当利回りスコアを算出する」（実施済み）

**なぜこれが最初だったか:**
唯一実装済みで、テストが96件あり、DB・認証・画面の未決事項に依存しない。
⑩は残り9指標の雛形（T-048）なので、ここで型を決めれば9回の書き直しを防げる。

### 受入基準の実測

| 基準                                                 | 結果                                   |
| :--------------------------------------------------- | :------------------------------------- |
| `npm test` が96件以上で全パス                        | ✅ 96 → 最終 379                       |
| `git diff tests/` に判定値・期待値の変更が0行        | ✅ **既存テストは1文字も変えていない** |
| `npm run typecheck` / `npm run lint` エラーなし      | ✅                                     |
| `src/domain/**` がフレームワークを import していない | ✅ eslint が保証                       |
| 「点数と判定不能理由が同時に立つ」形が型エラー       | ✅ `@ts-expect-error` で固定           |
| `src/lib/scoring/**` にロジックが1行も残っていない   | ✅ re-export のみ                      |
| 移行台帳の A1〜A8 が 🟢                              | ✅                                     |

---

# 第6部 残課題（移行の対象外にしたもの）

**「完了」と書けないものをここに集める。** 実装したように読める書き方をしない。

| #   | 項目                                     | 状態                                                         | 根拠・次の一手                                                                                                                                        |
| :-- | :--------------------------------------- | :----------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **TSV / CSV の取り込み（F-01〜F-04）**   | 🔴 未着手                                                    | 年度別の数値は F-07（下記）で銘柄コード指定なら埋まるが、TSV/CSV 貼り付け自体は未実装。Phase 2（T-021〜）                                             |
| 1b  | **IRバンク JSON 取り込み（F-07）**       | 🟢 完了（2026-07-29。1c・1d を `impl-from-spec` で解消済み） | [ADR-0007](./adr/0007-irbank-json-direct-fetch.md) / [設計書](./02_design/logic/irbank-json-import.md)。①②④⑦・貸借対照表・株価は対象外。残るは 1e〜1g |
| 1c  | **株式分割検知（IRバンク取り込み内）**   | 🟢 完了（2026-07-29）                                        | [irbank-json-import.md §8-6](./02_design/logic/irbank-json-import.md)。`reason: 'suspicious-jump'`。実データ（7203）で検知を確認済み                  |
| 1d  | **`CompanyForm.tsx` の自動テスト**       | 🟢 完了（2026-07-29）                                        | [irbank-json-import.md §8-7](./02_design/logic/irbank-json-import.md)。`fillMultiplesIfEmpty` から `fillBlankMultiples()` を切り出してテスト化        |
| 1e  | **IRバンク利用規約の確認**               | 🟢 決着（2026-07-29。条文は未確認のままリスク受容）          | [ADR-0007](./adr/0007-irbank-json-direct-fetch.md)「利用規約について」。個人利用前提。利用形態が変わったら再判断                                      |
| 1f  | **⑨ PER/PBR の出所を保存後も追跡するか** | 🟢 完了（2026-07-29）                                        | [ADR-0008](./adr/0008-frontend-domain-runtime-import.md)。PER は予想EPS優先化。`per_source`/`pbr_source` を D1 に追加し画面表示                       |
| 1g  | **派生値の計算場所を domain へ統一**     | 🟢 完了（2026-07-29）                                        | [irbank-json-import.md §8-9](./02_design/logic/irbank-json-import.md)。`operating-margin.ts` を新設し `parse-fy-data.ts` から算出ロジックを移動       |
| 2   | **`Sen` の branding を集約まで通す**     | 🟡 部分                                                      | [ADR-0004](./adr/0004-sen-branding-scope.md)。取り込み層の実装後                                                                                      |
| 3   | **`UserScoringPolicy`（閾値の上書き）**  | 🟡 設計方針決定・未実装                                      | [ADR-0005](./adr/0005-thresholds-fixed-for-now.md)追記（2026-07-28）。区分表のみ上書き可・0点ガードは固定と決定。実装は T-003/T-004 待ち              |
| 4   | **閾値の実行時検証**                     | 🟡 未接続                                                    | `validateBands()` は用意済み。ポリシー導入と同時に必須になる                                                                                          |
| 5   | **株式分割・決算期変更（T-035）**        | 🔴 未決                                                      | どの層で吸収するか未定。①⑩ の境界値テストが1系統欠けたまま                                                                                            |
| 6   | **⑧ 金融業の扱い**                       | 🟡 保留                                                      | 現状 `null` → 総合点で 10点分不利。金融株を扱うときに決める                                                                                           |
| 7   | **評価基準タブ（F-31）**                 | 🔴 未着手                                                    | 閾値表をハードコードせず、エンジンが返す一覧から描画すること（T-047）                                                                                 |
| 8   | **銘柄間の横並び比較（F-33）**           | 🔴 未着手                                                    | —                                                                                                                                                     |
| 9   | **認証（T-003 / T-004）**                | 🔴 未決                                                      | 単一ユーザーなら不要。`docs/02_design/api/auth-api.md` の要否も未決                                                                                   |
| 10  | **リモート D1 の作成**                   | 🔴 未実施                                                    | `wrangler.jsonc` の `database_id` はプレースホルダ。デプロイ前に `wrangler d1 create`                                                                 |

## 検証コマンド（2026-07-28 実測）

```
npm test        → Test Files 17 passed, Tests 379 passed
npm run typecheck → エラーなし
npm run lint    → エラーなし
npm run build:web → dist/frontend に出力（488 kB / gzip 149 kB）
wrangler dev    → /api/health 200, / 200, POST /api/companies 201
```
