import { useEffect, useRef } from 'react';

import type { ScoringResponse } from '../api';
import {
  dividendSourceText,
  formatFetchedAt,
  formatMetricValue,
  formatSen,
  multipleSourceText,
  NO_DATA,
  TOTAL_SCORE_COMPARISON_NOTE,
} from '../format';
import {
  DIALOG_TITLE_ID,
  type DividendHistoryState,
  type PayoutRatioSourceControl,
  type Selection,
} from './analysis-dialog-logic';
import { ConsecutiveYearsList } from './ConsecutiveYearsList';
import { DividendLineChart } from './DividendLineChart';
import { MetricTable } from './MetricTable';
import { ScoreBar } from './ScoreBar';
import { ScoreRadar } from './ScoreRadar';
import { Skeleton } from './Skeleton';

/**
 * 解析結果の中身（`<Dialog>` の children）。`frontend/pages/ListPage.tsx`（検索一覧）・
 * `frontend/pages/PortfolioPage.tsx`（T-103・保有銘柄一覧）の両方から使う共有コンポーネント
 * （`docs/02_design/ui/pages/portfolio-page.md` §1「解析ダイアログの中身はこの画面の責務外」、
 * `docs/adr/0014-analysis-dialog-url-state.md`「ダイアログは `/` と `/portfolio` で共通」）。
 *
 * 元は `ListPage.tsx` に private 実装されていた `ScoringBody` を T-103 で移設したもの
 * （**動作は変えず抽出のみ**。fe-plan.md §1 確認事項B、Manager確認済み）。
 *
 * **「読み込み中」と「取得できなかった」を必ず区別する。** 失敗をいつまでも「読み込み中…」と
 * 出すと、待てば表示されると誤解させる。
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
export function AnalysisDialogBody({
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
  // （概要→詳細のとき）。AnalysisDialogBody はモード切替時に再マウントされず、同一コンポーネント
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
          （fe-review.md CR-4）。`selected.code` は本コンポーネントが実際に描画される時点では
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
        {/* T-097: ①増配率（5年CAGR）の線グラフ＋表（`analysis-dialog.md` §5.1）。
            T-098: ②連続非減配年数の年次リスト（同 §5.2）。①②は同じ
            `GET /api/companies/:code/dividends` を共用する（`dividendHistory` state）。
            ③〜⑩汎用の条件／点数表（`bands.ts` 由来）は T-098 以降のスコープ（fe-plan.md §3-2） */}
        {activeMetric.key === 'dividendGrowthRate' ? (
          dividendHistory.loading ? (
            <Skeleton rows={4} />
          ) : dividendHistory.data === null ? (
            <p className="meta" role="alert">
              配当推移を表示できませんでした。もう一度お試しください。
            </p>
          ) : dividendHistory.data.dividends.length === 0 ? (
            // TODO(T-097): 配当データが0件の場合の挙動は company-api.md に明記が無い推測実装。
            // 銘柄は存在するが dividend_records が1件も無いケースへの防御(fe-plan.md §1
            // 確認事項C）。設計書に記載が無いため、Manager確認が必要な場合は本コメントを参照
            <p className="meta">配当データがありません。</p>
          ) : (
            <DividendLineChart dividends={dividendHistory.data.dividends} />
          )
        ) : activeMetric.key === 'consecutiveYears' ? (
          dividendHistory.loading ? (
            <Skeleton rows={4} />
          ) : dividendHistory.data === null ? (
            <p className="meta" role="alert">
              配当推移を表示できませんでした。もう一度お試しください。
            </p>
          ) : dividendHistory.data.consecutiveYearRows.length === 0 ? (
            // TODO(T-098): 連続非減配年数の年次リストが0件の場合の挙動は company-api.md に
            // 明記が無い推測実装。①と同じ理由（fe-plan.md §1 確認事項C）で、実績の
            // dividend_records が1件も無い銘柄への防御。文言も①に揃えた
            <p className="meta">配当データがありません。</p>
          ) : (
            <ConsecutiveYearsList
              rows={dividendHistory.data.consecutiveYearRows}
              consecutiveYears={activeMetric.value}
            />
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
          {/* ADR-0012 §決定D-3: 指標の選択・基準値が異なるユーザー間では総合点を
              単純比較できない旨を常時明記する（T-101）。非表示にする分岐を作らない */}
          <p className="meta">{TOTAL_SCORE_COMPARISON_NOTE}</p>
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
