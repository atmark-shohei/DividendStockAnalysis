# 0014: 解析ダイアログの状態を URL で表す（`?code=` ＋ `?metric=`）

- 日付: 2026-08-16
- ステータス: 承認
- 関連: [design-mock-alignment.md](../03_tasks/design-mock-alignment.md) §3 D-4、
  [ADR-0008](./0008-frontend-domain-runtime-import.md)、`.claude/rules/frontend.md`

## 文脈

[design_mock](../design_mock/README.md) が、現在インラインで表示している解析結果を
**モーダルダイアログ**に変える。さらにダイアログ内から指標詳細（配当推移の折れ線・
連続非減配年数のリスト・汎用）へドリルダウンする階層が増える。

試作の状態設計は `openStockId`（null で閉）と `activeMetricIndex`（null で概要）を
**React state に持つ**前提で書かれている。しかしこのプロジェクトには明確な規約がある。

> URL に置けるもの（表示中の画面、選択中の銘柄コード）は URL に置く。
> 旧実装はタブ切り替えを class の付け替えだけで行い、リロードと共有で選択が失われた。
> **同じ作りにしない。**（`.claude/rules/frontend.md`）

現在すでに `?code=`（選択中の銘柄）と `?useActualForScoring=`（③の採点ソース）は
URL にあり、`frontend/routes.ts` の純関数がこれを解釈している。
**モーダル化にあたって、この方針を維持するか決める必要がある。**

## 決定

**ダイアログの状態は URL が正。React state に持たない。**

### 1. ダイアログの開閉は `?code=` の有無で表す（新しいパラメータを足さない）

```
/                                  … 検索一覧のみ（ダイアログ閉）
/?code=7203                        … 7203 の解析ダイアログ（概要モード）
/?code=7203&metric=roeAverage      … 同ダイアログの ⑤ROE 詳細
/?code=7203&useActualForScoring=true … ③の採点に実績を使う（既存のまま）
```

`?dialog=open` のような専用パラメータは**足さない**。`?code=` と二重管理になり、
「`code` は無いが `dialog` は開いている」という無意味な状態が表現できてしまうため。

### 2. 指標詳細は `?metric=<MetricKey>` で表す

値は `src/domain/shared/metric-key.ts` の `MetricKey`（`dividendGrowthRate`,
`consecutiveYears`, … の camelCase 文字列）をそのまま使う。番号（`?metric=5`）にしない。
並び順が変われば指す指標が変わってしまうため。

### 3. `?metric=` の妥当性は API レスポンスと突き合わせて解決する

⚠️ **`METRIC_KEYS` を frontend にランタイム import しない。**
[ADR-0008](./0008-frontend-domain-runtime-import.md) が frontend からの domain
ランタイム import を **`src/domain/company/` 配下に限定**しており、
`METRIC_KEYS` がある `src/domain/shared/` はその allowlist に含まれていない。

代わりに次の2段構えにする。

- **`routes.ts`（純関数）**: 形式だけを見る。英字のみでなければ `null` に倒す。
  既存の `COMPANY_CODE` 正規表現と同じ「形式不正は選択なしに倒す」思想
- **ダイアログ側**: `GET /api/companies/:code` の応答に含まれる `metrics` の
  キー集合と突き合わせ、**一致しなければ概要モードにフォールバック**する

この形は、コンパイル時の定数より**実際にその銘柄で算出された指標**を基準にできる点でも
優れている。将来 `METRIC_KEYS` が増減しても frontend の修正が要らない。

### 4. 閉じる操作の対応

| 操作                         | URL の変化                                               |
| :--------------------------- | :------------------------------------------------------- |
| 行クリックでダイアログを開く | `?code=` を付ける（`metric` は付けない＝概要から始まる） |
| ✕ / 背景クリック / Escape    | `?code=` と `?metric=` の**両方**を外す                  |
| 「← 指標一覧へ戻る」         | `?metric=` **だけ**を外す                                |

試作の「開くときは必ず概要モードから始まる」は、行クリックが `?metric=` を
付けないことで自然に満たされる。一方 `?code=X&metric=Y` を直接開いた場合は
**指標詳細から始まってよい**（共有・ブックマークの利点。試作の記述と矛盾しない）。

### 5. 履歴は push する

銘柄を開く操作・指標を開く操作はいずれも `pushState`。
ブラウザの戻るで「指標詳細 → 概要 → 一覧」と1段ずつ戻れる。
「← 指標一覧へ戻る」ボタンと戻るボタンの挙動が一致する。

### 6. `useActualForScoring` は現行の扱いを変えない

- 既定値 `false` は URL に出さない
- **別の銘柄に切り替えたら `false` に戻す**（`payout-ratio-scoring.md` §7 決定5。
  「リクエスト単位の一時指定」）
- **指標詳細の出入りでは変えない。** ③ の採点ソースの指定であって、
  どの指標を見ているかとは独立した関心事

## 検討した代替案

- **案A: 試作どおり React state に持つ** — 却下。リロード・共有・戻る/進むで
  ダイアログの状態が失われる。`.claude/rules/frontend.md` が名指しで「同じ作りにしない」と
  している旧実装の失敗の再現になる
- **案B: `?dialog=open` のような専用パラメータを足す** — 却下。§決定1 のとおり
  `?code=` と二重管理になり、矛盾した状態を表現できてしまう
- **案C: パスで表現する**（`/companies/7203/metrics/roeAverage`）— 却下。
  読みやすいが、ルーティングライブラリ無しの現構成（`screen-list.md`
  「2画面に依存は要らない」）でパス階層を増やすとパーサが複雑になる。
  クエリパラメータなら `URLSearchParams` で済む
- **案D: ADR-0008 を広げて `src/domain/shared/metric-key.ts` のランタイム import を許す** —
  保留。§決定3 の「API レスポンスと突き合わせる」方式で十分足りるため、
  今回 ADR-0008 を改訂する必要は無い。将来 frontend が指標の一覧そのものを
  （銘柄に依存せず）必要とする場面が出たら再検討する

## 結果・影響

**楽になること**

- ダイアログの状態が URL 一本に集まり、`App.tsx` に新しい state が増えない
- 「7203 の ROE の詳細」を URL で共有できる
- `routes.ts` は純関数のままなので、素の Node でテストできる（`tests/frontend/routes.test.ts`）

**引き受けるトレードオフ**

- 指標をクリックするたびに履歴が積まれる。10指標を順に見ると戻るボタンを
  10回押す必要がある。ダイアログを一気に閉じたいときは ✕ / Escape を使う想定
- `?metric=` の妥当性検証がダイアログ側に寄るため、**不正な値のときに概要へ
  フォールバックする挙動をテストで固定する**必要がある

**必要になる変更**

- `frontend/routes.ts` の `Route` 型（`kind: 'list'`）に `metric: string | null` を追加。
  併せて `routeToPath` / `parseRoute` とテストを更新（T-095）
- ダイアログ実装時に「不正な `?metric=` → 概要」のフォールバックを入れる（T-096）

**見直しのトリガー**

- 画面数が増えてクエリパラメータでの表現が苦しくなる（案C の再検討）
- frontend が銘柄に依存しない指標一覧を必要とする（案D の再検討）
