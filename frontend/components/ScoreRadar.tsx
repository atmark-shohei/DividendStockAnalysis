import {
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
} from 'recharts';

import type { ScoringResponse } from '../api';

/**
 * 10指標のレーダーチャート。
 *
 * ⚠️ **判定不能の指標は 0 として描く。** レーダーチャートは欠測点を表現できないため、
 * 形の上では「最低評価」と区別が付かない。誤読を防ぐため、
 * チャート単体では出さず、必ず指標表（`MetricTable`）と有効指標数を併記すること。
 */
export function ScoreRadar({ metrics }: { readonly metrics: ScoringResponse['metrics'] }) {
  const data = metrics.map((metric) => ({
    label: `${metric.number}`,
    score: metric.score ?? 0,
    unavailable: metric.score === null,
  }));

  return (
    <div className="radar" role="img" aria-label="10指標のスコアをレーダーチャートで表示">
      <ResponsiveContainer width="100%" height={320}>
        <RadarChart data={data} outerRadius="75%">
          <PolarGrid />
          <PolarAngleAxis dataKey="label" />
          <PolarRadiusAxis domain={[0, 10]} tickCount={6} />
          <Radar dataKey="score" fillOpacity={0.4} />
        </RadarChart>
      </ResponsiveContainer>
      <p className="radar-note">
        判定できなかった指標は 0 として描いています。実際の値は下の表を参照してください。
      </p>
    </div>
  );
}
