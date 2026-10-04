---
name: impl-from-spec
description: 設計書1本を受け取り、その受入基準をテストに落としてから実装する。設計書に書かれていない変更は拒否する。設計書どおりに実装する、この仕様を実装する、docs のこの機能を作る、と言われたときに使う。
---

**設計書1本 ＝ 差分1本。** スコープを膨らませないことがこの手順の目的。
minimal-change-engineer が実装し、reality-checker が独立に合否を出す。

## 前提

- 引数は設計書のパス（例 `docs/02_design/ui/pages/criteria-tab.md`）。
  渡されていなければ `docs/03_tasks/current-sprint.md` を読んで
  候補を提示し、**確認を取ってから**進める。
- 設計書が無ければここで止まる。**先に `new-screen-spec` か
  `review-spec` を通す。** 設計書なしで実装しない。

## 手順

### 1. 受入基準を抜き出す

設計書を読み、受入基準を箇条書きで書き出す。ここで
**検証不能なもの（「正しく動く」「見やすく」）が混じっていたら止まる。**
`review-spec` に回して設計書を直してから戻ってくる。

該当する規約も読む。

```
CLAUDE.md                      … 受入基準の既定値
.claude/rules/backend.md       … src/lib/ を触るなら
.claude/rules/frontend.md      … src/app/ src/components/ を触るなら
```

### 2. テストを先に書く — minimal-change-engineer

Agent ツールを `subagent_type: minimal-change-engineer` で起動する。
渡すもの: 設計書のパス、抜き出した受入基準、該当する rules。

指示は次の順を守らせる。

1. 受入基準を `tests/` のテストに落とす（**この時点では落ちる**）
2. テストが通る**最小の**実装を書く
3. 落ちているテストが無いことを確認する

**金額・日付を扱うなら境界値テストを必ず含める**（0円、無配、
期末日跨ぎ、株式分割前後、株価データ欠損）。

### 3. 検証コマンドを通す

```bash
npm test
npm run typecheck
npm run lint
```

3つとも通るまで次に進まない。落ちたら実装を直す。
**テストの期待値を書き換えて通さない。**

### 4. 差分をレビューする — code-reviewer

Agent ツールを `subagent_type: code-reviewer` で起動し、変更差分を見せる。
既存の自作エージェントで、`Write` / `Edit` を持たない読み取り専用。

見るのは**差分の質**（正しさ・保守性・セキュリティ）。
次の 5 の reality-checker とは役割が違う — あちらは**完了かどうか**の判定。

### 5. 独立に判定させる — reality-checker

Agent ツールを `subagent_type: reality-checker` で起動する。
渡すもの: 設計書のパス、変更したファイル一覧、上の3コマンドの**実際の出力**。

reality-checker は `Write` / `Edit` を持たない。判定の独立性がこの役割の
存在意義なので、**指摘が出ても reality-checker に直させない。**
minimal-change-engineer に差し戻す。

NEEDS WORK が返ったら 2 に戻る。

### 6. 設計書を更新する — technical-writer

実装で設計書と食い違いが出た場合のみ。

Agent ツールを `subagent_type: technical-writer` で起動する。

> ⚠️ **どちらが正しいかを先に確認する。** 実装が正しいなら設計書を直し、
> 設計書が正しいなら実装を直す。**黙って docs を実装に合わせない。**

## 完了条件

- [ ] 受入基準がすべてテストとして存在する
- [ ] `npm test` / `npm run typecheck` / `npm run lint` がすべて exit 0
- [ ] reality-checker が証拠付きで合格を出した
- [ ] 設計書と実装が一致している（食い違いは解消済み）
- [ ] 設計書に無い変更が差分に含まれていない

## 落とし穴

- **「ついでに直す」を許さない。** 気づいた別の問題は、直さずに報告する。
  リファクタが必要なら別タスクとして起票する。
- **浮動小数点で金額を計算しない。** 銭単位の整数か Decimal。
  レビューで最も見落とされるのがここ。
- 外部データを扱うなら、永続化の前にスキーマ検証を入れる。
  `fetched_at` を付ける。この2つが抜けた実装を通さない。
