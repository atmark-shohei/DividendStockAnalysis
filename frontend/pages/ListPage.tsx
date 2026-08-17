import type { CompanySummary } from '@/domain/company/company-repository';

import type { ScoringResponse } from '../api';
import { MetricTable } from '../components/MetricTable';
import { ScoreRadar } from '../components/ScoreRadar';
import { dividendSourceText, formatFetchedAt, multipleSourceText } from '../format';

/**
 * 保存済み銘柄の一覧と、選択中の銘柄の解析結果（`/` と `/?code=...`）。
 *
 * 選択状態は URL が持つ。この画面はデータ取得をせず、props で受け取る
 * （データ取得は `App` と `api.ts` だけ — ルート `CLAUDE.md`）。
 */

interface Selection {
  readonly code: string | null;
  readonly scoring: ScoringResponse | null;
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

export function ListPage({
  companies,
  selected,
  payoutRatioSourceControl,
  onSelect,
  onDelete,
}: {
  readonly companies: readonly CompanySummary[];
  readonly selected: Selection;
  /** ③ 予想配当性向の採点に実績を使うか（`docs/02_design/logic/payout-ratio-scoring.md` §7） */
  readonly payoutRatioSourceControl: PayoutRatioSourceControl;
  readonly onSelect: (code: string) => void;
  readonly onDelete: (code: string) => void;
}) {
  const selectedName =
    companies.find((company) => company.code === selected.code)?.name ?? selected.code;

  return (
    <>
      <section>
        <h2>保存済み銘柄</h2>
        {companies.length === 0 ? (
          <p>保存された銘柄はありません。「データ入力」から登録してください。</p>
        ) : (
          <table className="metric-table">
            <caption>保存済み銘柄の一覧</caption>
            <thead>
              <tr>
                <th scope="col">コード</th>
                <th scope="col">銘柄名</th>
                <th scope="col">総合点</th>
                <th scope="col">有効指標</th>
                <th scope="col">入力日時</th>
                <th scope="col">操作</th>
              </tr>
            </thead>
            <tbody>
              {companies.map((company) => {
                const isSelected = company.code === selected.code;
                return (
                  // 選択行は色だけで示さない（色覚多様性）。操作列にも文言を出す
                  <tr key={company.code} className={isSelected ? 'is-selected' : undefined}>
                    <td className="mono">{company.code}</td>
                    <th scope="row">{company.name}</th>
                    <td className="numeric">
                      {company.totalScore} / {company.maxTotalScore} 点
                    </td>
                    <td className="numeric">
                      {company.effectiveMetricCount} / {company.totalMetricCount}
                    </td>
                    <td className="mono">{formatFetchedAt(company.fetchedAt)}</td>
                    <td>
                      <button
                        type="button"
                        onClick={() => onSelect(company.code)}
                        aria-pressed={isSelected}
                      >
                        {isSelected ? '表示中' : '表示'}
                      </button>
                      <button type="button" onClick={() => onDelete(company.code)}>
                        削除
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      {selected.code !== null && (
        <section aria-live="polite">
          <h2>解析結果: {selectedName}</h2>
          <ScoringBody selected={selected} payoutRatioSourceControl={payoutRatioSourceControl} />
        </section>
      )}
    </>
  );
}

/**
 * 解析結果の中身。**「読み込み中」と「取得できなかった」を必ず区別する。**
 * 失敗をいつまでも「読み込み中…」と出すと、待てば表示されると誤解させる。
 *
 * ③ 予想配当性向のソース切替チェックボックスは、解析結果セクション（会社詳細）に
 * だけ置く。評価基準タブ（F-31）は未実装のため（`docs/02_design/ui/screen-list.md`。
 * Manager確認済み: 会社詳細のみで確定）、`CompanyForm.tsx`（データ入力画面）には置かない。
 */
function ScoringBody({
  selected,
  payoutRatioSourceControl,
}: {
  readonly selected: Selection;
  readonly payoutRatioSourceControl: PayoutRatioSourceControl;
}) {
  const sourceCheckbox = (
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
  );

  if (selected.loading) {
    return (
      <>
        {sourceCheckbox}
        <p className="meta">読み込み中…</p>
      </>
    );
  }

  if (selected.scoring === null) {
    // 何が起きたかは App のエラー表示（role="alert"）が出す。ここは次の行動だけ示す
    return (
      <>
        {sourceCheckbox}
        <p className="meta">解析結果を表示できませんでした。一覧から選び直してください。</p>
      </>
    );
  }

  return (
    <>
      {sourceCheckbox}
      <p className="total">
        総合点 <strong>{selected.scoring.totalScore}</strong> /{' '}
        <span className="numeric">{selected.scoring.maxTotalScore}</span> 点
        {/* 有効指標数の併記は §0.5 の必須要件。80/100 の誤読を防ぐ */}
        <span className="effective">
          （有効{' '}
          <span className="numeric">
            {selected.scoring.effectiveMetricCount}/{selected.scoring.totalMetricCount}
          </span>{' '}
          指標）
        </span>
      </p>
      <p className="meta">
        採用した配当: {dividendSourceText(selected.scoring.dividendSource)} ／ 入力日時:{' '}
        <span className="numeric">{formatFetchedAt(selected.scoring.fetchedAt)}</span>
      </p>
      {(selected.scoring.perSource !== null || selected.scoring.pbrSource !== null) && (
        <p className="meta">
          PER: {multipleSourceText(selected.scoring.perSource)} ／ PBR:{' '}
          {multipleSourceText(selected.scoring.pbrSource)}
        </p>
      )}
      <ScoreRadar metrics={selected.scoring.metrics} />
      <MetricTable
        metrics={selected.scoring.metrics}
        payoutRatioSource={selected.scoring.payoutRatioSource}
        payoutRatioForecast={selected.scoring.payoutRatioForecast}
        payoutRatioActual={selected.scoring.payoutRatioActual}
      />
    </>
  );
}
