import type { HoldingView } from '../api';
import {
  formatMetricValue,
  formatSen,
  formatUnrealizedGainLossSen,
  unrealizedGainLossColorClass,
} from '../format';

/**
 * 保有銘柄テーブル（`docs/02_design/ui/pages/portfolio-page.md` §4.1）。
 *
 * **データ取得も計算もしない。props を描画するだけ**（`.claude/rules/frontend.md`）。
 * 評価額・評価損益・利回り・スコアはすべて BE（`GET /api/portfolios/:id`）が算出済みの値を
 * そのまま表示する（§8「集計値はクライアントで再計算しない」）。
 *
 * 行クリックは `search-page.md` §4.1 と同じ **stretched button パターン**で `?code=` を開く
 * （§4.1。fe-plan.md §1 確認事項A、Manager決定: (b) 新規実装採用）。既存CSS
 * （`frontend/style.css` の `.metric-row`/`.metric-row-button`/`.metric-row-button::after`/
 * `:focus-visible`。`frontend/components/MetricTable.tsx` で実装・テスト済み）をそのまま
 * 再利用し、新規CSSは増やさない。
 *
 * 保有銘柄1件の編集・削除操作用の「操作」列（CR-3・T-103 FEレビュー対応）。
 * `docs/02_design/ui/pages/portfolio-page.md` §9「追加・削除操作は `<button>`」・§5「銘柄の
 * 追加・編集」の記載に対応する（旧実装は §4.1 の列一覧に操作列の記載が無いことを理由に
 * 実装しないと判断していたが、§9/§5 の記載と整合していなかったため追加した）。
 *
 * **重要な技術的注意**: 行全体が `.metric-row-button::after`（`inset: 0`、`.metric-row` =
 * `<tr>` に対して絶対配置）で覆われる stretched button パターンのため、操作列のボタンは
 * 何もしないと当たり判定の下に埋もれてクリックできない。操作列の `<td>` に
 * `.holding-row-actions`（`position: relative; z-index: 1;`）を付与し、stretched button の
 * `::after` より前面に出す（`frontend/style.css` 参照）。
 */
export function HoldingsTable({
  holdings,
  onRowClick,
  onEditHolding,
  onRemoveHolding,
}: {
  readonly holdings: readonly HoldingView[];
  readonly onRowClick: (code: string) => void;
  readonly onEditHolding: (code: string) => void;
  readonly onRemoveHolding: (code: string) => void;
}) {
  return (
    <table className="metric-table">
      <caption>保有銘柄一覧</caption>
      <thead>
        <tr>
          <th scope="col">銘柄</th>
          <th scope="col">保有数量</th>
          <th scope="col">取得単価</th>
          <th scope="col">現在株価</th>
          <th scope="col">評価額</th>
          <th scope="col">評価損益</th>
          <th scope="col">利回り</th>
          <th scope="col">スコア</th>
          <th scope="col">操作</th>
        </tr>
      </thead>
      <tbody>
        {holdings.map((holding) => {
          const colorClass = unrealizedGainLossColorClass(holding.unrealizedGainLossSen);
          return (
            <tr key={holding.code} className="metric-row">
              <th scope="row">
                <button
                  type="button"
                  className="metric-row-button"
                  onClick={() => {
                    onRowClick(holding.code);
                  }}
                >
                  <span className="company-name" title={holding.name}>
                    {holding.name}
                  </span>{' '}
                  <span className="mono company-code">{holding.code}</span>
                </button>
              </th>
              <td className="numeric">{holding.quantity}</td>
              <td className="numeric">{formatSen(holding.acquisitionPriceSen)}</td>
              <td className="numeric">{formatSen(holding.currentPriceSen)}</td>
              <td className="numeric">{formatSen(holding.valueSen)}</td>
              {/* 評価損益は色だけで増減を表さない。▲/▼ の glyph と色クラスを必ずセットで出す
                  （design-tokens.md §2.2、portfolio-page.md §4.3） */}
              <td className={colorClass === undefined ? 'numeric' : `numeric ${colorClass}`}>
                {formatUnrealizedGainLossSen(holding.unrealizedGainLossSen)}
              </td>
              <td className="numeric">
                {formatMetricValue(holding.dividendYieldPercent, '%', false)}
              </td>
              <td className="numeric">
                {holding.totalScore} / {holding.maxTotalScore}
                {/* 有効指標数の併記は必須（scoring-requirements.md §0.5。省略しない） */}
                <span className="score-effective">
                  （有効 {holding.effectiveMetricCount}/{holding.totalMetricCount}）
                </span>
              </td>
              <td className="holding-row-actions">
                <button
                  type="button"
                  className="button-outline"
                  onClick={() => {
                    onEditHolding(holding.code);
                  }}
                >
                  編集
                </button>
                <button
                  type="button"
                  className="button-outline"
                  onClick={() => {
                    // 削除確認UIは既存パターンが無いため window.confirm を暫定採用
                    // （破壊的操作の確認なし即時削除にはしない。TODO・推測実装:
                    // より丁寧な確認モーダルの要否は完了報告でManagerへ申し送る）
                    if (window.confirm(`${holding.name}（${holding.code}）を削除しますか？`)) {
                      onRemoveHolding(holding.code);
                    }
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
  );
}
