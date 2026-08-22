import type { ScoringBandsResponse } from '../api';
import { MetricCriteriaCard } from '../components/MetricCriteriaCard';
import { METRIC_DESCRIPTION, METRIC_FORMULA } from './criteria-content';

/**
 * 評価基準タブ（`/criteria`）。ログイン不要・全員閲覧可の公開画面
 * （`docs/02_design/ui/pages/criteria-tab.md` §1）。
 *
 * **データ取得はしない。** `bands` は `App.tsx` が `getScoringBands()` で取得した結果を props で渡す
 * （`.claude/rules/frontend.md`）。区分表のリテラルはこのファイルのどこにも持たない。
 */
export function CriteriaPage({
  bands,
  loading,
}: {
  readonly bands: ScoringBandsResponse | null;
  readonly loading: boolean;
}) {
  if (loading) return <p className="meta">読み込み中…</p>;
  if (bands === null) {
    return (
      <p className="meta" role="alert">
        評価基準を表示できませんでした。
      </p>
    );
  }

  return (
    <section>
      <h2>評価基準</h2>
      <div className="criteria-grid">
        {bands.metrics.map((metric) => (
          <MetricCriteriaCard
            key={metric.key}
            metric={metric}
            // エンジンが返す指標一覧（＝bands.tsに存在する10指標）＝実装済み、という解釈で
            // 常に true 固定にする（ユーザー決定。2026-08-22。§7確認事項B）
            implemented
            description={METRIC_DESCRIPTION[metric.key]}
            formula={METRIC_FORMULA[metric.key]}
          />
        ))}
      </div>
    </section>
  );
}
