import { useEffect, useRef, useState } from 'react';

import type { CompanySummary } from '@/domain/company/company-repository';

import type { DividendHistoryResponse, ScoringResponse } from '../api';
import { Dialog } from '../components/Dialog';
import { DividendLineChart } from '../components/DividendLineChart';
import { EmptyState } from '../components/EmptyState';
import { MetricTable } from '../components/MetricTable';
import { computePageCount, Pagination } from '../components/Pagination';
import { ScoreBar } from '../components/ScoreBar';
import { ScoreRadar } from '../components/ScoreRadar';
import { Skeleton } from '../components/Skeleton';
import {
  dividendSourceText,
  formatFetchedAt,
  formatMetricValue,
  formatSen,
  multipleSourceText,
  NO_DATA,
} from '../format';
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
 * 指標詳細モード（`?metric=<キー>`）は**枠組みのみ**（「← 指標一覧へ戻る」ヘッダー＋
 * 現在値・スコア＋プレースホルダー）。中身（線グラフ・連続年数リスト・汎用の条件表）は
 * T-097/T-098（`docs/02_design/ui/pages/analysis-dialog.md` §5。fe-plan.md §0 確認事項A、
 * Manager確認済み: (b) を採用）。
 */

/** ダイアログの開閉・指標詳細モードの遷移ハンドラ（`App.tsx` から URL 操作込みで渡される） */
export interface DialogHandlers {
  /** ✕ / 背景クリック / Escape 相当。`?code=` と `?metric=` の両方を外す */
  readonly onClose: () => void;
  /** 指標行クリック。`?metric=<key>` を付ける */
  readonly onOpenMetric: (key: string) => void;
  /** 「← 指標一覧へ戻る」。`?metric=` だけを外す */
  readonly onBackToOverview: () => void;
}

interface Selection {
  readonly code: string | null;
  readonly scoring: ScoringResponse | null;
  readonly loading: boolean;
}

/**
 * ①増配率（5年CAGR）の指標詳細（線グラフ）用データ（T-097）。`Selection` とは別オブジェクトに
 * する（`selected` の形を変えると既存の `resolveActiveMetric`/`ScoringBody` 呼び出し箇所を
 * 広く変更することになるため独立させる。fe-plan.md §3-1）。
 */
export interface DividendHistoryState {
  readonly data: DividendHistoryResponse | null;
  readonly loading: boolean;
}

/**
 * ③ 予想配当性向の採点に実績を使うかのチェックボックス状態と切替ハンドラ。
 * 1つのオブジェクトにまとめ、`ListPage` の props 数を増やさない
 * （`.claude/rules/frontend.md`「props は 5 個を超えたらオブジェクトにまとめる」）。
 */
export interface PayoutRatioSourceControl {
  readonly checked: boolean;
  readonly onToggle: (checked: boolean) => void;
}

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
 * ダイアログ見出し（銘柄名）の要素ID。`<Dialog labelId>` と `ScoringBody` 側の
 * `<h2 id>` の両方から参照する固定値。2箇所に同じ文字列リテラルを書いて食い違わせない
 * ためモジュール定数にする（`analysis-dialog.md` §8「aria-labelledby=<銘柄名の要素ID>」）。
 */
const DIALOG_TITLE_ID = 'analysis-dialog-title';

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
  /** ①増配率（5年CAGR）の指標詳細用（T-097） */
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
        <ScoringBody
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

/**
 * 解析結果の中身（ダイアログの children）。**「読み込み中」と「取得できなかった」を
 * 必ず区別する。** 失敗をいつまでも「読み込み中…」と出すと、待てば表示されると誤解させる。
 *
 * ヘッダー（銘柄名 ＋ ✕ ボタン）は読み込み中・失敗時も含め常に描画する
 * （`analysis-dialog.md` §6「タイトルは即座に出せる」。一覧データから銘柄名が
 * わかっているため、`ScoringResponse` の取得を待たない）。
 *
 * ③ 予想配当性向のソース切替チェックボックスは、概要モードのヒーローカードに置く
 * （`analysis-dialog.md` §4.1 の表「実績配当性向トグル…この位置に移設」）。
 *
 * `activeMetric !== null` のときは指標詳細モード。**中身は T-096 のスコープ外**
 * （プレースホルダーのみ。fe-plan.md §0 確認事項A、Manager確認済み: (b) 採用）。
 */
function ScoringBody({
  selected,
  selectedName,
  payoutRatioSourceControl,
  activeMetric,
  dividendHistory,
  onOpenMetric,
  onBackToOverview,
  onClose,
}: {
  readonly selected: Selection;
  readonly selectedName: string | null;
  readonly payoutRatioSourceControl: PayoutRatioSourceControl;
  readonly activeMetric: ScoringResponse['metrics'][number] | null;
  readonly dividendHistory: DividendHistoryState;
  readonly onOpenMetric: (key: string) => void;
  readonly onBackToOverview: () => void;
  readonly onClose: () => void;
}) {
  // モード切替時のフォーカス管理（analysis-dialog.md §8 の「閉じたら戻す」の対象外で、
  // 概要⇄詳細のモード内遷移。CR-8是正、選択肢(a): 見出しへ寄せる方式。
  // titleRef: 概要モードの見出し（詳細→概要のとき）。backButtonRef: 「← 指標一覧へ戻る」
  // （概要→詳細のとき）。ScoringBody はモード切替時に再マウントされず、同一コンポーネント
  // インスタンスとして再レンダーされ続けるため ref は保持される
  const titleRef = useRef<HTMLHeadingElement>(null);
  const backButtonRef = useRef<HTMLButtonElement>(null);
  const previousActiveMetricRef = useRef<typeof activeMetric>(null);

  useEffect(() => {
    const enteredDetail = previousActiveMetricRef.current === null && activeMetric !== null;
    const leftDetail = previousActiveMetricRef.current !== null && activeMetric === null;
    if (enteredDetail) backButtonRef.current?.focus();
    if (leftDetail) titleRef.current?.focus();
    previousActiveMetricRef.current = activeMetric;
    // `activeMetric` のみを依存にする（`backButtonRef`/`titleRef`/`previousActiveMetricRef` は
    // ref のため依存に含めない。`eslint-plugin-react-hooks` は未導入のため exhaustive-deps の
    // 自動検知は無い。手動で意図を明記する）
  }, [activeMetric]);

  const header = (
    <div className="dialog-header">
      {/* 市場区分はこのアプリのドメインに存在しないため省略する（analysis-dialog.md §3 は
          「銘柄名 + コード・市場区分」だが、市場区分データが無い以上コードのみ併記する）。
          一覧行と同じ `mono company-code` クラスを流用し新規CSSを増やさない
          （fe-review.md CR-4）。`selected.code` は `ScoringBody` が実際に描画される時点では
          常に非null（`open={selected.code !== null}` の `<Dialog>` が false のとき children を
          評価しないため）だが、型が `string | null` のままなので TS 上のガードを残す。
          `{selectedName}` と `<span>` は同一行に置く（JSX は式↔要素間の改行だけの空白を
          畳み込んで除去するため、別行に分けると銘柄名とコードの間の区切りが消える。
          fe-review-round2.md NEW-1 是正） */}
      <h2 id={DIALOG_TITLE_ID} ref={titleRef} tabIndex={-1}>
        {selectedName}{' '}
        {selected.code !== null && <span className="mono company-code">{selected.code}</span>}
      </h2>
      <button type="button" className="dialog-close" onClick={onClose} aria-label="閉じる">
        ✕
      </button>
    </div>
  );

  if (selected.loading) {
    return (
      <>
        {header}
        <Skeleton rows={4} />
      </>
    );
  }

  if (selected.scoring === null) {
    // analysis-dialog.md §6「取得に失敗した場合、ダイアログ内に role="alert" でエラーを
    // 表示し、次の行動を示す」。App 側の role="alert"（App.tsx の error 表示）はダイアログ外の
    // DOM 位置にあり、フォーカストラップ中の SR に読み上げられる保証が無いため、
    // ダイアログ内にも専用の role="alert" を持たせる（App 側の error state・表示は
    // ネットワーク障害以外の一般エラー経路として残す。重複読み上げより情報欠落のほうが
    // 実害が大きいという §6 の意図を優先する）
    return (
      <>
        {header}
        <p className="meta" role="alert">
          解析結果を表示できませんでした。一覧から選び直してください。
        </p>
      </>
    );
  }

  const scoring = selected.scoring;

  if (activeMetric !== null) {
    return (
      <>
        {header}
        <button type="button" ref={backButtonRef} onClick={onBackToOverview}>
          ← 指標一覧へ戻る
        </button>
        <p className="total">
          {activeMetric.label}
          <span className="effective">
            現在値{' '}
            {formatMetricValue(
              activeMetric.value,
              activeMetric.unit,
              activeMetric.key === 'dividendYield',
            )}
            ／ スコア {activeMetric.score === null ? NO_DATA : `${String(activeMetric.score)} 点`}
          </span>
        </p>
        {/* T-097: ①増配率（5年CAGR）だけ線グラフ＋表を実装した（`analysis-dialog.md` §5.1）。
            ②連続年数リスト・③〜⑩汎用の条件／点数表（`bands.ts` 由来）は T-098 以降のスコープ
            （fe-plan.md §3-2） */}
        {activeMetric.key === 'dividendGrowthRate' ? (
          dividendHistory.loading ? (
            <Skeleton rows={4} />
          ) : dividendHistory.data === null ? (
            <p className="meta" role="alert">
              配当推移を表示できませんでした。もう一度お試しください。
            </p>
          ) : dividendHistory.data.dividends.length === 0 ? (
            // TODO(T-097): 配当データが0件の場合の挙動は company-api.md に明記が無い推測実装。
            // 銘柄は存在するが dividend_records が1件も無いケースへの防御（fe-plan.md §1
            // 確認事項C）。設計書に記載が無いため、Manager確認が必要な場合は本コメントを参照
            <p className="meta">配当データがありません。</p>
          ) : (
            <DividendLineChart dividends={dividendHistory.data.dividends} />
          )
        ) : (
          <p className="meta">詳細表示は準備中です。</p>
        )}
      </>
    );
  }

  const dividendYieldMetric =
    scoring.metrics.find((metric) => metric.key === 'dividendYield') ?? null;

  return (
    <>
      {header}
      <p className="meta">
        採用した配当: {dividendSourceText(scoring.dividendSource)} ／ 入力日時:{' '}
        <span className="numeric">{formatFetchedAt(scoring.fetchedAt)}</span>
      </p>
      {/* ヒーロー行の2カラム化（analysis-dialog.md §3「ヒーロー行は2列グリッド
          （左270px固定・右は残り幅）」。fe-review.md CR-5 是正）。
          「採用した配当／入力日時」の meta 行はどちらのカラムにも属さない付帯情報のため、
          グリッドの外（上）に残す（§3 のASCII図に明示的な位置指定が無いための実装判断） */}
      <div className="dialog-summary">
        <div className="dialog-summary-score">
          <p className="total">
            総合点 <strong>{scoring.totalScore}</strong> /{' '}
            <span className="numeric">{scoring.maxTotalScore}</span> 点
            {/* 有効指標数の併記は §0.5 の必須要件。80/100 の誤読を防ぐ */}
            <span className="effective">
              （有効{' '}
              <span className="numeric">
                {scoring.effectiveMetricCount}/{scoring.totalMetricCount}
              </span>{' '}
              指標）
            </span>
          </p>
          <ScoreBar value={scoring.totalScore} max={scoring.maxTotalScore} />
          {/* ヒーロー行: 株価・配当利回り・PER・PBR（`analysis-dialog.md` §4.1）。
              PBR等が null のとき formatMetricValue/formatSen が NO_DATA（—）を返す */}
          <dl className="dialog-hero">
            <div className="dialog-hero-row">
              <dt>株価</dt>
              <dd className="numeric">{formatSen(scoring.priceSen)}</dd>
            </div>
            <div className="dialog-hero-row">
              <dt>配当利回り</dt>
              <dd className="numeric">
                {dividendYieldMetric === null
                  ? NO_DATA
                  : formatMetricValue(dividendYieldMetric.value, dividendYieldMetric.unit, true)}
              </dd>
            </div>
            <div className="dialog-hero-row">
              <dt>PER</dt>
              <dd className="numeric">
                {formatMetricValue(scoring.per, '倍', false)}
                {scoring.perSource !== null && `（${multipleSourceText(scoring.perSource)}）`}
              </dd>
            </div>
            <div className="dialog-hero-row">
              <dt>PBR</dt>
              <dd className="numeric">
                {formatMetricValue(scoring.pbr, '倍', false)}
                {scoring.pbrSource !== null && `（${multipleSourceText(scoring.pbrSource)}）`}
              </dd>
            </div>
          </dl>
          <p className="meta">
            <label className="inline">
              <input
                type="checkbox"
                checked={payoutRatioSourceControl.checked}
                onChange={(event) => payoutRatioSourceControl.onToggle(event.target.checked)}
              />
              実績配当性向を採点に使う
            </label>
          </p>
        </div>
        <div className="dialog-summary-chart">
          <ScoreRadar metrics={scoring.metrics} />
        </div>
      </div>
      <MetricTable
        metrics={scoring.metrics}
        payoutRatioSource={scoring.payoutRatioSource}
        payoutRatioForecast={scoring.payoutRatioForecast}
        payoutRatioActual={scoring.payoutRatioActual}
        onRowClick={onOpenMetric}
      />
    </>
  );
}
