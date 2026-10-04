import {
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
} from 'recharts';

import type { ScoringResponse } from '../api';

/** 軸ラベルの丸数字（評価基準タブ・指標表の ①〜⑩ と同じ表記に揃える） */
const AXIS_ORDINAL: Readonly<Record<number, string>> = {
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

/**
 * 10指標のレーダーチャート。
 *
 * ⚠️ **判定不能の指標は 0 として描く。** レーダーチャートは欠測点を表現できないため、
 * 形の上では「最低評価」と区別が付かない。誤読を防ぐため、
 * チャート単体では出さず、必ず指標表（`MetricTable`）と有効指標数を併記すること。
 */
export function ScoreRadar({ metrics }: { readonly metrics: ScoringResponse['metrics'] }) {
  const data = metrics.map((metric) => ({
    label: AXIS_ORDINAL[metric.number] ?? `${metric.number}`,
    score: metric.score ?? 0,
    unavailable: metric.score === null,
  }));

  return (
    <div className="radar" role="img" aria-label="10指標のスコアをレーダーチャートで表示">
      <p className="radar-title">
        指標プロファイル<span className="radar-title-note">（各 0〜10）</span>
      </p>
      <ResponsiveContainer width="100%" height={320}>
        <RadarChart data={data} outerRadius="74%">
          <PolarGrid stroke="var(--color-line-strong)" />
          <PolarAngleAxis
            dataKey="label"
            tick={{ fill: 'var(--color-text-secondary)' }}
            tickLine={false}
          />
          <PolarRadiusAxis
            domain={[0, 10]}
            tickCount={6}
            axisLine={false}
            tick={{ fill: 'var(--color-text-tertiary)' }}
          />
          {/* 塗りは中立の --color-data のみ（緑・赤を使わない。design-tokens.md §2.2） */}
          <Radar
            dataKey="score"
            fill="var(--color-data)"
            stroke="var(--color-data)"
            strokeWidth={1.5}
            fillOpacity={0.18}
            dot={{ r: 2.5, fill: 'var(--color-data)', strokeWidth: 0 }}
            animationDuration={700}
          />
        </RadarChart>
      </ResponsiveContainer>
      <p className="radar-note">
        判定できなかった指標は 0 として描いています。実際の値は下の表を参照してください。
      </p>
    </div>
  );
}
