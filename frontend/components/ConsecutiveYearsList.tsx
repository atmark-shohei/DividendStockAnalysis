import type { DividendHistoryResponse } from '../api';
import {
  consecutiveYearsSummaryText,
  dividendYoyDiffText,
  dividendYoyGlyph,
  dividendYoyStateLabel,
  formatSen,
  NO_DATA,
} from '../format';

/**
 * ②連続非減配年数の指標詳細（`docs/02_design/ui/pages/analysis-dialog.md` §5.2）。
 * 年次リスト（`<table>`。年度／状態（glyph+状態語）／1株配当／前年差）＋末尾の要約行。
 *
 * **データ取得しない。props で受け取るだけ**（`.claude/rules/frontend.md`）。
 * `rows` は `GET /api/companies/:code/dividends` の `consecutiveYearRows`
 * （BE `describeConsecutiveYearRows` が確定済み。年度昇順・最大19件・予想年度を含まない）。
 *
 * **増配／据置／減配の判定・前年差の算出はBE domain側で完了済み。**
 * FEは `state`/`diffSen` を glyph・文言へ変換するだけで、`current - previous` の
 * 再計算はしない（①の折れ線グラフ表と違い、判定ロジックの重複を避けるため）。
 *
 * 先頭行（`rows` 内で最も古い年度）は前年比較ができないため常に
 * `state: null` / `diffSen: null`（BE契約。`consecutive-years.ts` のコメント参照）。
 * この行も他の行と同じ形でそのまま描画する（`state`/`diffSen` が NO_DATA になるだけで、
 * 行自体を非表示にする窓処理はしない。BEが既にウィンドウ処理を終えているため）。
 */
export interface ConsecutiveYearsListProps {
  readonly rows: DividendHistoryResponse['consecutiveYearRows'];
  /** ②連続非減配年数のスコアリング結果値（`activeMetric.value`）。要約行に使う */
  readonly consecutiveYears: number | null;
}

export function ConsecutiveYearsList({ rows, consecutiveYears }: ConsecutiveYearsListProps) {
  return (
    <div>
      <table className="metric-table">
        <caption>連続非減配年数の年次リスト</caption>
        <thead>
          <tr>
            <th scope="col">年度</th>
            <th scope="col">状態</th>
            <th scope="col">1株配当</th>
            <th scope="col">前年差</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.fiscalYear}>
              <th scope="row" className="mono">
                {row.fiscalYear}
              </th>
              <td className="text-secondary">
                {row.state === null
                  ? NO_DATA
                  : `${dividendYoyGlyph(row.state)} ${dividendYoyStateLabel(row.state)}`}
              </td>
              <td className="numeric">{formatSen(row.amountSen)}</td>
              <td className="numeric text-secondary">{dividendYoyDiffText(row.diffSen)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="meta">{consecutiveYearsSummaryText(consecutiveYears)}</p>
    </div>
  );
}
