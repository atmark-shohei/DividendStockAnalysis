# 画面一覧・遷移図

> ステータス: 🟡 設計確定・実装未着手（2026-08-16 全面改訂）／🟢 `/` と `/input` は実装済み／
> 🟢 `/login` `/signup` は FE・BE とも実装済み（2026-08-18、T-091。結合テスト
> `tests/integration/auth-flow.test.ts` で確認済み）／
> 🟢 ロールガード（`resolveRouteGuardRedirect`）・nav出し分け（`shouldShowInputTab`）は FE 実装済み
> （2026-08-18、T-092）。`/input` の**実効的な**制限（BE `requireRole('admin')`）も
> T-091で `POST/DELETE /api/companies` へ配線済み。ラベルを「銘柄登録」へ変更済み（T-104）
>
> 🟢 `/`（検索）は §3.1 の `q`/`sort`/`page` を含めて FE 実装済み（2026-08-19、T-094。
> `pages/ListPage.tsx`。詳細は [search-page.md](./pages/search-page.md) の変更履歴）。
>
> 🟢 `routes.ts` の `?metric=` 形式チェック（`parseRoute`/`routeToPath`/`createListRoute`）は
> 実装済み（2026-08-19、T-095）。
>
> 🟢 **解析ダイアログの枠組み（F-51）は実装済み**（2026-08-20、T-096。
> `frontend/components/Dialog.tsx` 新規実装＋概要モードの移設）。フォーカストラップ・
> Escape・`aria-modal`・背景クリック・フォーカス復帰・概要モード（総合スコア・
> ヒーロー行の株価/PER/PBR・レーダー・指標比較表）まで実装。
> 🟢 **指標詳細モードのうち F-52（配当推移の線グラフ）は実装済み**（2026-08-20、T-097。
> `frontend/components/DividendLineChart.tsx`）。
> 🟢 **F-53（連続非減配年数のリスト）も実装済み**（2026-08-22、T-098。
> `frontend/components/ConsecutiveYearsList.tsx`）。`?metric=` の実在検証
> （`resolveActiveMetric`。[ADR-0014](../../adr/0014-analysis-dialog-url-state.md) §決定3）
> はダイアログ側（`pages/ListPage.tsx`）で実装済み。
>
> 🟢 **`/criteria`（評価基準タブ、F-31）は実装済み**（2026-08-22、T-099。
> `frontend/pages/CriteriaPage.tsx`）。`GET /api/scoring/bands` から取得したデータで
> 10カードを動的に描画する。詳細は [criteria-tab.md](./pages/criteria-tab.md) の変更履歴を参照。
>
> ⚠️ **2026-08-16 に 2画面 → 6画面へ全面改訂した。**
> [design_mock](../../design_mock/README.md) の反映（[design-mock-alignment.md](../../03_tasks/design-mock-alignment.md) T-071）と、
> 認証の導入決定（[ADR-0013](../../adr/0013-multi-user-auth-small-scale.md)）による。
> 改訂前の2画面構成（`/` と `/input` のみ、ロールなし）は git 履歴を参照。

## 変更履歴

- **2026-07-28**: ルーティング無しの単一ページ → URL ルーティングによる2画面へ分割
- **2026-08-16**: 6画面へ全面改訂。ロールによる出し分け、解析結果のモーダル化、
  検索のサーバサイドページングを反映
- **2026-08-19**（T-094）: `/`（検索）の `q`/`sort`/`page`・空状態・ページング・一覧行の
  総合点表示（`<ScoreBar>`）を FE 実装。F-50 を 🔴 → 🟢 に更新。F-51（解析ダイアログの
  モーダル化）は引き続きスコープ外（行クリックは既存のインライン表示を維持。T-096）
- **2026-08-19**（T-095）: `routes.ts` に `?metric=` クエリパラメータの形式チェックを追加
  （`Route`型の `kind: 'list'` に `metric: string | null` フィールド、`parseRoute`/
  `routeToPath`/`createListRoute` へ反映）。ルーティング層のみの変更で、F-51〜F-53
  （ダイアログ UI 本体）の状態は 🔴 のまま変わらない（T-096 未着手）。
- **2026-08-20**（T-096）: `frontend/components/Dialog.tsx` を新規実装（フォーカストラップ・
  `aria-modal`・Escape・背景クリック・フォーカス復帰）し、`pages/ListPage.tsx` の
  解析結果インライン表示を `<Dialog>` でラップして概要モード（総合スコア・ヒーロー行の
  株価/PER/PBR・レーダー・指標比較表）を移設。F-51 を 🔴 → 🟢 に更新。
  `MetricTable.tsx` の行クリックで `?metric=` へ遷移する導線も実装。**指標詳細モードの
  中身（F-52線グラフ・F-53連続年数リスト・汎用の条件表）は未実装のまま**
  （プレースホルダー表示。T-097/T-098 に委ねる。fe-plan.md §0 確認事項A、Manager確認済み）。
- **2026-08-20**（T-096 fe-reviewer レビュー是正）: 上記 F-51 実装への2巡目レビュー
  （CR-1〜CR-8 + NEW-1・NEW-2）で検出した齟齬をすべて解消。指標比較表のスコア列への
  `<ScoreBar>` 追加、概要モードのヒーロー行の2カラムグリッド化（総合スコアカード左・
  レーダーチャート右）、ダイアログ内エラー表示への `role="alert"` 追加、ヘッダーへの
  銘柄コード併記、概要⇄指標詳細モード切り替え時のフォーカス管理などを含む
  （詳細は [analysis-dialog.md](./pages/analysis-dialog.md) の変更履歴を参照）。
  F-51 の状態・対応範囲（枠組み・概要モードのみ実装済み、指標詳細モードの中身は
  T-097/T-098 待ち）に変更は無い
- **2026-08-20**（T-097）: `frontend/components/DividendLineChart.tsx` を新規実装し、
  解析ダイアログの指標詳細モードのうち F-52（配当推移の線グラフ）の中身
  （折れ線グラフ＋年度別表）を実装。F-52 を 🔴 → 🟢 に更新。F-53（連続非減配年数の
  リスト）は引き続き未実装のまま（プレースホルダー表示。T-098 に委ねる）
  （詳細は [analysis-dialog.md](./pages/analysis-dialog.md) の変更履歴を参照）
- **2026-08-22**（T-098）: `frontend/components/ConsecutiveYearsList.tsx` を新規実装し、
  解析ダイアログの指標詳細モードのうち F-53（連続非減配年数のリスト）の中身を実装。
  増配/据置/減配の判定・前年差の算出は BE domain（`describeConsecutiveYearRows()`）で
  完了済みで、FE は判定ロジックを持たない。F-53 を 🔴 → 🟢 に更新
  （詳細は [analysis-dialog.md](./pages/analysis-dialog.md) の変更履歴を参照）
- **2026-08-22**（T-099）: `/criteria`（評価基準タブ、F-31）を実装
  （`frontend/pages/CriteriaPage.tsx`・`frontend/pages/criteria-content.ts`・
  `frontend/components/MetricCriteriaCard.tsx`・`frontend/components/ImplementationBadge.tsx`）。
  `GET /api/scoring/bands`（T-099で新規実装したBE API）から取得したデータで10カードを
  動的に描画し、区分表のリテラルは画面側に持たない。F-31 を 🔴 → 🟢 に更新
  （詳細は [criteria-tab.md](./pages/criteria-tab.md) の変更履歴を参照）

---

## 1. 画面一覧（6画面 / 7 URL）

**画面の選択も、銘柄の選択も、検索条件も、すべて URL が正。**
リロード・共有・戻る/進むで状態が失われない（`.claude/rules/frontend.md`）。

| URL           | 画面             | ロール      | 実装                                                                             | 詳細設計                                                     |
| :------------ | :--------------- | :---------- | :------------------------------------------------------------------------------- | :----------------------------------------------------------- |
| `/`           | 検索             | 全員        | 🟢 `pages/ListPage`（T-094・T-096・T-097・T-098）                                | [search-page.md](./pages/search-page.md)（T-072）            |
| `/criteria`   | 評価基準         | 全員        | 🟢 `pages/CriteriaPage`（T-099）                                                 | [criteria-tab.md](./pages/criteria-tab.md)                   |
| `/portfolio`  | ポートフォリオ   | user, admin | 🔴 未実装                                                                        | [portfolio-page.md](./pages/portfolio-page.md)（T-081）      |
| `/indicators` | 指標カスタマイズ | user, admin | 🔴 未実装                                                                        | [indicator-custom-page.md](./pages/indicator-custom-page.md) |
| `/input`      | 銘柄登録         | **admin**   | 🟢 `pages/InputPage`（FE ガード・BE制限・ラベルとも実装済み。T-091/T-092/T-104） | [market-data-import.md](./pages/market-data-import.md)       |
| `/login`      | ログイン         | 未ログイン  | 🟢 `pages/AuthPage`（FE・BEとも実装済み。T-091）                                 | [login-page.md](./pages/login-page.md)（T-075）              |
| `/signup`     | アカウント作成   | 未ログイン  | 🟢 同上（1画面2モード）                                                          | 同上（1画面2モード）                                         |

- **`/input` のパスは変えない。** 画面名は「データ入力」→「銘柄登録」（T-104で変更済み）。
  パスを変えても得るものが無く、既存のテスト・ドキュメントの参照が壊れるだけ
- **ログインとアカウント作成は1つの画面の2モード**（試作のセグメント切替）。
  ただし URL は分ける。共有・ブックマークできるほうが素直で、
  「どちらのモードか」を state に持たずに済む

## 2. ロールによるタブの出し分け

ロールは[ADR-0013](../../adr/0013-multi-user-auth-small-scale.md) の3つ。

| タブ             | guest（未ログイン） | user | admin |
| :--------------- | :------------------ | :--- | :---- |
| 検索             | ✅                  | ✅   | ✅    |
| ポートフォリオ   | —                   | ✅   | ✅    |
| 指標カスタマイズ | —                   | ✅   | ✅    |
| 評価基準         | ✅                  | ✅   | ✅    |
| 銘柄登録         | —                   | —    | ✅    |

- **ロールは必ずセッションから決まる。** 試作の「デモ表示」ロール切替コントロールは
  **出荷しない**（[ADR-0013](../../adr/0013-multi-user-auth-small-scale.md) §決定1）
- **タブを隠すことは認可ではない。** 保護は API 側でも必ず行う
  （`.claude/rules/backend.md`。フロントの表示制御だけに頼らない）
- 認証エリア: 未ログインは「ログイン」ボタン、ログイン済みはメールアドレス＋
  （admin なら）`<RoleBadge>`＋「ログアウト」

## 3. クエリパラメータ

### 3.1 検索（`/` のみ）

| パラメータ | 値                                                       | 既定               |
| :--------- | :------------------------------------------------------- | :----------------- |
| `q`        | 銘柄コード・銘柄名の部分一致                             | 空（絞り込まない） |
| `sort`     | `created_desc` / `score_desc` / `score_asc` / `code_asc` | `created_desc`     |
| `page`     | 1以上の整数                                              | `1`                |

- **既定値は URL に出さない**（既存の `useActualForScoring` と同じ流儀）
- `q` を変えたら `page` を 1 に戻す。`sort` を変えたときも同じ
- 1ページ 15件。**サーバサイドページング**（D-7。`.claude/rules/backend.md`
  「一覧取得は1クエリか JOIN で済ませる」）。総合点でのソートは `score_cards` 側に
  あるためクライアントでは実現できない
- 形式不正（`sort` が未知の値、`page` が数値でない）は**既定値に倒す**。
  既存の `parseRoute` が不正な `code` を「選択なし」に倒すのと同じ思想

### 3.2 解析ダイアログ（`/` と `/portfolio` の両方）

**[ADR-0014](../../adr/0014-analysis-dialog-url-state.md) が正。**
ポートフォリオの保有銘柄行からも同じダイアログを開くため、
これらのパラメータは**2つの画面で共通**に効く。

| パラメータ            | 意味                                   |
| :-------------------- | :------------------------------------- |
| `code`                | 開いている銘柄。無ければダイアログは閉 |
| `metric`              | 指標詳細のキー。無ければ概要モード     |
| `useActualForScoring` | ③ の採点に実績を使うか。既定 `false`   |

### 3.3 ポートフォリオ（`/portfolio` のみ）

| パラメータ  | 意味                     | 既定                 |
| :---------- | :----------------------- | :------------------- |
| `portfolio` | 表示中のポートフォリオID | 先頭のポートフォリオ |

### 3.4 指標カスタマイズ（`/indicators`）

**クエリパラメータを持たない。** 選択状態・入力途中の基準値は URL に置かない
（[indicator-custom-page.md](./pages/indicator-custom-page.md) §1 に理由）。

### 3.5 ログイン（`/login`・`/signup`）

| パラメータ | 意味                           |
| :--------- | :----------------------------- |
| `redirect` | ログイン成功後に戻る画面のパス |

> ⚠️ **オープンリダイレクト対策。** `redirect` は**相対パスのみ許可**する。
> `/` で始まり、かつ `//` で始まらないものだけを受け付け、それ以外は `/` に倒す
> （[login-page.md](./pages/login-page.md) §セキュリティ）。

## 4. 画面構造

```
┌────────────────────────────────────────────────────────┐
│ header: ▌高配当銘柄スコアリング      [メール] [管理者] [ログアウト] │
├────────────────────────────────────────────────────────┤
│ nav: [検索] [ポートフォリオ] [指標カスタマイズ] [評価基準] [銘柄登録] │
│      └ ロールで出し分け。現在地は下線＋太字＋aria-current="page"   │
├────────────────────────────────────────────────────────┤
│                                                        │
│  各画面の本体（§1 の詳細設計を参照）                        │
│                                                        │
│  ┌──────────────────────────────────────┐              │
│  │ 解析ダイアログ（?code= があるとき）        │  ← / と       │
│  │  概要モード / 指標詳細モード（?metric=）  │    /portfolio │
│  └──────────────────────────────────────┘    から開く    │
│                                                        │
├────────────────────────────────────────────────────────┤
│ footer: 免責文言（常時表示、F-34）                        │
└────────────────────────────────────────────────────────┘
```

## 5. 画面遷移

### 5.1 通常の遷移

| 起点         | 操作                      | 遷移先                                 |
| :----------- | :------------------------ | :------------------------------------- |
| どの画面でも | nav のタブ                | 各画面の URL                           |
| どの画面でも | ヘッダーの「ログイン」    | `/login?redirect=<現在のパス>`         |
| どの画面でも | ヘッダーの「ログアウト」  | `/`（セッション破棄後）                |
| `/`          | 行クリック                | `/?code=<コード>`（ダイアログを開く）  |
| `/portfolio` | 保有銘柄の行クリック      | `/portfolio?code=<コード>`             |
| ダイアログ   | 指標行クリック            | `?metric=<キー>` を追加                |
| ダイアログ   | 「← 指標一覧へ戻る」      | `?metric=` だけ外す                    |
| ダイアログ   | ✕ / 背景クリック / Escape | `?code=` と `?metric=` の両方を外す    |
| `/login`     | ログイン成功              | `redirect` のパス（無ければ `/`）      |
| `/login`     | 「アカウント作成」タブ    | `/signup`（`redirect` を引き継ぐ）     |
| `/signup`    | 登録成功                  | ログイン状態にして `redirect` のパスへ |
| `/input`     | 解析に成功                | `/?code=<コード>`                      |
| `/input`     | 解析に失敗                | 遷移しない（入力内容を失わせない）     |

### 5.2 権限による遷移（ルートガード）

| 状況                                       | 挙動                                              |
| :----------------------------------------- | :------------------------------------------------ |
| guest が `/portfolio` `/indicators` を開く | `/login?redirect=<元のパス>` へ**リダイレクト**   |
| guest が `/input` を開く                   | 同上                                              |
| user が `/input` を開く                    | **`/` へリダイレクト。** ログイン画面へは送らない |
| ログイン済みが `/login` `/signup` を開く   | `/` へリダイレクト                                |
| 未知のパス                                 | `/` へ倒す（既存の `parseRoute` の挙動を維持）    |

**user が `/input` を開いたときにログイン画面へ送らないのは、既にログインしているため。**
「ログインし直せば見られる」と誤解させる。権限不足であることが分かる導線にする。

## 6. 機能ID との対応

| 機能ID | 内容                                 | 状態 | 対応する画面                   |
| :----- | :----------------------------------- | :--- | :----------------------------- |
| F-30   | データ入力・解析（→ 銘柄登録）       | 🟢   | `/input`                       |
| F-31   | 評価基準タブ                         | 🟢   | `/criteria`                    |
| F-32   | 保存済み銘柄タブ（→ 検索へ発展）     | 🟢   | `/`                            |
| F-33   | 銘柄間の横並び比較                   | 🔴   | 未着手（P2 へ降格。D-6）       |
| F-34   | 免責文言の常時表示                   | 🟢   | footer（全画面）               |
| F-50   | 銘柄検索（検索・ソート・ページング） | 🟢   | `/`                            |
| F-51   | 解析ダイアログ（モーダル化）         | 🟢   | `/?code=` / `/portfolio?code=` |
| F-52   | 指標詳細（配当推移の線グラフ）       | 🟢   | `?metric=dividendGrowthRate`   |
| F-53   | 指標詳細（連続非減配年数のリスト）   | 🟢   | `?metric=consecutiveYears`     |
| F-54   | 認証（サインアップ・ログイン）       | 🟡   | `/login` / `/signup`           |
| F-55   | ロールによる画面の出し分け           | 🔴   | nav（§2）                      |
| F-56   | ポートフォリオ管理                   | 🔴   | `/portfolio`                   |
| F-57   | ポートフォリオ集計                   | 🔴   | `/portfolio`                   |
| F-58   | 指標カスタマイズ                     | 🔴   | `/indicators`                  |

## 7. この構成で守っていること

- **画面状態を URL に置く**（`.claude/rules/frontend.md`）。旧実装
  （`reference/legacy-web/`）はタブ切り替えを `class="active"` の付け替えだけで行っており、
  リロード・共有で状態が失われた。**モーダル化してもこの方針を外さない**
  （[ADR-0014](../../adr/0014-analysis-dialog-url-state.md)）
- **URL の解釈は純関数に閉じる。** `frontend/routes.ts`（DOM 非依存・テスト対象）と
  `frontend/use-route.ts`（History API）を分けてある。テストは `tests/frontend/routes.test.ts`
- **ルーティングライブラリを足さない。** 7 URL でもクエリパラメータの解釈が主で、
  `URLSearchParams` で足りる（`~/.claude/rules/security.md`
  「新しい依存を追加する前に既存で足りないか確認する」）
- **データ取得は `App` と `api.ts` だけ。** `pages/` は props で受け取る（ルート `CLAUDE.md`）
- **タブを隠すことを認可の手段にしない。** API 側でも必ず権限を検査する
- Worker 側は `not_found_handling: "single-page-application"` により、
  増えた URL の直打ちもそのまま `index.html` へ流れる。**`wrangler.jsonc` の変更は不要**
- ③ 予想配当性向の採点ソース切替は「リクエスト単位の一時指定」
  （`payout-ratio-scoring.md` §7 決定5）として URL に置き、DB には保存しない。
  `?code=` を切り替えたときは `false` へ戻す

## 8. この構成のトレードオフ

- **`/input` で解析に成功すると入力内容は失われる。** `/` へ遷移して `CompanyForm` が
  アンマウントされるため。データ入力と一覧を分ける決定を優先した結果であり、意図的
- 解析直後も POST の戻り値を使わず `GET /api/companies/:code` を取り直している。
  情報源を URL 一本に絞るため。往復が1回増える
- **指標をクリックするたびに履歴が積まれる**（[ADR-0014](../../adr/0014-analysis-dialog-url-state.md)）。
  一気に閉じたいときは ✕ / Escape を使う
- **nav のタブが最大5つになる。** 横並びで収まる想定だが、
  モバイル対応（§10）に着手するときは形を再検討する

## 9. 全画面共通の要件

- 免責文言を常時表示する（投資助言ではない旨）— 実装済み（footer）
- データ取得中の表示 — **部分的に実装。** 解析結果は「読み込み中…」を出すが、
  一覧の初回取得中の表示（スケルトン等）は無い
- エラー時は「何が起きたか」と「次に何をすればよいか」を表示する（`role="alert"`）
- 現在地を色だけで示さない — nav は下線＋太字＋`aria-current="page"`
- **色・余白・フォントサイズは [design-tokens.md](./design-tokens.md) のトークンを使う。**
  コンポーネントに直値を書かない
- 共通部品は [components.md](./components.md) を参照

## 10. レスポンシブ

未対応。試作もデスクトップ（コンテンツ最大幅 1160px）のみを想定しており、
モバイル・デスクトップでレイアウトを出し分ける実装は無い（着手時期は未定）。
`frontend/style.css` に `@media` は1件も無い。

## 11. 関連ドキュメント

- [design-tokens.md](./design-tokens.md) — 色・タイポ・余白のトークン
- [components.md](./components.md) — 共通 UI コンポーネント
- [pages/criteria-tab.md](./pages/criteria-tab.md) — 評価基準（F-31）
- [pages/indicator-custom-page.md](./pages/indicator-custom-page.md) — 指標カスタマイズ（F-58）
- [pages/login-page.md](./pages/login-page.md) — ログイン・アカウント作成（F-54）
- [pages/market-data-import.md](./pages/market-data-import.md) — 銘柄登録の取り込みボタン
- [company-api.md](../api/company-api.md) — 検索・解析が呼ぶ API
- [ADR-0013](../../adr/0013-multi-user-auth-small-scale.md) — 認証とロール
- [ADR-0014](../../adr/0014-analysis-dialog-url-state.md) — ダイアログの URL 設計
