import { useEffect, useState } from 'react';

import type { CompanySummary } from '@/domain/company/company-repository';

import { AnalysisDialogBody } from '../components/AnalysisDialogBody';
import {
  DIALOG_TITLE_ID,
  resolveActiveMetric,
  type DialogHandlers,
  type DividendHistoryState,
  type PayoutRatioSourceControl,
  type Selection,
} from '../components/analysis-dialog-logic';
import { Dialog } from '../components/Dialog';
import { EmptyState } from '../components/EmptyState';
import { computePageCount, Pagination } from '../components/Pagination';
import { ScoreBar } from '../components/ScoreBar';
import { Skeleton } from '../components/Skeleton';
import { formatMetricValue, formatSen } from '../format';
import type { CompanySortKey } from '../routes';

/**
 * 検索（銘柄一覧・検索・ソート・ページング）と、選択中の銘柄の解析結果（`/` と `/?code=...`）。
 *
 * 選択状態・検索条件は URL が持つ。この画面はデータ取得をせず、props で受け取る
 * （データ取得は `App` と `api.ts` だけ — ルート `CLAUDE.md`）。
 *
 * **行クリックのモーダル化（T-096）実装済み。** 選択中の銘柄（`selected.code !== null`）は
 * `<Dialog>`（`frontend/components/Dialog.tsx`）でモーダル表示する。開閉・`?metric=` の
 * 切り替えは URL が正（`docs/adr/0014-analysis-dialog-url-state.md`）。フォーカストラップ・
 * Escape・`aria-modal`・背景クリックは `<Dialog>` 側の内部実装。
 *
 * ダイアログの中身（`AnalysisDialogBody`）は `frontend/pages/PortfolioPage.tsx`（T-103）と
 * 共有する（ADR-0014「ダイアログは `/` と `/portfolio` で共通」）。`DialogHandlers` 等の型・
 * `resolveActiveMetric`/`DIALOG_TITLE_ID` は `frontend/components/analysis-dialog-logic.ts`
 * に切り出してある（T-103 で移設。動作は変えず抽出のみ）。
 *
 * 指標詳細モード（`?metric=<キー>`）は**枠組みのみ**（「← 指標一覧へ戻る」ヘッダー＋
 * 現在値・スコア＋プレースホルダー）。中身（線グラフ・連続年数リスト・汎用の条件表）は
 * T-097/T-098（`docs/02_design/ui/pages/analysis-dialog.md` §5。fe-plan.md §0 確認事項A、
 * Manager確認済み: (b) を採用）。
 */

// `list-page-active-metric.test.tsx` が `frontend/pages/ListPage` から直接 import しているため
// re-export する（本体は `analysis-dialog-logic.ts` に移設済み。T-103・動作は変えず抽出のみ）
export { resolveActiveMetric };
export type { DialogHandlers, DividendHistoryState, PayoutRatioSourceControl };

/**
 * 検索・ソート・ページングの状態とハンドラ。同じ理由で1オブジェクトにまとめる。
 * `q`/`sort`/`page` は URL が正（`App.tsx` が `route` から取り出して渡す）。
 */
export interface SearchControl {
  readonly q: string;
  readonly sort: CompanySortKey;
  readonly page: number;
  readonly perPage: number;
  readonly total: number;
  readonly loading: boolean;
  /** デバウンス確定後に呼ばれる想定（`search-page.md` §2） */
  readonly onSearchChange: (q: string) => void;
  readonly onSortChange: (sort: CompanySortKey) => void;
  readonly onPageChange: (page: number) => void;
  /**
   * 空状態（`q` が空で0件）に「銘柄登録」への誘導を出すか。admin にのみ true
   * （Manager決定。guest/user には出さない。銘柄登録は admin 限定タブのため
   * ミスリードになる）。
   */
  readonly showRegisterCta: boolean;
  readonly onNavigateToInput: () => void;
}

export interface RowActions {
  readonly onSelect: (code: string) => void;
  readonly onDelete: (code: string) => void;
}

/**
 * 一覧のソート選択肢。**表示ラベルは設計書に文言指定が無いため推測で決めた
 * （TODO: Manager確認推奨。`docs/02_design/ui/pages/search-page.md` §3 は
 * `[ソート ▾]` のプレースホルダのみで具体的な選択肢文言までは規定していない）。**
 */
const SORT_OPTIONS: ReadonlyArray<{ readonly value: CompanySortKey; readonly label: string }> = [
  { value: 'created_desc', label: '登録が新しい順' },
  { value: 'score_desc', label: '総合点が高い順' },
  { value: 'score_asc', label: '総合点が低い順' },
  { value: 'code_asc', label: 'コード順' },
];

export interface EmptyStateContent {
  readonly heading: string;
  readonly description: string | null;
}

/** 検索ボックスの入力確定までの待ち時間（`search-page.md` §2）。値の根拠: UI 標準的な
 * デバウンス幅として採用（設計書に具体的な ms 指定は無い） */
const SEARCH_DEBOUNCE_MS = 300;

/**
 * 空状態の見出し・補助文（`search-page.md` §5）。
 * `q` が空文字（前後の空白を trim して判定）なら「銘柄が1件も無い」、
 * それ以外は「検索条件に一致しない」の文言にする。
 */
export function emptyStateContent(q: string): EmptyStateContent {
  const trimmed = q.trim();
  if (trimmed === '') {
    return { heading: '保存された銘柄がありません', description: null };
  }
  return {
    heading: `「${trimmed}」に一致する銘柄はありません`,
    description: '検索語を変えるか、コードで検索してください',
  };
}

export function ListPage({
  companies,
  selected,
  payoutRatioSourceControl,
  searchControl,
  rowActions,
  activeMetricParam,
  dialogHandlers,
  dividendHistory,
}: {
  readonly companies: readonly CompanySummary[];
  readonly selected: Selection;
  /** ③ 予想配当性向の採点に実績を使うか（`docs/02_design/logic/payout-ratio-scoring.md` §7） */
  readonly payoutRatioSourceControl: PayoutRatioSourceControl;
  readonly searchControl: SearchControl;
  readonly rowActions: RowActions;
  /** `route.metric` の生値（形式チェック済み・実在未検証）。`resolveActiveMetric` に通す */
  readonly activeMetricParam: string | null;
  readonly dialogHandlers: DialogHandlers;
  /** ①増配率（5年CAGR。T-097）・②連続非減配年数（T-098）の指標詳細用 */
  readonly dividendHistory: DividendHistoryState;
}) {
  const selectedName =
    companies.find((company) => company.code === selected.code)?.name ?? selected.code;
  const activeMetric = resolveActiveMetric(activeMetricParam, selected.scoring?.metrics);

  // 検索ボックスの入力中の値。確定（デバウンス後）まで URL を書き換えない
  const [searchText, setSearchText] = useState(searchControl.q);

  // 戻る/進む・別経路（ソート変更等）で q が変わったら入力欄も追従させる
  useEffect(() => {
    setSearchText(searchControl.q);
  }, [searchControl.q]);

  // デバウンス確定。`search-page.md` §2「検索語の途中経過で履歴を汚さない」
  useEffect(() => {
    if (searchText === searchControl.q) return;
    const timer = setTimeout(() => {
      searchControl.onSearchChange(searchText);
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [searchText, searchControl.q, searchControl.onSearchChange]);

  const pageCount = computePageCount(searchControl.total, searchControl.perPage);
  const { heading, description } = emptyStateContent(searchControl.q);
  // 「登録が1件も無い」ケース（q空）のときだけ admin へ誘導を出す。検索の絞り込みで
  // 0件になったケースでは誘導を出さない（登録済みでも見つからないだけの可能性があるため）
  const showEmptyStateCta = searchControl.q.trim() === '' && searchControl.showRegisterCta;

  return (
    <>
      <section>
        <h2>検索</h2>
        <div className="search-bar">
          <label className="sr-only" htmlFor="company-search-input">
            銘柄コード・銘柄名で検索
          </label>
          <input
            id="company-search-input"
            type="search"
            placeholder="銘柄コード・銘柄名で検索"
            value={searchText}
            onChange={(event) => {
              setSearchText(event.target.value);
            }}
          />
          <span className="search-count numeric">該当 {searchControl.total} 件</span>
          <label className="search-sort inline">
            ソート
            <select
              value={searchControl.sort}
              onChange={(event) => {
                searchControl.onSortChange(event.target.value as CompanySortKey);
              }}
            >
              {SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        {searchControl.loading ? (
          <Skeleton rows={searchControl.perPage} />
        ) : companies.length === 0 ? (
          <EmptyState
            heading={heading}
            description={description}
            cta={
              showEmptyStateCta
                ? { label: '銘柄登録へ', onClick: searchControl.onNavigateToInput }
                : undefined
            }
          />
        ) : (
          <>
            <table className="metric-table">
              <caption>保存済み銘柄の一覧</caption>
              <thead>
                <tr>
                  <th scope="col">銘柄</th>
                  <th scope="col">総合点</th>
                  <th scope="col">配当利回り</th>
                  <th scope="col">配当性向</th>
                  <th scope="col">株価</th>
                  <th scope="col">操作</th>
                </tr>
              </thead>
              <tbody>
                {companies.map((company) => {
                  const isSelected = company.code === selected.code;
                  return (
                    // 選択行は色だけで示さない（色覚多様性）。操作列にも文言を出す
                    <tr key={company.code} className={isSelected ? 'is-selected' : undefined}>
                      <th scope="row" className="company-cell">
                        <span className="company-name" title={company.name}>
                          {company.name}
                        </span>
                        <span className="mono company-code">{company.code}</span>
                      </th>
                      <td className="score-cell">
                        <ScoreBar value={company.totalScore} max={company.maxTotalScore} />
                        <span className="numeric score-value">
                          {company.totalScore} / {company.maxTotalScore}
                          <span className="score-unit"> 点</span>
                        </span>
                        {/* 有効指標数の併記は必須（scoring-requirements.md §0.5） */}
                        <span className="score-effective">
                          有効{' '}
                          <span className="numeric">
                            {company.effectiveMetricCount}/{company.totalMetricCount}
                          </span>
                        </span>
                      </td>
                      <td className="numeric">
                        {formatMetricValue(company.dividendYieldValue, '%', true)}
                      </td>
                      <td className="numeric text-secondary">
                        {formatMetricValue(company.payoutRatioValue, '%', false)}
                      </td>
                      <td className="numeric text-secondary">{formatSen(company.priceSen)}</td>
                      <td>
                        <button
                          type="button"
                          onClick={() => {
                            rowActions.onSelect(company.code);
                          }}
                          aria-pressed={isSelected}
                        >
                          {isSelected ? '表示中' : '表示'}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            rowActions.onDelete(company.code);
                          }}
                        >
                          削除
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <Pagination
              page={searchControl.page}
              pageCount={pageCount}
              onChange={searchControl.onPageChange}
            />
          </>
        )}
      </section>

      <Dialog
        open={selected.code !== null}
        onClose={dialogHandlers.onClose}
        labelId={DIALOG_TITLE_ID}
      >
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
