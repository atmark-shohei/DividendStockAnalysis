---
name: new-screen-spec
description: 新しい画面の設計書を docs/02_design/ui/pages/ に起こし、screen-list.md と features.md に相互リンクを張る。画面を追加する、画面設計書を書く、S-xx を起票する、と言われたときに使う。
---

画面を1つ追加するときの定型手順。**設計書が先、実装は後**（実装は
`impl-from-spec` が担当）。ux-architect が構造を決め、technical-writer が
設計書に落とす。

## 前提

- 画面 ID（`S-xx`）と画面名を受け取る。無ければ `docs/02_design/ui/screen-list.md`
  を読んで次の空き番号を提案し、**確認を取ってから**進める。
- 本プロジェクトの画面はタブ構成（S-08〜S-10）。ナビゲーション型の
  S-01〜S-07 は仮置きで、置き換え対象。

## 手順

### 1. 現状を読む

```
docs/02_design/ui/screen-list.md          … 既存の画面一覧と採番
docs/02_design/ui/pages/criteria-tab.md   … 書式の見本（タブ型の実例）
docs/01_requirements/features.md          … 紐づく F-xx を特定する
.claude/rules/frontend.md                 … 表示ルール。ここが正
```

### 2. 構造を決める — ux-architect

Agent ツールを `subagent_type: ux-architect` で起動し、次を出させる。

- 画面の責務（1画面1責務。**何をしない画面か**も書かせる）
- 画面内の状態と、**そのうち URL に載せるもの**（フィルタ・ソート・ページ）
- 表示する数値と単位（金額・利回り・増減）、および**データ欠損時の表示**
- 空状態・読み込み中・エラー時の3状態
- 紐づく機能 ID（F-xx）

> ux-architect には `Write` / `Edit` を渡してあるが、**この手順では
> 設計書を書かせない。** 構造の決定だけさせて、文書化は次に回す。
> 理由: 書式の統一を1箇所（technical-writer）に閉じるため。

### 3. 設計書に落とす — technical-writer

Agent ツールを `subagent_type: technical-writer` で起動し、
`docs/02_design/ui/pages/<slug>.md` を作らせる。ux-architect の出力を
そのまま入力として渡す。

**受入基準は検証可能な形でしか書かせない。**

- ✅ 「配当利回りが `null` の銘柄行は `—` を表示し、`0.00%` を表示しない」
- ❌ 「見やすく表示する」「正しく動く」

### 4. リンクを張る

- `docs/02_design/ui/screen-list.md` に1行追加（画面 ID・名前・設計書へのリンク・状態）
- `docs/01_requirements/features.md` の該当 F-xx から新しい設計書へリンク
- 新しい設計書から F-xx へ逆リンク

### 5. 検証する

```bash
npx prettier --check docs/02_design/ui/pages/<slug>.md
```

相対リンクが全て解決することを確認する。壊れたリンクを残さない。

## 完了条件

- [ ] `docs/02_design/ui/pages/<slug>.md` が存在する
- [ ] `screen-list.md` に行が追加されている
- [ ] 該当 F-xx と相互リンクしている
- [ ] 受入基準が全て検証可能な形になっている
- [ ] prettier が通る
- [ ] データ欠損時の表示（`—`）が明記されている

## 落とし穴

- **`0` とデータ欠損を混同した設計書を書かない。** 無配（0円）と未取得
  （`null`）は別物で、混ぜると利回り計算が壊れる。設計書の段階で分けておく。
- **スタイル基盤（Tailwind / CSS Modules）は未確定。** 設計書に特定の
  クラス名を書かない。決まってから書く。
- 画面 ID を勝手に採番しない。`screen-list.md` の連番と衝突する。
