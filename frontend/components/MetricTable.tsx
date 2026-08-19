import type { ScoringResponse } from '../api';
import { NO_DATA, formatMetricValue, payoutRatioBreakdownText, reasonText } from '../format';

/**
 * 指標ごとのスコア一覧。
 *
 * **データ取得も計算もしない。props を描画するだけ**（`.claude/rules/frontend.md`）。
 * 表形式データなので `<table>` を使う。`<div>` のグリッドで代替しない。
 *
 * ③ 予想配当性向の内訳は `MetricView`（`metrics` の各行）ではなく `ScoringResponse`
 * トップレベルにある（`payoutRatioSource`/`payoutRatioForecast`/`payoutRatioActual`。
 * `dividendSource` と同じ置き方。`src/handler/dto/company-input.ts` 実装済みの形）。
 * ③ 行を描画するときだけこの3つを使い、既存の行構造・汎用ループは変えない
 * （備考列への追記。Manager決定、2026-08-06）。
 *
 * 各行は stretched button 化されている（`docs/02_design/ui/pages/search-page.md` §4.1 と
 * 同じパターン。`onRowClick(metric.key)` を呼び `?metric=` へ遷移する。T-096・確認事項D、
 * Manager確認済み）。`<tr onClick>` にせず、実体の `<button>` を指標名セルに置き、
 * CSS（`.metric-row-button::after`）で当たり判定を行全体に広げる
 * （`.claude/rules/frontend.md`「対話要素は button/a を使う」）。
 */
export function MetricTable({
  metrics,
  payoutRatioSource,
  payoutRatioForecast,
  payoutRatioActual,
  onRowClick,
}: {
  readonly metrics: ScoringResponse['metrics'];
  readonly payoutRatioSource: ScoringResponse['payoutRatioSource'];
  readonly payoutRatioForecast: ScoringResponse['payoutRatioForecast'];
  readonly payoutRatioActual: ScoringResponse['payoutRatioActual'];
  /** 指標行クリック（T-096追加）。`?metric=<key>` への遷移は呼び出し側の責務 */
  readonly onRowClick: (key: ScoringResponse['metrics'][number]['key']) => void;
}) {
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
            <tr
              key={metric.key}
              className={unavailable ? 'metric-row is-unavailable' : 'metric-row'}
            >
              <td className="mono">{metric.number}</td>
              <th scope="row">
                <button
                  type="button"
                  className="metric-row-button"
                  onClick={() => {
                    onRowClick(metric.key);
                  }}
                >
                  {metric.label}
                </button>
              </th>
              <td className="numeric">
                {formatMetricValue(metric.value, metric.unit, metric.key === 'dividendYield')}
              </td>
              {/* 判定不能に 0 を出さない。0点と「計算できなかった」は別物（§0.5） */}
              <td className="numeric">{unavailable ? NO_DATA : `${metric.score} 点`}</td>
              <td>
                {reasonText(metric.unavailableReason)}
                {/* ③ だけ予想・実績の内訳と採用元を併記する（既存の行構造は変えない） */}
                {metric.key === 'payoutRatio' && (
                  <div className="metric-detail">
                    {payoutRatioBreakdownText(
                      payoutRatioForecast,
                      payoutRatioActual,
                      payoutRatioSource,
                    )}
                  </div>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
