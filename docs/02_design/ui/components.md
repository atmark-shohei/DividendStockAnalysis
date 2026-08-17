# 共通 UI コンポーネント設計

> ステータス: 🟡 draft（2026-08-16 全面改訂）

配置先は `frontend/components/`。**すべて props を受け取って描画するだけ**。
データ取得も計算もしない（`.claude/rules/frontend.md` 参照）。

## 変更履歴

- **2026-08-16**: 配置先の誤り（`src/components/`）を訂正、実装済みコンポーネントの棚卸しを追加、
  design_mock 由来の新規部品を追加、§未決定 の3項目を決着（T-084）

---

## 0. ⚠️ 配置先の訂正

**旧版は配置先を `src/components/` としていたが、このディレクトリは存在しない。**
FE の実体は `frontend/components/` で、`src/components/` は Next.js 時代に残った
空ディレクトリ（`.claude/CLAUDE.md`「ここに新しいコンポーネントを追加しない」）。
以降このファイルの配置先はすべて `frontend/components/` を指す。

## 1. 既に実装済みのコンポーネント（2026-08-16 実測）

**旧版はこの棚卸しを持たず、設計中の部品と未実装の部品が区別できなかった。**
以下は `frontend/components/` に実在するファイルで、いずれも props を受け取って
描画するだけの既存規約に沿っている。

| コンポーネント       | ファイル                 | 用途                                                                                                                                      |
| :------------------- | :----------------------- | :---------------------------------------------------------------------------------------------------------------------------------------- |
| `NavBar`             | `NavBar.tsx`             | 2画面の切り替え。`<a href>` ベース（`.claude/rules/frontend.md` の対話要素規約）                                                          |
| `MetricTable`        | `MetricTable.tsx`        | 10指標のスコア一覧。`<table>` 使用                                                                                                        |
| `ScoreRadar`         | `ScoreRadar.tsx`         | 10指標のレーダーチャート。**Recharts** を使用（§4 参照）                                                                                  |
| `BalanceSheetFields` | `BalanceSheetFields.tsx` | ⑥用の貸借対照表4項目の入力欄                                                                                                              |
| `CompanyForm`        | `CompanyForm.tsx`        | データ入力画面の中心。**1954行と大きく、既存規約の「100行超で分割検討」を超過している**（新規の分割は本ファイルの対象外。別タスクで扱う） |

`frontend/format.ts` には `<Money>` / `<Yield>` / `<FetchedAt>` に相当する**関数版**
（`formatSen` / `formatMetricValue` / `formatFetchedAt`）が既にある。
下の §2「表示系」はこれをコンポーネント化する設計であり、**関数自体は流用**する
（丸め・単位付与のロジックを二重に持たない）。

**`<Delta>`（増減の `▲`/`▼` 表示）は関数版も含めて未実装。**
`frontend/` 全体を検索しても `▲` `▼` の使用箇所が無い
（[design-mock-alignment.md](../../03_tasks/design-mock-alignment.md) §2.6 の実測）。

## 2. 表示系（設計のみ・未実装）

### `<Money>`

金額表示。**アプリ内で金額を出す箇所はすべてこれを通す。**

```tsx
<Money sen={16000} />          // → 160 円
<Money sen={null} />           // → —
<Money sen={0} />              // → 0 円
```

| props  | 型               | 説明                                  |
| ------ | ---------------- | ------------------------------------- |
| `sen`  | `number \| null` | 銭単位の整数。`null` は「データなし」 |
| `unit` | `'yen' \| 'sen'` | 表示単位。既定 `yen`                  |

- 3桁区切り＋単位を必ず付ける
- `null` は `—`。**0 と混同させない**（無配とデータ欠損は別物）
- 丸めは `frontend/format.ts` の `formatSen` に委譲する（このファイルでは再実装しない）

### `<Yield>`

配当利回り表示。

```tsx
<Yield bp={533} isForecast={false} />   // → 5.33%
<Yield bp={null} />                     // → —
<Yield bp={533} isForecast={true} />    // → 5.33%（予想）
```

- ベーシスポイント（整数）を受け取り、小数第2位＋`%` で表示
- **予想値には必ず「（予想）」を付ける。** 実績と見分けが付かない表示にしない
- `null` は `—`

### `<FetchedAt>`

データ取得時刻。UTC を受け取り JST で表示する（`formatFetchedAt` に委譲）。
一定時間を超えたら「情報が古い可能性があります」と警告を出す。

### `<Delta>`

増減表示（増配・減配など）。**現時点で完全未実装**（関数版も無い）。

- **色だけで増減を表さない。** `▲` / `▼` と文言を必ず併記する
- 0 のときは `—`（`±0` と表示しない）
- 色は `--color-positive` / `--color-negative`（[design-tokens.md](./design-tokens.md) §2.1）。
  **ポートフォリオの評価損益と、配当・指標の増減とで色の意味が違わないことを確認すること**
  （両方とも同じ2色で構わないが、スコアには使わない。同 §2.2）

### `<ScoreBar>`（design_mock 由来。新規）

総合点・指標別スコアの進捗バー。試作の「4px高・`--color-data`塗り・`--color-line`トラック」を
そのまま採用する。

```tsx
<ScoreBar value={7} max={10} />   // 検索一覧の行、解析ダイアログの指標テーブル
<ScoreBar value={62} max={100} width="92px" />  // 検索一覧の hero スコア
```

| props   | 型       | 説明                                                    |
| ------- | -------- | ------------------------------------------------------- |
| `value` | `number` | 現在値                                                  |
| `max`   | `number` | 満点。指標カスタマイズ実装後は選択指標数×10（ADR-0012） |
| `width` | `string` | 既定は `100%`。検索一覧の hero だけ固定幅（試作準拠）   |

- 塗りは常に `--color-data`（中立グレー）。**緑・赤を使わない**（推奨をしない立場の表現。
  [design-tokens.md](./design-tokens.md) §2.2）
- `max` が可変になる（ADR-0012）ため、**割合は呼び出し側ではなくこのコンポーネント内で
  `value / max` として計算する。** 呼び出し側にパーセント計算を持たせない

## 3. レイアウト系

| コンポーネント         | 用途                                                                       | 状態     |
| ---------------------- | -------------------------------------------------------------------------- | -------- |
| `<PageHeader>`         | 画面タイトル＋最終取得時刻                                                 | 設計のみ |
| `<DataTable>`          | 一覧表示。`<table>` を使う。ソート・ページングは URL 連動                  | 設計のみ |
| `<StockCard>`          | モバイル用の銘柄カード                                                     | 設計のみ |
| `<EmptyState>`         | 0件時。「なぜ0件か」と次の操作を示す                                       | 設計のみ |
| `<ErrorState>`         | エラー時。原因と次の操作を示す                                             | 設計のみ |
| `<Skeleton>`           | ロード中。実データと同じ高さにしてレイアウトを飛ばさない                   | 設計のみ |
| `<Dialog>`（新規）     | 解析ダイアログの土台。scrim＋モーダルカード＋Escape/scrim クリックで閉じる | 設計のみ |
| `<Pagination>`（新規） | 「← 前へ」「N / total」「次へ →」。既定15件/ページ。前後端で disabled      | 設計のみ |

### `<Dialog>`（design_mock 由来。新規）

```tsx
<Dialog open={code !== null} onClose={() => navigate({ ...route, selectedCode: null })}>
  {children}
</Dialog>
```

- scrim: `rgba(6,8,12,0.74)` + `backdrop-filter: blur(3px)`（フルビューポート固定）
- カード: `max-width: 940px`、`border-radius: --radius-2xl`、影は `--shadow-dialog`
  （このアプリで唯一シャドウを使う場所。[design-tokens.md](./design-tokens.md) §4）
- **開閉の状態自体はこのコンポーネントが持たない。** 開閉は呼び出し側（`App`/ページ）が
  URL 経由で制御する（`.claude/rules/frontend.md`「画面状態は URL に置く」）。
  `<Dialog>` は `open` を受け取って描画するだけ
- フォーカストラップ・`aria-modal="true"`・Escape ハンドリングは内部実装
  （呼び出し側に強制しない）

### `<Pagination>`（design_mock 由来。新規）

```tsx
<Pagination page={2} pageCount={7} onChange={(page) => navigate({ ...route, page })} />
```

- 前後端で「← 前へ」「次へ →」が `disabled`（見た目・機能の両方）
- ページ番号自体は URL クエリに反映する（呼び出し側の責務。`<SelectFilter>` と同じ扱い）

## 4. 入力系

| コンポーネント     | 注意点                                                                      | 状態     |
| ------------------ | --------------------------------------------------------------------------- | -------- |
| `<NumberInput>`    | 全角数字を半角に正規化。範囲検証必須                                        | 設計のみ |
| `<StockCodeInput>` | 4桁形式を検証してから確定                                                   | 設計のみ |
| `<SelectFilter>`   | 値は URL クエリに反映する                                                   | 設計のみ |
| `<Toggle>`（新規） | 指標カスタマイズの選択トグル。22×22px 角丸スクエア、選択時 `--color-action` | 設計のみ |

### `<Toggle>`（design_mock 由来。新規）

```tsx
<Toggle checked={selected} onChange={(checked) => ...} disabled={atLimit} aria-label="増配率（5年CAGR）を選択" />
```

- ネイティブ `<input type="checkbox">` をベースにする（`div` + `onClick` にしない）
- 見た目のカスタマイズは CSS のみ。`role`/`aria-*` は checkbox の既定挙動に任せる
- 選択数の上限/下限に達したときは `disabled` にせず、`onChange` 側で no-op にする
  （[indicator-custom-page.md](./pages/indicator-custom-page.md) §5。`disabled` にすると
  「なぜ押せないか」がスクリーンリーダーに伝わらないため）

## 5. バッジ・ラベル系

| コンポーネント        | 用途                                                                                                                                                                                                                                                                                              | 状態     |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| `<Badge>`（新規）     | 汎用の状態ラベル。評価基準タブの「自動計算済」（枠線・`--color-text-secondary`）「未実装」（`--color-caution`）（[criteria-tab.md](./pages/criteria-tab.md) §2.2）、指標カスタマイズの「配当利回り・増配率から自動算出」チップ（[indicator-custom-page.md](./pages/indicator-custom-page.md) §2） | 設計のみ |
| `<RoleBadge>`（新規） | ヘッダーの「管理者」バッジ専用。常に `--color-caution`。**`<Badge>` と役割を分ける**（下記）                                                                                                                                                                                                      | 設計のみ |

`<RoleBadge>` を `<Badge>` と別コンポーネントにするのは、**色の役割の排他ルール**
（[design-tokens.md](./design-tokens.md) §2.2）を型で守るため。`<Badge>` は文言に応じて
`--color-caution` にも `--color-text-secondary` にもなるが、`<RoleBadge>` は
「ユーザーの権限」という1つの意味にしか使わない（試作の色の役割一覧「管理者バッジ」専用）。
汎用の `<Badge>` にロール表示も担わせると、将来 caution 色の別バッジが増えたときに
「これはロール表示か、それとも警告か」が呼び出し側のコードから読み取れなくなる。

## 6. 命名・配置（実態に合わせて訂正）

**旧版は `money/Money.tsx` のようなカテゴリ別サブディレクトリを想定していたが、
実装は一貫してフラット配置。** 既存の5ファイル（§1）がすべて
`frontend/components/<PascalCase>.tsx` に直置きされており、この慣習に従う。

```
frontend/components/
  NavBar.tsx           （実装済み）
  MetricTable.tsx       （実装済み）
  ScoreRadar.tsx         （実装済み）
  BalanceSheetFields.tsx （実装済み）
  CompanyForm.tsx        （実装済み）
  Money.tsx              （設計のみ）
  Yield.tsx               （設計のみ）
  ScoreBar.tsx             （設計のみ）
  Dialog.tsx                （設計のみ）
  ...
```

1コンポーネント1ファイル。100行を超えたら分割を検討する
（`CompanyForm.tsx` は既存の例外。§1 参照）。

## 7. 未決定（2026-08-16 決着）

旧版は3項目とも未決定だったが、design_mock の反映（[design-mock-alignment.md](../../03_tasks/design-mock-alignment.md)）に伴い実装状況を調べたところ、実質的にすでに決着していた。

| 項目                                   | 決着                                                                                                                                                                                                                                                                                                     |
| :------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| スタイル手法                           | **素の CSS ＋ カスタムプロパティ。** Tailwind / CSS Modules は導入しない（D-5。[design-tokens.md](./design-tokens.md) §1）                                                                                                                                                                               |
| UI ライブラリを使うか                  | **使わない。** 既存5コンポーネントがいずれも素の HTML 要素のみで構成されており、外部 UI ライブラリへの依存が無い                                                                                                                                                                                         |
| チャートライブラリ（配当推移グラフ用） | **Recharts。** `ScoreRadar.tsx` が既に採用済み（`package.json` の依存）。design_mock 自身も「ターゲットのコードベースが既に使っている手法で作り直す」よう指示しており（[design_mock/README.md](../../design_mock/README.md) §Assets）、レーダーと同じ Recharts を配当推移の折れ線グラフ（T-097）にも使う |

## 8. 関連ドキュメント

- [design-tokens.md](./design-tokens.md) — 色・タイポ・余白のトークン（本ファイルの部品はすべてこれを使う）
- [criteria-tab.md](./pages/criteria-tab.md) — `<Badge>` の利用例
- [indicator-custom-page.md](./pages/indicator-custom-page.md) — `<Toggle>` / `<Badge>`（chip）の利用例
- [design-mock-alignment.md](../../03_tasks/design-mock-alignment.md) — 反映計画（T-084）
