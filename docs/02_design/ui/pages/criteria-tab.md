# 評価基準タブ 設計書

> 出典: OneDrive「銘柄スカウティング」`docs/design_criteria_tab.md`（2026-07-26 取り込み）
> 参照先ファイル名のみ、本リポジトリの構成に合わせて更新した。内容は変更していない。

## 変更履歴

- **2026-05-05**: 新規作成。要件定義書に基づく10指標のスコア表表示 UI について定義
- **2026-07-26**: 本リポジトリへ取り込み。参照リンクを更新
- **2026-07-27**: §2.1「カード一覧と実装状態」を追加。⑩ 配当利回りを自動計算済として掲載（T-047）
- **2026-07-28**: 軽量DDD移行（[ADR-0001](../../../adr/0001-runtime-cloudflare-workers.md)）により
  10指標すべてが `src/domain/scoring/` に実装済みになったため §2.1 を更新。
  この画面（F-31 評価基準タブ）自体は依然として**未実装**。
  実装先は `src/lib/` ではなく `src/domain/scoring/`（§3 も参照）

---

## 1. 概要

[scoring-requirements.md](../../../01_requirements/scoring-requirements.md) で定義された
10個の指標の評価ロジックを、ユーザー向けに一覧表示して説明するタブ。

## 2. UI デザインと表示要素

- 各指標はカード形式（ガラスモーフィズムスタイル）でグリッド表示する
- 自動計算に対応している指標（ROE、EPS CAGR 等）のタイトルには「自動計算済」バッジを付与し、
  緑色系でハイライトする
- 自動計算に未対応の指標には「未実装」バッジを付与する
- カード内には計算式の簡単な説明と、条件・点数のテーブルを記載し、
  ユーザーが点数の根拠をすぐに確認できるようにする

### 2.1. カード一覧と実装状態（2026-07-27 追加）

10指標ぶんのカードをこの順で並べる。「実装」列は**設計時点の追跡用**であり、
画面のバッジはここからではなく**スコアリングエンジンが返す実装済み指標の一覧**から
描画する（§3 参照）。表とバッジが二重管理になるのを避けるため、
実装が進んだらこの表も更新するが、正はあくまでエンジン側。

| #   | カード見出し        | 実装（エンジン）                                                                                                  | 詳細設計                                                                             |
| :-- | :------------------ | :---------------------------------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------- |
| ①   | 直近5年間の増配率   | 🟢 自動計算済                                                                                                     | [dividend-growth-rate-scoring.md](../../logic/dividend-growth-rate-scoring.md)       |
| ②   | 連続非減配年数      | 🟢 自動計算済                                                                                                     | [consecutive-years-scoring.md](../../logic/consecutive-years-scoring.md)             |
| ③   | 予想配当性向        | 🟢 自動計算済                                                                                                     | [payout-ratio-scoring.md](../../logic/payout-ratio-scoring.md)                       |
| ④   | EPS の5年 CAGR      | 🟢 自動計算済                                                                                                     | [eps-cagr-scoring.md](../../logic/eps-cagr-scoring.md)                               |
| ⑤   | ROE の5年平均       | 🟢 自動計算済                                                                                                     | [roe-scoring.md](../../logic/roe-scoring.md)                                         |
| ⑥   | 配当維持可能年数    | 🟢 自動計算済                                                                                                     | [dividend-sustainability-scoring.md](../../logic/dividend-sustainability-scoring.md) |
| ⑦   | 売上高の5年 CAGR    | 🟢 自動計算済                                                                                                     | [revenue-cagr-scoring.md](../../logic/revenue-cagr-scoring.md)                       |
| ⑧   | 営業利益率の5年平均 | 🟢 自動計算済（🟡 金融業の扱いは保留。[operating-margin-scoring.md](../../logic/operating-margin-scoring.md) §7） | [operating-margin-scoring.md](../../logic/operating-margin-scoring.md)               |
| ⑨   | MIX係数             | 🟢 自動計算済                                                                                                     | [mix-coefficient-scoring.md](../../logic/mix-coefficient-scoring.md)                 |
| ⑩   | **配当利回り**      | 🟢 自動計算済                                                                                                     | [dividend-yield-scoring.md](../../logic/dividend-yield-scoring.md)                   |

> ⚠️ 「実装（エンジン）」列は `src/domain/scoring/` の計算ロジックの状態。
> **この評価基準タブ自体（バッジ描画・カードUI）はまだ実装されていない。**
> エンジンが実装済みでも画面が無ければユーザーには見えない。

**⑩ のカードに固有の表示要件:**

- 採用した配当が**予想か実績か**を必ず併記する。どちらか分からない表示にしない
  （[dividend-yield-scoring.md](../../logic/dividend-yield-scoring.md) §2.1）
- 判定不能（`null`）は `0.00%` / `0点` ではなく `—` と理由メッセージを出す。
  理由コードごとにメッセージを出し分ける（同 §4 の表）
- 無配（0円）と判定不能を同じ見た目にしない

## 3. 実装時の注意（2026-07-28 更新: 軽量DDD移行後のパス）

- **スコア表をこの画面にハードコードしない。** 表は
  [scoring-requirements.md](../../../01_requirements/scoring-requirements.md) が正であり、
  スコアリングエンジンと同一の定義（`src/domain/scoring/bands.ts` の10表。
  ~~旧: `src/lib/` の定数~~）から描画すること。
  画面とエンジンで表が二重管理になると、片方だけ直して不整合が起きる
- バッジの「自動計算済／未実装」も手書きせず、`src/domain/shared/metric-key.ts` の
  `METRIC_KEYS` を基準に、エンジンが返す `MetricScore` の有無から描画する形にする
  （2026-07-28 時点では10指標全て実装済みなので、バッジは全部「自動計算済」になる）
- 境界値の解釈（下限以上・上限未満）を画面上にも明記する。
  ユーザーが「20% ちょうどは何点か」を判断できないと表の意味がない

## 4. 関連ドキュメント

- [scoring-requirements.md](../../../01_requirements/scoring-requirements.md) — 10指標の定義（正）
- [dividend-yield-scoring.md](../../logic/dividend-yield-scoring.md) — 指標⑩の詳細
- [screen-list.md](../screen-list.md) — 画面一覧
