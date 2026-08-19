# デザイントークン

> ステータス: 🟢 反映済み（2026-08-17, T-090）
> 実装先: `frontend/style.css` の `:root`（差し替え完了。`tests/frontend/style-tokens.test.ts` で機械検証）
> 出典: [design_mock/README.md](../../design_mock/README.md) §Design Tokens
> 決定: [design-mock-alignment.md](../../03_tasks/design-mock-alignment.md) §3 D-5

**色・余白・フォントサイズはトークン化し、コンポーネントに直値を書かない**
（`.claude/rules/frontend.md`）。このファイルがトークンの正。

---

## 1. 決定（D-5）

| 論点         | 決定                                                                           |
| :----------- | :----------------------------------------------------------------------------- |
| パレット     | **試作のパレットを採用する**（§2）                                             |
| フォント     | **システムフォント＋等幅フォールバック**。Web フォントは読み込まない（§4）     |
| スタイル手法 | **素の CSS ＋ カスタムプロパティを継続。** Tailwind / CSS Modules は導入しない |

**なぜ試作のパレットを採るか。** 試作の「色の役割は排他」という原則、とりわけ
**スコアに緑・赤を使わない**（中立のスチールグレーで表す）という選択が、
`CLAUDE.md` の「投資判断そのものを自動化・推奨する機能は作らない」という方針の
直接的な表現になっているため。現行の `--color-accent: #38bdf8` にはこの意図が無い。

**なぜ Web フォントを読み込まないか。** 試作が指定する `Zen Kaku Gothic New` /
`Roboto Mono` は外部フォント。CDN 参照は依存と外部通信を増やす
（`~/.claude/rules/security.md`）。このアプリで本当に必要なのは
**数字の桁が揃うこと**であり、それは `--font-mono` ＋ `font-variant-numeric: tabular-nums`
で満たせる。セルフホスト（サブセット化・ライセンス確認・容量）は別タスクとし、
必要になってから判断する。

---

## 2. 色

### 2.1 トークン

| トークン                 | 値        | 用途                                         |
| :----------------------- | :-------- | :------------------------------------------- |
| `--color-bg`             | `#0e1014` | ページ背景                                   |
| `--color-surface`        | `#161a20` | カード・表のコンテナ                         |
| `--color-surface-dim`    | `#12151b` | 副次サマリカード・空状態・未選択行           |
| `--color-surface-inset`  | `#0e1014` | 入力欄の背景                                 |
| `--color-line`           | `#262c37` | カード枠線                                   |
| `--color-line-row`       | `#1e242e` | 表の行区切り                                 |
| `--color-line-strong`    | `#333b48` | 入力欄の枠線・副次ボタンの枠線               |
| `--color-text`           | `#e9ebef` | 見出し・主要な値                             |
| `--color-text-secondary` | `#98a1b0` | ラベル・副次的な値                           |
| `--color-text-tertiary`  | `#626c7a` | キャプション・取得時刻・無効                 |
| `--color-brand`          | `#37b09a` | **ロゴのアクセントバーのみ**                 |
| `--color-action`         | `#4a80f0` | ボタン・リンク・活性タブ・フォーカス・トグル |
| `--color-on-action`      | `#0a1220` | `--color-action` を背景にしたときの前景      |
| `--color-data`           | `#c4ccd6` | スコア・レーダー・スコアバー                 |
| `--color-caution`        | `#d6a13c` | 管理者バッジ・入力警告・**エラー**（§2.3）   |
| `--color-positive`       | `#52a06f` | 評価損益のプラス（`▲` と必ず併記）           |
| `--color-negative`       | `#cf6b5c` | 評価損益のマイナス（`▼` と必ず併記）         |

### 2.2 役割の排他ルール（**守らないと意味が壊れる**）

- **`--color-action` は「操作できる」という意味だけに使う。** 操作できない要素に使わない。
- **`--color-data` は判断を含まない。** スコアに緑・赤を使わない。
  スコアが高いか低いかを色で示すと、それは推奨になる。
- **`--color-positive` / `--color-negative` はポートフォリオの評価損益専用。**
  スコア・増配率・成長率には使わない。
  **色だけで増減を表さない。`▲` `▼` と文言を必ず併記する**（`.claude/rules/frontend.md`）。
- **`--color-brand` はロゴだけ。** 他のどこにも使わない。

### 2.3 ⚠️ 試作からの意図的な逸脱：エラー表示の色 ✅ 確定（2026-08-17）

**試作にはエラー表示の設計が無い**（`role` 一覧に error が無い）。
現行 `frontend/style.css` は `--color-error: #f87171`（赤）を使っている。

**決定: エラー・警告はいずれも `--color-caution`（amber）で示し、赤は評価損益専用に温存する。**

- 赤をエラーにも使うと、ポートフォリオ画面で**評価損益のマイナスとエラー表示が同じ赤**になる。
  「含み損」と「取得に失敗した」を色で見分けられなくなるのは実害が大きい。
- **エラーと警告の区別は色でつけない。** `role="alert"` ＋ 文言 ＋ 枠線で示す。
  これは既存規約「色だけで意味を表さない」と同じ考え方であり、新しい制約ではない。
- 現行の `.warning` が文言に `⚠` を必ず付けている作りはそのまま維持する。
- したがって **`--color-error` トークンは廃止**し、`--color-caution` に統合する。

---

## 3. タイポグラフィ

### 3.1 フォント

```css
--font-ui: system-ui, -apple-system, 'Segoe UI', 'Hiragino Sans', 'Noto Sans JP', sans-serif;
--font-mono: ui-monospace, 'SFMono-Regular', Consolas, 'Courier New', monospace;
```

**数値・銘柄コード・日付・計算式は必ず `--font-mono`。** UI フォントで数字を出さない
（表の桁が揃わない）。併せて `font-variant-numeric: tabular-nums` を指定する
（現行 `.numeric` で既に使用）。

### 3.2 サイズ

試作の 15 段階（52 / 38 / 23 / 19 / 17 / 16 / 14.5 / 13.5 / 13 / 12.5 / 12 / 11.5 / 11 / 10.5 / 10 px）は
**11 段階に丸めた**。0.5px の差は実機で判別できず、トークンが増えるほど使い分けが崩れるため。

| トークン              | 値（rem） | px  | 用途                                                     |
| :-------------------- | :-------- | :-- | :------------------------------------------------------- |
| `--font-size-hero`    | `3.25`    | 52  | ダイアログの総合スコア                                   |
| `--font-size-display` | `2.375`   | 38  | ポートフォリオの評価額                                   |
| `--font-size-score`   | `1.4375`  | 23  | 一覧行の総合点                                           |
| `--font-size-xl`      | `1.1875`  | 19  | アプリタイトル                                           |
| `--font-size-lg`      | `1.0625`  | 17  | ダイアログ見出し／解析結果詳細の総合点見出し（`.total`） |
| `--font-size-md`      | `1`       | 16  | セクション見出し（h2）                                   |
| `--font-size-base`    | `0.875`   | 14  | 本文・銘柄名                                             |
| `--font-size-sm`      | `0.8125`  | 13  | 表・副次的な値                                           |
| `--font-size-xs`      | `0.75`    | 12  | 補助テキスト                                             |
| `--font-size-2xs`     | `0.6875`  | 11  | キャプション・取得時刻                                   |
| `--font-size-3xs`     | `0.625`   | 10  | マイクロラベル                                           |

ウェイトは `400` / `500` / `700` の3種のみ使う。

---

## 4. 余白・角丸・レイアウト

```css
--space-1: 0.25rem; /*  4px */
--space-2: 0.5rem; /*  8px */
--space-3: 0.75rem; /* 12px */
--space-4: 1rem; /* 16px */
--space-5: 1.5rem; /* 24px */
--space-6: 2rem; /* 32px  ページ左右の余白 */

--radius-sm: 0.5rem; /*  8px  ボタン・入力欄・バッジ */
--radius-md: 0.625rem; /* 10px  入れ子の行 */
--radius-lg: 0.75rem; /* 12px  カード（既定） */
--radius-xl: 0.875rem; /* 14px  ポートフォリオのヒーロー・認証カード */
--radius-2xl: 1rem; /* 16px  ダイアログ */

--content-max: 72.5rem; /* 1160px  コンテンツ最大幅（中央寄せ） */
--width-auth-card: 25rem; /* 400px  認証カード幅 */
--dialog-max-width: 58.75rem; /* 940px  解析ダイアログのカード最大幅（T-096） */

--shadow-dialog: 0 24px 64px rgba(0, 0, 0, 0.6);
--dialog-scrim-color: rgba(6, 8, 12, 0.74); /* 解析ダイアログの背景スクリム（T-096） */
--dialog-scrim-blur: 0.1875rem; /* 3px  スクリムのbackdrop-filter（T-096） */
```

> ⚠️ **`--space-3` / `--space-4` は現行と値が変わる。**
> 現行は `--space-3: 1rem` / `--space-4: 1.5rem`。新しい定義では `--space-3: 0.75rem` /
> `--space-4: 1rem` なので、**番号を据え置いたまま値だけ変えると全画面の余白が詰まる。**
> 実装（T-090）では既存の使用箇所をすべて置換すること。

**影は使わない。** 唯一の例外がダイアログ（`--shadow-dialog`）。
面の分離は影ではなく、フラットな面＋ヘアラインの枠線で行う。

---

## 5. 現行トークンからの移行表

| 現行（`frontend/style.css`） | 新                                      | 備考                                               |
| :--------------------------- | :-------------------------------------- | :------------------------------------------------- |
| `--color-bg: #0f172a`        | `--color-bg: #0e1014`                   |                                                    |
| `--color-surface: #1e293b`   | `--color-surface: #161a20`              |                                                    |
| `--color-text: #e2e8f0`      | `--color-text: #e9ebef`                 |                                                    |
| `--color-muted: #94a3b8`     | `--color-text-secondary: #98a1b0`       | 枠線用途は `--color-line-*` へ分離                 |
| `--color-accent: #38bdf8`    | `--color-action: #4a80f0`               | **スコア表示に使っていた箇所は `--color-data` へ** |
| `--color-error: #f87171`     | `--color-caution: #d6a13c`              | §2.3。トークンは廃止                               |
| `--color-warning: #fbbf24`   | `--color-caution: #d6a13c`              | 統合                                               |
| `--radius: 0.5rem`           | `--radius-sm` 〜 `--radius-2xl`         | 用途別に5段へ                                      |
| `--font-size-sm/lg` のみ     | `--font-size-3xs` 〜 `--font-size-hero` | 11段へ                                             |

`--color-muted` は**枠線とテキストの両方に使われている**（`input` の枠線、`.nav` の下線、
`fieldset` の枠線）。移行時に**テキストは `--color-text-secondary`、枠線は `--color-line-strong`**
へ振り分けること。機械的な一括置換をしない。

---

## 6. 受入基準

- ✅ `frontend/style.css` の `:root` に §2〜§4 のトークンがすべて定義されている
- ✅ `frontend/` 配下に色・余白・フォントサイズの**直値が無い**（`#` 始まりの色、`px` 指定）
- ✅ スコア・レーダー・スコアバーに `--color-positive` / `--color-negative` が使われていない
- ✅ 評価損益以外に `--color-positive` / `--color-negative` が使われていない
- ✅ `--color-error` の参照が残っていない（§2.3 で廃止）
- ✅ 数値・銘柄コード・日付を表示する要素が `--font-mono` になっている
- ✅ `--space-3` / `--space-4` の値変更による余白崩れが全画面で確認・修正済み（§4）
  - Manager が `run-dividend-stock-analysis` スキル（CDP 経由の headless Chrome）で
    `InputPage`（フォーム・年度別データ表）と `ListPage`（空状態・保存済み一覧表・解析結果詳細・
    レーダーチャート）を実描画確認（2026-08-17）。セル・行・フィールド間の余白崩れなし。

## 7. 関連ドキュメント

- [components.md](./components.md) — 部品の一覧（トークンを使う側）
- [screen-list.md](./screen-list.md) — 画面一覧
- [design-mock-alignment.md](../../03_tasks/design-mock-alignment.md) — 反映計画と決定
