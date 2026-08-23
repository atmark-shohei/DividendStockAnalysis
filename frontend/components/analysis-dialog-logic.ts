import type { DividendHistoryResponse, ScoringResponse } from '../api';

/**
 * 解析ダイアログ（`AnalysisDialogBody.tsx`）が使う型・純関数。**JSX を持たない。**
 *
 * `frontend/pages/ListPage.tsx`（検索一覧）・`frontend/pages/PortfolioPage.tsx`
 * （T-103・保有銘柄一覧）の両方が使う共有ロジック。解析ダイアログの中身は `/` と `/portfolio`
 * で共通という設計（`docs/02_design/ui/pages/portfolio-page.md` §1、
 * `docs/adr/0014-analysis-dialog-url-state.md`）に対応するため、`ListPage.tsx` に
 * private 実装されていた `ScoringBody`/`resolveActiveMetric`/`DIALOG_TITLE_ID` を
 * T-103 でここへ抽出した（**動作は変えず抽出のみ**。fe-plan.md §1 確認事項B、Manager確認済み）。
 */

/**
 * ダイアログ見出し（銘柄名）の要素ID。`<Dialog labelId>` と `AnalysisDialogBody` 側の
 * `<h2 id>` の両方から参照する固定値。2箇所に同じ文字列リテラルを書いて食い違わせない
 * ためモジュール定数にする（`analysis-dialog.md` §8「aria-labelledby=<銘柄名の要素ID>」）。
 */
export const DIALOG_TITLE_ID = 'analysis-dialog-title';

/** 選択中の銘柄と、その解析結果（`GET /api/companies/:code` の取得状態） */
export interface Selection {
  readonly code: string | null;
  readonly scoring: ScoringResponse | null;
  readonly loading: boolean;
}

/**
 * ①増配率（5年CAGR。T-097）の線グラフ・②連続非減配年数の年次リスト（T-098）が
 * 共用するデータ。`Selection` とは別オブジェクトにする（`selected` の形を変えると既存の
 * `resolveActiveMetric`/`AnalysisDialogBody` 呼び出し箇所を広く変更することになるため
 * 独立させる。fe-plan.md §3-1）。
 */
export interface DividendHistoryState {
  readonly data: DividendHistoryResponse | null;
  readonly loading: boolean;
}

/**
 * ③ 予想配当性向の採点に実績を使うかのチェックボックス状態と切替ハンドラ。
 * 1つのオブジェクトにまとめ、呼び出し側の props 数を増やさない
 * （`.claude/rules/frontend.md`「props は 5 個を超えたらオブジェクトにまとめる」）。
 */
export interface PayoutRatioSourceControl {
  readonly checked: boolean;
  readonly onToggle: (checked: boolean) => void;
}

/** ダイアログの開閉・指標詳細モードの遷移ハンドラ（`App.tsx` から URL 操作込みで渡される） */
export interface DialogHandlers {
  /** ✕ / 背景クリック / Escape 相当。`?code=` と `?metric=` の両方を外す */
  readonly onClose: () => void;
  /** 指標行クリック。`?metric=<key>` を付ける */
  readonly onOpenMetric: (key: string) => void;
  /** 「← 指標一覧へ戻る」。`?metric=` だけを外す */
  readonly onBackToOverview: () => void;
}

/**
 * `?metric=` の実在検証（`docs/adr/0014-analysis-dialog-url-state.md` §決定3）。
 *
 * `routes.ts` の `parseMetricParam` は形式チェックのみ（英字1〜32文字）で、実在する
 * 10指標のキーかどうかは見ていない。ここで `GET /api/companies/:code` の応答（`metrics`）
 * と突き合わせ、一致しなければ概要モードへフォールバックする（`null` を返す）。
 *
 * `metrics` が `undefined`（読み込み中・未取得）の間も `null`（概要）を返す。
 * 詳細モードの中身は `metrics` が揃ってから初めて描画できるため。
 */
export function resolveActiveMetric(
  metricParam: string | null,
  metrics: ScoringResponse['metrics'] | undefined,
): ScoringResponse['metrics'][number] | null {
  if (metricParam === null || metrics === undefined) return null;
  return metrics.find((metric) => metric.key === metricParam) ?? null;
}
