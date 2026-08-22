import type { ScoringBandsResponse } from '../api';
import { formatBandRange } from '../format';
import { ImplementationBadge } from './ImplementationBadge';

/** ①〜⑩の丸数字見出し。`metric.number`（1〜10）をキーにする */
const METRIC_ORDINAL: Readonly<Record<number, string>> = {
  1: '①',
  2: '②',
  3: '③',
  4: '④',
  5: '⑤',
  6: '⑥',
  7: '⑦',
  8: '⑧',
  9: '⑨',
  10: '⑩',
};

type MetricBandsView = ScoringBandsResponse['metrics'][number];

export interface MetricCriteriaCardProps {
  readonly metric: MetricBandsView;
  /**
   * エンジンが計算済みか（`criteria-tab.md` §3）。BE DTO にこのフィールドは無い。
   * `GET /api/scoring/bands` が返す指標一覧＝`METRIC_KEYS` 10種＝エンジンが返す
   * 実装済み指標の一覧、という解釈のもと、呼び出し側（`CriteriaPage`）が常に `true` を渡す
   * （ユーザー決定。2026-08-22）。
   */
  readonly implemented: boolean;
  /** 1行の説明（`criteria-tab.md` §2.0）。FE側で持つ静的テキスト（§7確認事項C） */
  readonly description: string;
  /** 計算式（同上）。FE側で持つ静的テキスト */
  readonly formula: string;
}

/**
 * 評価基準タブ（`/criteria`）の1指標分のカード。
 *
 * **計算・判定をしない。** BE が返した区分表（`metric.bands`）をそのまま描画するだけ
 * （`.claude/rules/frontend.md`）。区分表のリテラル（`points: 数値` のハードコード配列）は
 * この画面のどこにも持たない。
 */
export function MetricCriteriaCard({
  metric,
  implemented,
  description,
  formula,
}: MetricCriteriaCardProps) {
  const isHundredthsPercent = metric.key === 'dividendYield';

  return (
    <article className="criteria-card">
      <header className="criteria-card-header">
        <h3>{`${METRIC_ORDINAL[metric.number] ?? ''} ${metric.label}`}</h3>
        <ImplementationBadge implemented={implemented} />
      </header>
      <p className="criteria-description text-secondary">{description}</p>
      <pre className="criteria-formula">{formula}</pre>
      <table className="metric-table">
        <caption>{`${metric.label} の区分表`}</caption>
        <thead>
          <tr>
            <th scope="col">条件</th>
            <th scope="col">点数</th>
          </tr>
        </thead>
        <tbody>
          {metric.bands.map((band, index) => (
            // `band` 自体に一意な id が無い（BE DTO に安定IDが無いため index を使う。
            // fe-plan.md §7確認事項E）
            <tr key={index}>
              <td>{formatBandRange(band, metric.unit, isHundredthsPercent)}</td>
              <td className="numeric">{`${String(band.points)} 点`}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="criteria-note">各区分は下限以上・上限未満（最上位のみ上が開く）</p>
    </article>
  );
}
