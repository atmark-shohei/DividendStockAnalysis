import type {
  AddHoldingRequest,
  HoldingView,
  PortfolioDetailResponse,
  PortfolioSummary,
  UpdateHoldingRequest,
} from '../api';
import { AnalysisDialogBody } from '../components/AnalysisDialogBody';
import {
  DIALOG_TITLE_ID,
  resolveActiveMetric,
  type DialogHandlers,
  type DividendHistoryState,
  type PayoutRatioSourceControl,
  type Selection,
} from '../components/analysis-dialog-logic';
import { CreatePortfolioForm } from '../components/CreatePortfolioForm';
import { Dialog } from '../components/Dialog';
import { EditHoldingForm } from '../components/EditHoldingForm';
import { EmptyState } from '../components/EmptyState';
import { HoldingForm } from '../components/HoldingForm';
import { HoldingsTable } from '../components/HoldingsTable';
import { PortfolioTabs } from '../components/PortfolioTabs';
import { Skeleton } from '../components/Skeleton';
import {
  formatMetricValue,
  formatScoreAverage,
  formatSen,
  formatUnrealizedGainLossSen,
  TOTAL_SCORE_COMPARISON_NOTE,
  unrealizedGainLossColorClass,
} from '../format';
import {
  canAddHolding,
  canAddPortfolio,
  holdingsEmptyStateContent,
  MAX_HOLDINGS_PER_PORTFOLIO,
  portfolioEmptyStateContent,
} from './portfolio-page-logic';

/**
 * ポートフォリオ画面（`/portfolio`、T-103・`docs/02_design/ui/pages/portfolio-page.md`）。
 *
 * **データ取得はしない。** `portfolios`/`detail` は `App.tsx` が取得した結果を props で渡す
 * （`.claude/rules/frontend.md`）。集計値（評価額・評価損益・利回り・スコア平均）は
 * すべて BE が算出済みの値をそのまま表示し、クライアントで再計算しない（§8）。
 *
 * 保有銘柄の行クリックで開く解析ダイアログは `/`（`ListPage.tsx`）と共通
 * （ADR-0014）。`AnalysisDialogBody`/`analysis-dialog-logic.ts` を共有する。
 */

export interface PortfolioListState {
  readonly items: readonly PortfolioSummary[];
  readonly maxPortfolios: number;
  readonly loading: boolean;
}

export interface PortfolioDetailState {
  readonly data: PortfolioDetailResponse | null;
  readonly loading: boolean;
}

export interface PortfolioActions {
  readonly onSelectPortfolio: (id: string) => void;
  readonly onCreatePortfolio: (name: string) => void;
  readonly onAddHolding: (payload: AddHoldingRequest) => void;
  readonly onOpenHolding: (code: string) => void;
  /** 保有銘柄の編集ボタン（CR-3）。編集ダイアログを開く（`editHoldingDialog.holding` の解決は呼び出し側） */
  readonly onEditHolding: (code: string) => void;
  /** 編集フォームの送信（CR-3） */
  readonly onUpdateHolding: (code: string, payload: UpdateHoldingRequest) => void;
  /** 保有銘柄の削除ボタン（CR-3。`window.confirm` 確認後に呼ばれる） */
  readonly onRemoveHolding: (code: string) => void;
  /** ポートフォリオの削除ボタン（CR-3。`window.confirm` 確認後に呼ばれる） */
  readonly onDeletePortfolio: (id: string) => void;
}

/** 「＋ 作成」「＋ 銘柄を追加」モーダルの開閉・送信状態（`fe-plan.md` §1 確認事項D） */
export interface AddDialogState {
  readonly open: boolean;
  readonly onOpen: () => void;
  readonly onClose: () => void;
  readonly submitting: boolean;
  readonly error: string | null;
}

/**
 * 「保有銘柄を編集」モーダルの開閉・送信状態（CR-3）。`AddDialogState` と同型に揃えるが、
 * `onOpen` は使わない（編集は「＋」ボタンではなく `HoldingsTable` の行内「編集」ボタンから
 * 開くため。呼び出し側 `App.tsx` は形の一貫性のためだけに no-op を渡す）。
 */
export interface EditHoldingDialogState extends AddDialogState {
  /** 編集対象の保有銘柄。`null` なら非表示（ダイアログを開いていない） */
  readonly holding: HoldingView | null;
}

export function PortfolioPage({
  portfolios,
  activePortfolioId,
  detail,
  actions,
  addPortfolioDialog,
  addHoldingDialog,
  editHoldingDialog,
  deletingPortfolio,
  selected,
  payoutRatioSourceControl,
  activeMetricParam,
  dialogHandlers,
  dividendHistory,
}: {
  readonly portfolios: PortfolioListState;
  readonly activePortfolioId: string | null;
  readonly detail: PortfolioDetailState;
  readonly actions: PortfolioActions;
  readonly addPortfolioDialog: AddDialogState;
  readonly addHoldingDialog: AddDialogState;
  readonly editHoldingDialog: EditHoldingDialogState;
  /** ポートフォリオ削除の送信中フラグ（CR-3）。削除ボタンの二重クリックを防ぐ */
  readonly deletingPortfolio: boolean;
  readonly selected: Selection;
  readonly payoutRatioSourceControl: PayoutRatioSourceControl;
  readonly activeMetricParam: string | null;
  readonly dialogHandlers: DialogHandlers;
  readonly dividendHistory: DividendHistoryState;
}) {
  const selectedName =
    detail.data?.holdings.find((holding) => holding.code === selected.code)?.name ??
    selected.code;
  const activeMetric = resolveActiveMetric(activeMetricParam, selected.scoring?.metrics);
  const canAddNewPortfolio = canAddPortfolio(portfolios.items.length, portfolios.maxPortfolios);
  const gainLossColorClass =
    detail.data === null
      ? undefined
      : unrealizedGainLossColorClass(detail.data.metrics.unrealizedGainLossSen);

  return (
    <>
      <section>
        <h2>ポートフォリオ</h2>

        {portfolios.loading ? (
          <Skeleton rows={3} />
        ) : portfolios.items.length === 0 ? (
          <EmptyState
            heading={portfolioEmptyStateContent().heading}
            description={portfolioEmptyStateContent().description}
            cta={{ label: '＋ 作成', onClick: addPortfolioDialog.onOpen }}
          />
        ) : (
          <>
            <PortfolioTabs
              portfolios={portfolios.items}
              activeId={activePortfolioId}
              maxPortfolios={portfolios.maxPortfolios}
              onSelect={actions.onSelectPortfolio}
              onAdd={addPortfolioDialog.onOpen}
              canAdd={canAddNewPortfolio}
            />

            {detail.loading ? (
              <Skeleton rows={4} />
            ) : detail.data === null ? (
              <p className="meta" role="alert">
                ポートフォリオを表示できませんでした。もう一度お試しください。
              </p>
            ) : (
              <>
                <div className="portfolio-footer">
                  <button
                    type="button"
                    className="button-outline"
                    disabled={deletingPortfolio}
                    onClick={() => {
                      if (activePortfolioId === null) return;
                      // 削除確認UIは既存パターンが無いため window.confirm を暫定採用
                      // （HoldingsTable の削除ボタンと同じ判断。CR-3・TODO・推測実装）
                      if (window.confirm('このポートフォリオを削除しますか？')) {
                        actions.onDeletePortfolio(activePortfolioId);
                      }
                    }}
                  >
                    ポートフォリオを削除
                  </button>
                </div>

                <dl className="portfolio-summary">
                  <div>
                    <dt>評価額合計</dt>
                    <dd className="portfolio-total-value numeric">
                      {formatSen(detail.data.metrics.totalValueSen)}{' '}
                      {/* 評価額の内訳件数の併記は必須（portfolio-metrics.md §3.1「必ず併記
                          する」。§0.5の有効指標数併記と同じ思想。一部銘柄の評価額が算出できない
                          ことを黙って隠さない。評価損益は同じ母数のためここにのみ出す） */}
                      <span className="meta">
                        （評価額算出済み {detail.data.metrics.evaluableValueCount}/
                        {detail.data.holdings.length}銘柄）
                      </span>
                    </dd>
                  </div>
                  <div>
                    <dt>評価損益</dt>
                    <dd
                      className={
                        gainLossColorClass === undefined
                          ? 'numeric'
                          : `numeric ${gainLossColorClass}`
                      }
                    >
                      {formatUnrealizedGainLossSen(detail.data.metrics.unrealizedGainLossSen)}
                    </dd>
                  </div>
                  <div>
                    <dt>平均利回り（評価額加重）</dt>
                    <dd className="numeric">
                      {formatMetricValue(detail.data.metrics.weightedYieldPercent, '%', false)}
                      （{detail.data.metrics.yieldEvaluableHoldingCount}銘柄）
                    </dd>
                  </div>
                  <div>
                    <dt>取得単価利回り</dt>
                    <dd className="numeric">
                      {formatMetricValue(detail.data.metrics.costBasisYieldPercent, '%', false)}
                      （{detail.data.metrics.yieldEvaluableHoldingCount}銘柄）
                    </dd>
                  </div>
                  <div>
                    <dt>スコア平均</dt>
                    <dd className="numeric">
                      {formatScoreAverage(detail.data.metrics.scoreAverage)}
                    </dd>
                  </div>
                </dl>
                {/* ADR-0012 §決定D-3。スコア平均も指標カスタマイズ次第で比較不能になりうるため
                    常時表示する（fe-plan.md §1 確認事項C、Manager確認済み。設計書に直接の
                    記載は無い推測実装。TODO: portfolio-page.md への反映は完了報告で申し送る） */}
                <p className="meta">{TOTAL_SCORE_COMPARISON_NOTE}</p>

                {detail.data.holdings.length === 0 ? (
                  <EmptyState
                    heading={holdingsEmptyStateContent().heading}
                    description={holdingsEmptyStateContent().description}
                  />
                ) : (
                  <HoldingsTable
                    holdings={detail.data.holdings}
                    onRowClick={actions.onOpenHolding}
                    onEditHolding={actions.onEditHolding}
                    onRemoveHolding={actions.onRemoveHolding}
                  />
                )}

                <div className="portfolio-footer">
                  <button
                    type="button"
                    onClick={addHoldingDialog.onOpen}
                    disabled={
                      !canAddHolding(detail.data.holdings.length, MAX_HOLDINGS_PER_PORTFOLIO)
                    }
                  >
                    ＋ 銘柄を追加
                  </button>
                  <span className="meta numeric">
                    {detail.data.holdings.length} / {MAX_HOLDINGS_PER_PORTFOLIO} 銘柄
                  </span>
                </div>

                {/* §4.2 透明性の注記。集計方法を隠さない（`.claude/CLAUDE.md`
                    「投資判断そのものを自動化・推奨する機能は作らない」の裏返し） */}
                <p className="meta">
                  評価額は保有数量×現在株価、評価損益は評価額-取得総額（保有数量×取得単価）で
                  算出しています。平均利回りは評価額または取得単価に対する加重平均で、
                  算出できない銘柄は母数から除外しています。
                </p>
              </>
            )}
          </>
        )}
      </section>

      <Dialog
        open={addPortfolioDialog.open}
        onClose={addPortfolioDialog.onClose}
        labelId="create-portfolio-title"
      >
        <CreatePortfolioForm
          onSubmit={actions.onCreatePortfolio}
          onCancel={addPortfolioDialog.onClose}
          submitting={addPortfolioDialog.submitting}
          submitError={addPortfolioDialog.error}
        />
      </Dialog>

      <Dialog
        open={addHoldingDialog.open}
        onClose={addHoldingDialog.onClose}
        labelId="add-holding-title"
      >
        <HoldingForm
          onSubmit={actions.onAddHolding}
          onCancel={addHoldingDialog.onClose}
          submitting={addHoldingDialog.submitting}
          submitError={addHoldingDialog.error}
        />
      </Dialog>

      <Dialog
        open={editHoldingDialog.open}
        onClose={editHoldingDialog.onClose}
        labelId="edit-holding-title"
      >
        {editHoldingDialog.holding !== null && (
          <EditHoldingForm
            // 編集対象が切り替わるたびに再マウントし、フォームの編集中値を初期化し直す
            // （`EditHoldingForm.tsx` の呼び出し側規約）
            key={editHoldingDialog.holding.code}
            holding={editHoldingDialog.holding}
            onSubmit={(payload) => {
              if (editHoldingDialog.holding === null) return;
              actions.onUpdateHolding(editHoldingDialog.holding.code, payload);
            }}
            onCancel={editHoldingDialog.onClose}
            submitting={editHoldingDialog.submitting}
            submitError={editHoldingDialog.error}
          />
        )}
      </Dialog>

      <Dialog open={selected.code !== null} onClose={dialogHandlers.onClose} labelId={DIALOG_TITLE_ID}>
        <AnalysisDialogBody
          selected={selected}
          selectedName={selectedName}
          payoutRatioSourceControl={payoutRatioSourceControl}
          activeMetric={activeMetric}
          dividendHistory={dividendHistory}
          onOpenMetric={dialogHandlers.onOpenMetric}
          onBackToOverview={dialogHandlers.onBackToOverview}
          onClose={dialogHandlers.onClose}
        />
      </Dialog>
    </>
  );
}
