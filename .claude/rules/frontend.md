# フロントエンドルール

`frontend/` を触るときに読む。

> 詳細な規約の正本は `ai/rules/fe/coding-standards.md` / `ai/rules/fe/test-patterns.md`、
> パスとコマンドは `.claude/rules/path-conventions.md`。
> ここには**このアプリ固有の落とし穴**だけを書く。

## 構成

```
frontend/App.tsx      … データ取得と画面の組み立て
frontend/api.ts       … Worker API クライアント。fetch を書くのはここだけ
frontend/pages/       … 画面単位のコンポーネント
frontend/components/  … 表示専用。props で受け取る
frontend/format.ts    … 表示整形（丸め・単位付与・`—`）。整形はここに集約する
frontend/routes.ts    … URL と画面の対応。純関数のみ。DOM に触らない
frontend/use-route.ts … DOM / history API に触るのはここだけ
```

React 19 + Vite の SPA で、Workers Assets から配信される。
**Server Component も `"use client"` も無い**（Next.js ではない）。

> `src/components/` は Next.js 時代に残った空ディレクトリ。FE の実体は `frontend/`。
> ここに新しいコンポーネントを追加しない。

## コンポーネント設計

- **`frontend/components/` はデータ取得をしない。** props で受け取る。
  データ取得は `App.tsx` と `api.ts` だけで行う。
- **計算・判定をしない。** スコアリング・CAGR・利回りは Worker 側の domain で確定させ、
  FE は表示整形だけを担う。FE に判定ロジックを書いたら規約違反。
- 1コンポーネント1ファイル。100行を超えたら分割を検討する。
- props は 5 個を超えたらオブジェクトにまとめるか、分割を疑う。

## 金額・数値の表示

このアプリの表示ミスは投資判断の誤りに直結する。以下を必ず守る。

- 表示直前まで丸めない。丸めるのは表示層の1箇所（`frontend/format.ts`）だけ。
- 金額は3桁区切り＋通貨単位を必ず付ける（`1,234 円`）。裸の数字を出さない。
- 配当利回りは小数第2位まで＋`%`（`3.45%`）。単位なしで出さない。
- **データが無い場合に `0` を表示しない。** `—`（`format.ts` の `NO_DATA`）か
  「データなし」と明示する。無配（0円）とデータ欠損は別物。混同すると利回り計算が壊れる。
  判定不能の理由がある場合は `reasonText()` で言葉にする。
- 前期比・増減は色だけで表現しない（色覚多様性）。必ず記号か文言を添える。
- データの「取得時刻」を画面上に出す（`formatFetchedAt()`）。
  いつ時点の情報か分からない表示をしない。

## 状態管理

- URL に置けるもの（表示中の画面、選択中の銘柄コード）は URL に置く。
  `routes.ts` / `use-route.ts` を使い、グローバル state に持たない。
  旧実装はタブ切り替えを class の付け替えだけで行い、リロードと共有で選択が失われた。
  同じ作りにしない。
- サーバーデータをクライアント state にコピーしない。
- グローバル state を導入する前に、props で足りないかを必ず検討する。

## フォーム・入力

- 数値入力は必ず範囲検証する（利回り 0〜100%、株数 1 以上の整数など）。
- 全角数字を受け取ったら半角に正規化する。日本語環境では日常的に混入する。
- 銘柄コードは4文字固定（先頭3桁は数字、末尾1桁は数字か英大文字）。
  形式検証してから API に渡す（`routes.ts` の `COMPANY_CODE` と同じ形式）。

## アクセシビリティ

- 対話要素は `<button>` / `<a>` を使う。`onClick` を付けた `<div>` を作らない。
- 画像・アイコンには代替テキスト。装飾のみなら `aria-hidden`。
- 表形式データは `<table>` を使う。`<div>` のグリッドで代替しない。

## スタイル

- 現状は `frontend/style.css` の素の CSS + CSS カスタムプロパティ。
  **Tailwind / CSS Modules は未導入**。導入を決めたらここに追記する。
- 色・余白・フォントサイズは `:root` のトークン（`--color-*` / `--space-*` /
  `--font-size-*`）を使い、コンポーネントに直値を書かない。
