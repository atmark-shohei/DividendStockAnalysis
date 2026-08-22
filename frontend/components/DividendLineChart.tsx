import {
  CartesianGrid,
  Line,
  LabelList,
  LineChart,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from 'recharts';

import type { DividendHistoryResponse } from '../api';
import { dividendYoyChangeText, formatSen } from '../format';

/**
 * ①増配率（5年CAGR）の指標詳細（`docs/02_design/ui/pages/analysis-dialog.md` §5.1）。
 * 配当推移の折れ線グラフ＋年度別表（年度／1株配当／前年比）。
 *
 * **データ取得しない。props で受け取るだけ**（`.claude/rules/frontend.md`）。
 * `dividends` は年度昇順（BE契約。`toDividendHistoryResponse` の変換元 `DividendHistoryYear[]`）。
 */
export interface DividendLineChartProps {
  readonly dividends: DividendHistoryResponse['dividends'];
}

/**
 * X軸の年度ラベル。予想（`isForecast`）年度は「（予想）」を付ける
 * （§5.1「予想の年度は年ラベルに「（予想）」を付ける」）。
 */
export function fiscalYearTickLabel(fiscalYear: number, isForecast: boolean): string {
  return isForecast ? `${String(fiscalYear)}（予想）` : String(fiscalYear);
}

/**
 * 点の上の金額ラベル。`null`（データ欠損）は空文字にして点自体にラベルを出さない。
 * 丸めは `formatSen` に一元化する（グラフ専用の新規整形を増やさない）。
 * **`0`（無配・判定可）は `formatSen(0)` = `0.00 円` を出す。`null` と混同しない。**
 */
export function chartAmountLabel(amountSen: number | null): string {
  if (amountSen === null) return '';
  return formatSen(amountSen);
}

export function DividendLineChart({ dividends }: DividendLineChartProps) {
  const data = dividends.map((year) => ({
    tickLabel: fiscalYearTickLabel(year.fiscalYear, year.isForecast),
    amountSen: year.amountSen,
  }));

  return (
    <div className="radar">
      <div role="img" aria-label="配当推移を折れ線グラフで表示">
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={data}>
            {/* 縦軸グリッド線（Y軸の目盛りに対応する水平グリッド線。fe-plan.md §1 確認事項B） */}
            <CartesianGrid horizontal vertical={false} stroke="var(--color-line)" />
            <XAxis dataKey="tickLabel" stroke="var(--color-text-secondary)" />
            <YAxis stroke="var(--color-text-secondary)" />
            {/* `null`（データ欠損）は Recharts の既定動作で線を途切れさせる。`connectNulls` は
                明示指定しない（既定 false のまま。欠損を補間で埋めない） */}
            <Line dataKey="amountSen" stroke="var(--color-data)" dot connectNulls={false}>
              {/* Recharts の `LabelFormatter` は `RenderableText`（string|number|boolean|
                  null|undefined）を受け取る型のため、`chartAmountLabel`（`number | null` 専用）
                  に渡す前に型を絞り込む */}
              <LabelList
                dataKey="amountSen"
                position="top"
                formatter={(value) => chartAmountLabel(typeof value === 'number' ? value : null)}
              />
            </Line>
          </LineChart>
        </ResponsiveContainer>
      </div>
      <table className="metric-table">
        <caption>年度別の配当推移</caption>
        <thead>
          <tr>
            <th scope="col">年度</th>
            <th scope="col">1株配当</th>
            <th scope="col">前年比</th>
          </tr>
        </thead>
        <tbody>
          {dividends.map((year, index) => (
            <tr key={year.fiscalYear}>
              <th scope="row" className="mono">
                {fiscalYearTickLabel(year.fiscalYear, year.isForecast)}
              </th>
              <td className="numeric">{formatSen(year.amountSen)}</td>
              <td className="numeric text-secondary">
                {dividendYoyChangeText(year.amountSen, dividends[index - 1]?.amountSen)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
