---
name: decide-auth
description: T-003 / T-004（認証の要否と公開範囲）を決着させ、ユーザー登録とポートフォリオの設計に落とす。認証をどうするか決める、ユーザー登録を設計する、ログインを実装するか判断する、と言われたときに使う。
---

**まず「認証が要るのか」を決める手順。** 実装から入らない。
`docs/03_tasks/current-sprint.md` の T-003 / T-004 が 🔴 のままだと、
ユーザー登録もポートフォリオも設計できない。

## この手順が終わるまでやらないこと

- ログイン画面の実装
- 認証ライブラリの導入
- `users` テーブルの作成
- `docs/02_design/api/auth-api.md` / `ui/pages/login-page.md` の作り込み
  （どちらも仮置き。**要否が決まるまで内容を増やさない**）

## 手順

### 1. 前提を揃える

```
docs/03_tasks/current-sprint.md        … T-003 / T-004 の記述
docs/02_design/api/auth-api.md         … 仮置きの中身
docs/02_design/ui/pages/login-page.md  … 仮置きの中身
docs/02_design/database/schema.md      … users を前提にしていないか
```

**先に人に聞くこと。** ここは技術判断ではなく利用形態の話なので、
エージェントに推測させない。

- この Web アプリを**自分ひとりがローカルで使う**のか、
  他人もアクセスするのか
- 使う端末は1台か、複数台で同じポートフォリオを見たいか
- 公開するなら、誰でも登録できるのか、招待制か

### 2. 選択肢を出す — identity-access-engineer

Agent ツールを `subagent_type: identity-access-engineer` で起動し、
1 の回答を渡して**選択肢と推奨**を出させる。

守らせること。

- **SSO / SAML / SCIM を提案しない。** この規模に対して過剰
- 「認証なし（localStorage のみ）」を**必ず選択肢に含める**。
  単一ユーザー・ローカル前提ならこれで足りる
- 各選択肢について、ポートフォリオデータの置き場所
  （localStorage / Firestore / 自前 DB）とセットで示す
- 秘密情報は環境変数を**参照する**設計にとどめる。値を扱わない

> 参考: 旧実装は Firestore を認証なしで使っていた（解析のたびに自動上書き・
> 履歴なし・セキュリティルール未確認）。**同じ構成を踏襲しない。**

### 3. 影響を確認する — software-architect

Agent ツールを `subagent_type: software-architect` で起動し、
2 の各選択肢について次を出させる。

- `docs/02_design/database/schema.md` への影響（`users` が要るか）
- 銘柄の分析結果を**ユーザーに紐づけるか、端末に紐づけるか**
- 認証なしを選んだ場合に、後から認証を足せる構造になっているか
- T-002（DB / ORM）の決定とどう連動するか

### 4. 人が決める

選択肢・推奨・影響を並べて**確認を取る**。ここはエージェントが決めない。

### 5. 記録する — technical-writer

Agent ツールを `subagent_type: technical-writer` で起動し、決定を反映させる。

- `docs/03_tasks/current-sprint.md` の T-003 / T-004 を 🟢 にし、
  **決定内容と日付と根拠**を書く
- **認証不要と決まった場合**: `docs/02_design/api/auth-api.md` と
  `docs/02_design/ui/pages/login-page.md` を**削除する**
  （削除は実行前に確認を取る）。`screen-list.md` の該当行も消す
- **認証が要ると決まった場合**: 2 の選択肢のうち採用したものを
  `auth-api.md` に落とし、`new-screen-spec` でログイン画面を起票する

### 6. レビューする

`review-spec` を、更新した設計書に対して実行する。

## 完了条件

- [ ] T-003 / T-004 が 🟢 になっている
- [ ] 決定の根拠と日付が書かれている
- [ ] 認証不要なら仮置き2ファイルが削除され、`screen-list.md` も整合している
- [ ] 認証が要るなら `auth-api.md` の内容が決定に一致している
- [ ] `schema.md` が決定と矛盾していない
- [ ] 相対リンクが全て解決する

## 落とし穴

- **「とりあえず認証を付けておく」を選ばない。** 単一ユーザーなら
  認証は攻撃面と実装コストを増やすだけ。要否を先に決める。
- **ポートフォリオの保存先を認証と一緒に決める。** 別々に決めると、
  認証なし＋Firestore のような中途半端な構成になる（旧実装がそれ）。
- 個人データを保持すると決めたら、`engineering-privacy-engineer` の
  導入を再検討する（`docs/00_overview/agent-roster-candidates.md` §1.2）。
