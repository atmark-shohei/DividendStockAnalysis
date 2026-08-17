---
name: modify-db-schema
description: docs/02_design/database/schema.md にテーブルの追加・変更を設計する定型手順。new-logic-spec（計算ロジック）・new-screen-spec（画面）の姉妹スキルで、DBスキーマが対象。新しいテーブルを追加する、既存テーブルにカラムを足す、DBの設計書を更新する、スキーマを設計する、と言われたときに使う。
---

`docs/02_design/database/schema.md` の変更を起こすときの定型手順。**設計書が先、
実装（`src/infra/d1/schema.ts` へのマイグレーション反映）は後**（実装は
`impl-from-spec` が担当）。software-architect が構造を決め、technical-writer が
設計書に落とす。`new-logic-spec` / `new-screen-spec` と同じ構え。

## 前提

- 対象（追加するテーブル名、または既存テーブルへの変更内容）を受け取る。
  無ければ `docs/02_design/database/schema.md` の §未実装・検討事項 と、
  変更のきっかけになった ADR・API設計書・UI設計書を読んで対象を提案し、
  **確認を取ってから**進める。
- **この手順は設計書だけを変える。** `src/infra/d1/schema.ts` の実装・
  `npm run db:generate` によるマイグレーション生成は別工程（`impl-from-spec`）。
  ここで生成物を作らない。

## 手順

### 1. 現状と契約元を読む

```
docs/02_design/database/schema.md      … 既存のテーブル定義・ER図・設計方針
src/infra/d1/schema.ts                 … 実装済みスキーマ（現状の正）
.claude/rules/backend.md               … DB の規約（§DB を参照）
docs/README.md                         … database/ の単位（分割しない理由）
```

さらに、**この変更を要求している設計書**を全て集める。DB スキーマは複数の
API・UI設計書から「存在する前提」で参照されることが多い（例: `portfolio-api.md` が
`sessions`/`portfolios` テーブルを前提に書かれている）。それらを読み、
**要求されているカラム・制約を漏れなく拾う。**

### 2. テーブル定義を決める — software-architect

Agent ツールを `subagent_type: software-architect` で起動し、次を出させる。

- 各テーブルのカラム・型・制約（PK・FK・NOT NULL・UNIQUE）
- **金額は `integer`（銭）、比率・倍率は `real`、日時は UTC の ISO 8601 文字列（`text`）**
  （`.claude/rules/backend.md`）
- 無配（`0`）とデータ欠損（`NULL`）を型で区別できているか
- 自然キー・複合主キーで二重登録を防げているか（`.claude/rules/backend.md`
  「同じデータの二重取り込みは複合主キーで DB 層から防ぐ」）
- 既存テーブルとの外部キー・`ON DELETE CASCADE` の要否
- ER図への追記（テキストの矢印図）

> software-architect には `Write`/`Edit` を渡してあるが、**この手順では
> 設計書を書かせない。** 構造の決定だけさせる（`new-screen-spec` と同じ理由。
> 書式の統一を1箇所に閉じるため）。

### 3. 設計書に落とす — technical-writer

Agent ツールを `subagent_type: technical-writer` で起動し、
`docs/02_design/database/schema.md` を更新させる。

- 既存のテーブル定義の書式（カラム／型／制約／説明の4列表）を踏襲する
- ER図（テキスト矢印図）にも追記する
- **この変更を要求した ADR・API設計書へ相互リンクする**

### 4. 依存元の設計書と突き合わせる

§1 で集めた「この変更を要求している設計書」を再度開き、**カラム名・型が
一致しているか**を確認する。ズレがあれば、スキーマ側を直すか、要求側の
設計書を直すか判断し、**どちらを直したかを両方に書き残す**
（`docs/README.md`「設計書と実装が食い違ったら、どちらが正しいかを確認してから
片方を直す」と同じ考え方を、設計書間の整合にも適用する）。

### 5. 検証する

```bash
npx prettier --check docs/02_design/database/schema.md
```

相対リンクが全て解決することを確認する。

## 完了条件

- [ ] `docs/02_design/database/schema.md` に新しいテーブル定義がある
- [ ] 金額は `integer`（銭）、日時は UTC の `text` になっている
- [ ] 無配とデータ欠損が型で区別されている
- [ ] 二重登録を防ぐキー（自然キー・複合主キー）がある
- [ ] ER図が更新されている
- [ ] この変更を要求した設計書と相互リンクしている
- [ ] §4 の突き合わせで齟齬が無い、またはある場合は両方に記録されている
- [ ] prettier が通る

## 落とし穴

- **`src/infra/d1/schema.ts` を直接編集しない。** この手順は設計書だけを変える。
  実装は `npm run db:generate` を伴う別工程。
- **依存元の設計書が先に「存在する前提」で書かれていることがある。**
  それらのカラム名を無視して独自に設計すると、後で食い違いが発覚する。
  §1・§4 を飛ばさない。
- 比率（%・倍）を `integer` にしない。金額と比率を混同しない
  （⑩配当利回りだけが例外で `1/100%` の整数。既存の理由を確認してから真似る）。
- ユーザーテーブルにパスワード等の秘密情報を書く場合、値そのものではなく
  ハッシュのカラム名・アルゴリズムの参照だけを書く（`~/.claude/rules/security.md`）。
