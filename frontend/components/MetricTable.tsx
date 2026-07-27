import type { ScoringResponse } from '../api';
import { NO_DATA, formatMetricValue, reasonText } from '../format';

/**
 * 指標ごとのスコア一覧。
 *
 * **データ取得も計算もしない。props を描画するだけ**（`.claude/rules/frontend.md`）。
 * 表形式データなので `<table>` を使う。`<div>` のグリッドで代替しない。
 */
export function MetricTable({ metrics }: { readonly metrics: ScoringResponse['metrics'] }) {
  return (
    <table className="metric-table">
      <caption>指標別スコア</caption>
      <thead>
        <tr>
          <th scope="col">#</th>
          <th scope="col">指標</th>
          <th scope="col">算出値</th>
          <th scope="col">スコア</th>
          <th scope="col">備考</th>
        </tr>
      </thead>
      <tbody>
        {metrics.map((metric) => {
          const unavailable = metric.score === null;
          return (
            <tr key={metric.key} className={unavailable ? 'is-unavailable' : undefined}>
              <td>{metric.number}</td>
              <th scope="row">{metric.label}</th>
              <td className="numeric">
                {formatMetricValue(metric.value, metric.unit, metric.key === 'dividendYield')}
              </td>
              {/* 判定不能に 0 を出さない。0点と「計算できなかった」は別物（§0.5） */}
              <td className="numeric">{unavailable ? NO_DATA : `${metric.score} 点`}</td>
              <td>{reasonText(metric.unavailableReason)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
