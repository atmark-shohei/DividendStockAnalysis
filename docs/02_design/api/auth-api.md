# 認証系 API 仕様

> ステータス: 🟢 実装済み（2026-08-18、T-091）
> 認証方式: [ADR-0013](../../adr/0013-multi-user-auth-small-scale.md)（少人数向け自前認証。招待制なし。PBKDF2）
> テーブル: [schema.md](../database/schema.md)（`users`/`sessions`）
> 呼び出し元: [login-page.md](../ui/pages/login-page.md)
> 実装: `src/domain/auth/` `src/usecase/{signup,login,logout,get-current-user}.ts`
> `src/infra/d1/{user,session}-repository.ts` `src/infra/auth/*`
> `src/handler/{auth-routes,auth-cookie,require-role,dto/auth-input}.ts`

## 変更履歴

- **2026-08-18**: 実装完了（T-091）。設計時点で「実装時に決める」としていた3点を確定した:
  - セッションTTLは **30日**（`SESSION_TTL_DAYS`。`src/domain/auth/session-policy.ts`）
  - Cookie名は **`session_id`**。トークンは `crypto.getRandomValues(32byte)` の16進文字列
  - `SIGNUP_ENABLED`/`SIGNUP_MAX_USERS` は `wrangler.jsonc` の `vars`。**未設定時は受付停止**（安全側）
  - あわせて `POST/DELETE /api/companies` に `requireRole(['admin'])` を配線した
    （`screen-list.md` §2「保護は API 側でも必ず行う」、ADR-0013 制約1の解消。この節は
    auth-api.md のスコープ外だが、既存 API への影響として記録する）
  - **メールアドレスの大文字小文字は正規化しない**（区別する）。`Foo@example.com` と
    `foo@example.com` は別アカウントとして登録できる。`users.email` の `UNIQUE` 制約も
    ケースセンシティブ。BEレビュー（CR-review）の推測仕様1件として指摘され、Manager確認の結果、
    上記のとおり確定した（2026-08-18）
- **2026-08-16**: 保留を解除（T-076）。「認証が必要」と決まった場合の雛形だった内容を、
  ADR-0013 の決定に沿って具体化した

---

## 共通仕様

[company-api.md](./company-api.md) §共通仕様に準じる。

- ベースパス: `/api/auth`
- エラー形式: `{ "error": "<人間向けの説明>" }`（`company-api.md` と同じ形。
  機械可読コードではなく文言そのものを返す。既存の draft にあった
  `invalid_credentials` 等のコードは廃止し、文言に統一する）
- 400 は zod の検証失敗時のみ `issues` を追加で含める（`company-api.md` と同じ）

| ステータス | 用途                                        |
| :--------- | :------------------------------------------ |
| 200 / 201  | 成功                                        |
| 204        | ログアウト成功（本文なし）                  |
| 400        | 入力形式不正（zod）                         |
| 401        | ログイン失敗、または未ログイン（`GET /me`） |
| 403        | サインアップの受付停止・上限到達            |
| 409        | サインアップ時、メールアドレスが登録済み    |
| 429        | ログイン試行回数の超過（§レート制限）       |
| 500        | 想定外のサーバーエラー                      |

---

## POST /api/auth/signup

```json
{ "email": "user@example.com", "password": "correct horse battery staple" }
```

- `password` の確認欄（[login-page.md](../ui/pages/login-page.md) §4 のパスワード確認）は
  **サーバーに送らない**。フロントだけで一致を検証する（1つの値を2回送る必要はない）
- **`password` は8〜128文字。**（2026-08-17追加。T-088レビューで、最小長がどこにも
  定義されていないことが指摘された。[ADR-0013](../../adr/0013-multi-user-auth-small-scale.md)
  §決定3 が PBKDF2 のイテレーション数を OWASP最小推奨の約1/21に下げる
  リスク受容をしており、パスワード自体の強度がその埋め合わせとして最低限必要。
  8文字は一般的な下限の目安であり固定不変ではない。上限128文字は
  PBKDF2への極端に長い入力を防ぐための安全弁）
- 201:

```json
{ "user": { "id": 1, "email": "user@example.com", "role": "admin" } }
```

- **最初に登録したユーザーは `role: "admin"`。** 2人目以降は `"user"`
  （[ADR-0013](../../adr/0013-multi-user-auth-small-scale.md) §決定2。
  `SELECT COUNT(*) FROM users` で判定。専用フラグは持たない）
- 成功時、`Set-Cookie` でセッションを発行する（ログイン状態にする。§セッション）

| 条件                                                          | 応答                                                                                                                            |
| :------------------------------------------------------------ | :------------------------------------------------------------------------------------------------------------------------------ |
| `email` の形式不正 / `password` が8文字未満・128文字超        | 400                                                                                                                             |
| `SIGNUP_ENABLED=false`、または `COUNT(*) >= SIGNUP_MAX_USERS` | 403（`{ "error": "現在、新規登録を受け付けていません" }`。両条件を区別しない。[login-page.md](../ui/pages/login-page.md) §5.2） |
| `email` が既に登録済み                                        | 409（`{ "error": "そのメールアドレスは既に登録されています" }`）                                                                |

> ⚠️ **人数上限チェックと INSERT の間に競合状態がありうる**（同時に2件のサインアップが
> `COUNT(*)` を通過し、上限を1件超える）。**この規模のアプリでは許容する。**
> 同時サインアップが発生する頻度が極めて低く、`users.email` の `UNIQUE` 制約さえ
> 守られれば実害が「上限より1人多い」程度に留まるため、トランザクション分離までは行わない

---

## POST /api/auth/login

```json
{ "email": "user@example.com", "password": "correct horse battery staple" }
```

- 200:

```json
{ "user": { "id": 1, "email": "user@example.com", "role": "user" } }
```

- 成功時、`Set-Cookie` でセッションを発行する。**同時に `failed_login_count` を 0 に戻す**

| 条件                                               | 応答                                                                                           |
| :------------------------------------------------- | :--------------------------------------------------------------------------------------------- |
| `email`/`password` の形式不正                      | 400                                                                                            |
| メールアドレスが存在しない、またはパスワード不一致 | 401（`{ "error": "メールアドレスまたはパスワードが正しくありません" }`。**両者を区別しない**） |
| `locked_until` が現在時刻より未来                  | 429（`{ "error": "しばらく時間をおいてからお試しください" }`）                                 |

> ⚠️ **「メールアドレスが存在しない」と「パスワードが違う」を区別して返さない。**
> アカウントの存在を漏らす（[login-page.md](../ui/pages/login-page.md) §5.1）。

### タイミング攻撃対策

存在しないメールアドレスでログインを試みたとき、**パスワード検証を省略して即座に
401 を返すと、応答時間の差からメールアドレスの存在有無が推測できる**
（PBKDF2 は 10,000 回のハッシュ計算に約4ms かかる。§ハッシュ）。

- **メールアドレスが見つからない場合も、ダミーのハッシュ値・ソルトに対して
  同じ PBKDF2 計算を実行してから 401 を返す。** 計算結果は使わず、時間を合わせるためだけに行う
- ダミーのソルト・イテレーション数は固定値でよい（攻撃者が推測しても、
  それ自体は情報を持たない）

---

## レート制限

**ユーザー（メールアドレス）単位でロックする。** IPアドレス単位ではない
（少人数アプリでは同一IPからの正当な複数ユーザーのログインを妨げないため）。

- ログイン失敗のたびに `users.failed_login_count` を+1する
- **5回連続失敗**したら `users.locked_until` を「現在時刻 + 15分」に設定する
- ログイン成功時は `failed_login_count` を 0 に、`locked_until` を `NULL` に戻す
- `locked_until` が現在時刻より未来の間は、**パスワードの正誤を検証する前に** 429 を返す
  （検証してから拒否すると、正しいパスワードを知っているかどうかが応答内容から漏れる余地がある。
  ロック中は常に同じ扱いにする）

> 📌 **具体的な回数・時間は本設計書の既定値。** 実測や運用開始後のフィードバックで
> 調整してよい（固定不変の要件ではない）。

---

## POST /api/auth/logout

セッションを破棄する。常に **204** を返す（冪等。未ログインでも 204）。

- `sessions` テーブルから該当行を削除する
- `Set-Cookie` でセッションクッキーを空・即時失効に上書きする

---

## GET /api/auth/me

現在のセッションのユーザーを返す。

```json
{ "user": { "id": 1, "email": "user@example.com", "role": "admin" } }
```

- 401（`{ "error": "ログインが必要です" }`）: 未ログイン、またはセッション期限切れ
- **フロントの起動時・画面遷移のたびに叩く想定。** [screen-list.md](../ui/screen-list.md) §2 の
  ロール別タブ出し分けと §5.2 のルートガードは、この応答の `role` を基準にする

---

## セッション

- ✅ **Cookie 名は `session_id`**（2026-08-18確定）。値は `sessions.id`（不透明なトークン。
  `crypto.getRandomValues(32byte)` の16進文字列＝256bit相当のエントロピー）そのもの
- `HttpOnly; Secure; SameSite=Lax`（既存 draft の要件を維持）。
  ✅ **`Secure` 属性は `COOKIE_SECURE`（`wrangler.jsonc` の `vars`。既定 `"true"`）で
  切替可能**（2026-08-18確定）。本番の既定動作は変わらない（常に `Secure`）。
  ローカル `wrangler dev`（http）でブラウザ手動確認したい場合のみ、`.dev.vars` に
  `COOKIE_SECURE=false` を追記して無効化できる（`src/index.ts` の `cookieSecureOf()`）
- ✅ **有効期限（`sessions.expires_at`）は 30日**（2026-08-18確定。`SESSION_TTL_DAYS`）。
  期限切れのセッションで `GET /me` を呼ぶと 401（同時に `sessions` の当該行を削除する＝遅延削除。
  実装済み。定期実行によるバッチ掃除は無い。`schema.md` §未実装・検討事項）

---

## パスワードハッシュ

**Web Crypto の PBKDF2-HMAC-SHA256、イテレーション数 10,000。**
実測・決定の経緯は [ADR-0013](../../adr/0013-multi-user-auth-small-scale.md) §決定3
（**Workers Free プラン維持のための明示的なリスク受容**。OWASP最小推奨210,000回の約1/21）。

- ソルトはユーザーごとに `crypto.getRandomValues` でランダム生成し、
  `users.password_salt` に保存する
- `users.password_iterations` に実際に使ったイテレーション数を保存する。
  **将来イテレーション数を引き上げても、既存ユーザーは古い回数のまま検証でき、
  次回ログイン成功時に新しい回数で再ハッシュする**（段階的移行）
- 平文・可逆暗号で保存しない。ログ・エラーメッセージに出さない（`password` フィールド自体も、
  リクエストログを取る場合はマスクする）

---

## セキュリティ要件（まとめ）

- パスワードは PBKDF2 でハッシュ化する。**平文・可逆暗号で保存しない**（§パスワードハッシュ）
- セッションクッキーは `HttpOnly` `Secure` `SameSite=Lax`
- ログイン試行にレート制限をかける（§レート制限）
- ログイン失敗はタイミング攻撃対策込みで一定時間にする（§タイミング攻撃対策）
- エラー応答に内部情報（SQL・スタックトレース）を含めない
- パスワード・セッショントークンをログに出さない

## パスワードリセット

**実装しない**（[ADR-0013](../../adr/0013-multi-user-auth-small-scale.md) §決定6）。
メール送信基盤が要り、少人数運用では手間に見合わない。忘れた場合は D1 を直接更新する。

## 関連ドキュメント

- [ADR-0013](../../adr/0013-multi-user-auth-small-scale.md) — 認証方式・ロール・PBKDF2の決定
- [schema.md](../database/schema.md) — `users`/`sessions` テーブル定義
- [login-page.md](../ui/pages/login-page.md) — この API を呼ぶ画面
- [screen-list.md](../ui/screen-list.md) — `GET /me` を使うロール出し分け・ルートガード
- [company-api.md](./company-api.md) — 共通仕様・エラー形式の元
