# 検索（F-50・F-51）

> ステータス: 🟡 設計のみ（2026-08-16）。実装は T-093（検索API）・T-094（画面）待ち
> URL: `/`（[screen-list.md](../screen-list.md) §1・§3.1 が正）
> 対応する機能ID: [F-50](../../../01_requirements/features.md)（検索）・
> [F-51](../../../01_requirements/features.md)（解析ダイアログ。詳細は [analysis-dialog.md](./analysis-dialog.md)）
> 出典: [design_mock](../../../design_mock/README.md) §2「検索」

## 変更履歴

- **2026-08-16**: 新規作成（T-072）。試作のレイアウトを反映し、
  実データ（`transformed_metrics` 等）で実現可能な項目に絞った

---

## 1. 概要

**保存済み銘柄を検索・並べ替え・閲覧する、ログイン不要の既定画面。**
1000社超を想定した一覧表示が責務。

**この画面がしないこと:**

- スコアの計算・判定（domain 側が確定済みの値を表示するだけ）
- 銘柄の登録・編集（`/input`、admin 限定の別画面）
- 複数銘柄の横並び比較（F-33。P2 に降格済み、未着手）
- 行クリックで開く解析ダイアログの中身（[analysis-dialog.md](./analysis-dialog.md)、T-073 が別途定義）

## 2. URL・クエリパラメータ

**[screen-list.md](../screen-list.md) §3.1 が正。** ここでは画面固有の挙動だけを補足する。

| パラメータ | 既定           | 変更時の副作用     |
| :--------- | :------------- | :----------------- |
| `q`        | 空             | `page` を 1 に戻す |
| `sort`     | `created_desc` | `page` を 1 に戻す |
| `page`     | `1`            | —                  |

- 解析ダイアログのクエリ（`code` / `metric` / `useActualForScoring`）は
  [ADR-0014](../../../adr/0014-analysis-dialog-url-state.md) が正。この画面はそれらを
  変更せず、行クリックで `code` を追加するだけ
- 検索ボックスの入力は**確定後に URL へ反映**する（キー入力のたびに `pushState` しない。
  デバウンス後に `replaceState`。検索語の途中経過で履歴を汚さない）

## 3. レイアウト

```
┌──────────────────────────────────────────────────┐
│ [検索ボックス            ]  該当 N 件  [ソート ▾]  │  ← 1行、折り返さない
├──────────────────────────────────────────────────┤
│ 銘柄          総合点        配当利回り  配当性向  株価  › │
│ ──────────────────────────────────────────────── │
│ トヨタ自動車    62点  ▓▓▓░░  3.18%    32.4%  3,142円 › │
│ 7203          有効 8/10                              │
│ ──────────────────────────────────────────────── │
│ ...（15行）                                          │
├──────────────────────────────────────────────────┤
│         ← 前へ    2 / 7    次へ →                   │
└──────────────────────────────────────────────────┘
```

- 検索ボックス（約460px）＋件数ラベル＋ソート `<SelectFilter>` を1行（`flex-wrap: nowrap`）。
  件数ラベルとソートは `flex: none` / `white-space: nowrap`。件数が3桁になっても
  ソートのラベルが折り返さない
- 一覧は角丸カード（`--radius-lg`）に収めた `<table>`
- ページングは [`<Pagination>`](../components.md#3-レイアウト系)（既定15件/ページ）
- 色・余白は [design-tokens.md](../design-tokens.md) のトークンのみ使用

## 4. 行の表示仕様

| 列         | 内容                                                                                                                                                                                                                                          | 欠損時                                                                                                                                                                                                                                                      |
| :--------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 銘柄       | 銘柄名（`--font-size-base`/500・truncate + `title`属性）／コード（`--font-mono` `--font-size-2xs` `--color-text-tertiary`）                                                                                                                   | 名前は常に非null（DB制約）                                                                                                                                                                                                                                  |
| 総合点     | `<ScoreBar>` ＋ 数値（`--font-size-score`/700 `--font-mono`）＋「点」（`--color-text-tertiary`）。直下に「有効 N/`totalMetricCount`」を小さく併記（`--font-size-3xs` `--color-text-tertiary`）。`value`＝`totalScore`、`max`＝`maxTotalScore` | `totalScore`/`maxTotalScore` は常に非null（`score_cards` の必須カラム）。有効指標数の併記は省略しない（[scoring-requirements.md §0.5](../../../01_requirements/scoring-requirements.md)。銘柄ごとの入力データ欠損で `totalMetricCount` 未満になりうるため） |
| 配当利回り | `formatMetricValue`（⑩の値。`--font-mono`）                                                                                                                                                                                                   | `—`（NO_DATA）                                                                                                                                                                                                                                              |
| 配当性向   | `formatMetricValue`（③の値。`--color-text-secondary`。二次情報）                                                                                                                                                                              | `—`                                                                                                                                                                                                                                                         |
| 株価       | `<Money sen={priceSen} />`（`--color-text-secondary`）                                                                                                                                                                                        | `—`（無配ではなく未入力）                                                                                                                                                                                                                                   |
| 操作       | `›` シェブロン（装飾のみ、`aria-hidden`）                                                                                                                                                                                                     | —                                                                                                                                                                                                                                                           |

- **総合点が最大の視覚的要素であること。** 他の数値列より大きく太い
  （`.claude/CLAUDE.md`「スコアは視覚上の主役」に対応する記載は無いが、design_mock の
  Design Principles 1 を踏襲）
- 3桁区切り＋単位を必ず付ける（`.claude/rules/frontend.md`）
- **無配（0円）とデータ未入力（`null`）を区別する。** `<Money>` の既存規約どおり
  `null` は `—`、`0` は「0 円」と表示する

### 4.1 行クリックの実装（アクセシビリティ）

design_mock は `<tr>` に `onClick` ＋ `role="button"` ＋ `tabIndex="0"` を直接付けているが、
**この実装は採用しない**（[design-mock-alignment.md](../../../03_tasks/design-mock-alignment.md)
§2.5「対話要素は `<button>`/`<a>` を使う。`onClick` を付けた `div` を作らない」）。

**代わりに「stretched button」パターンを使う:**
行内の1セル（銘柄名セル）に実体の `<button type="button">` を置き、CSS で
ボタンの当たり判定を行全体（`<tr>`）まで拡張する（`position: absolute; inset: 0` を
セルの `position: relative` な親に対して指定）。これにより

- 実際のインタラクティブ要素は本物の `<button>`（スクリーンリーダー・キーボード操作が
  ネイティブに機能する）
- 見た目は試作どおり「行全体がクリックできる」
- Enter / Space で開く。フォーカス時は `box-shadow: inset 3px 0 0 var(--color-action)`

ボタンの `aria-label` は「{銘柄名}（{コード}）の解析結果を表示」。
クリックすると `?code=<コード>` を付与する（`?metric=` は付けない。概要から始まる。
[ADR-0014](../../../adr/0014-analysis-dialog-url-state.md)）。

## 5. 空状態

`q` で絞り込んだ結果が0件のとき、`<table>` を空のまま表示しない。
破線枠のカードに切り替える。

- 見出し（太字）: 「「{query}」に一致する銘柄はありません」
- 補助文（`--color-text-secondary`）: 「検索語を変えるか、コードで検索してください」
- **`q` が空で0件**（＝銘柄が1件も登録されていない）のときは、見出しを
  「保存された銘柄がありません」に変える（試作は「検索結果が0件」しか想定していないが、
  初回起動時にも同じ画面を再利用するため区別する）

## 6. 読み込み中の表示

一覧の初回取得中・検索条件変更後の再取得中は `<Skeleton>`（テーブルと同じ行高・列幅）を
15行分表示する。レイアウトが飛ばないようにする。

## 7. エラー時の表示

一覧の取得に失敗した場合、`role="alert"` でエラー文言を表示する。
**何が起きたか＋次に何をすればよいか**を示す（例:「一覧の取得に失敗しました。
再読み込みしてください」）。空のテーブルとエラーを同時に出さない。

## 8. データ取得（API）

✅ **2026-08-17、[company-api.md](../../api/company-api.md)（T-077）で確定済み。**
`GET /api/companies?q=&sort=&page=&perPage=` が `priceSen`/`dividendYieldValue`/
`payoutRatioValue` を含めて返す。`companies` × `score_cards` × `transformed_metrics`
（⑩③のみ）の1クエリ JOIN で取得し、N+1 を作らない（`.claude/rules/backend.md`）。

## 9. アクセシビリティ

- 一覧は `<table>` を使う（`<div>` グリッドで代替しない）
- 検索ボックスには `<label>` を紐付ける（視覚上非表示でも `aria-label` は必須）
- ページング操作は [`<Pagination>`](../components.md) の既定挙動（前後端で `disabled`）
- 行の操作は §4.1 の stretched button パターンでネイティブなキーボード操作を確保する

## 10. 受入基準

- ✅ `q` に検索語を入れると URL の `?q=` が更新され、一致する銘柄だけが表示される
- ✅ `q` を変えると `page` が 1 にリセットされる（`sort` を変えたときも同様）
- ✅ ソートを「総合点（高い順）」にすると、総合点降順で15件ずつ表示される
- ✅ 総合点でのソートが `score_cards` との JOIN による1クエリで行われる
  （クライアント側で並べ替えない）
- ✅ 総合点の直下に「有効 N/10」が表示される（`effectiveMetricCount`/`totalMetricCount` が
  10未満の銘柄で確認する。省略しない）
- ✅ 配当利回り・配当性向・株価が `null` の行に `—` が表示され、`0` にならない
- ✅ 株価が `0` 円（データ上ありえないが）と `null`（未入力）が異なる表示になる
- ✅ 0件時に破線枠の空状態カードが表示され、空のテーブルは出ない
- ✅ 前ページ・次ページボタンが最初/最後のページで `disabled` になる
- ✅ 行を Tab キーで移動でき、Enter/Space で解析ダイアログ（`?code=`）が開く
- ✅ `frontend/` に色・サイズの直値が無い（[design-tokens.md](../design-tokens.md) §6）

## 11. 関連ドキュメント

- [screen-list.md](../screen-list.md) — URL・クエリパラメータの正
- [analysis-dialog.md](./analysis-dialog.md) — 行クリックで開くダイアログ（T-073）
- [ADR-0014](../../../adr/0014-analysis-dialog-url-state.md) — ダイアログの URL 設計
- [components.md](../components.md) — `<ScoreBar>` `<Pagination>` `<Money>` `<Skeleton>` の仕様
- [design-tokens.md](../design-tokens.md) — 色・タイポ・余白のトークン
- [company-api.md](../../api/company-api.md) — この画面が呼ぶ API（T-077 で改訂）
- [design-mock-alignment.md](../../../03_tasks/design-mock-alignment.md) — 反映計画（T-072）
