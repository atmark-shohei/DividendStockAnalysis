import { describe, expect, it } from 'vitest';

import type { ScoringResponse } from '../../frontend/api';
import { resolveActiveMetric } from '../../frontend/pages/ListPage';

/**
 * `?metric=` の実在検証（`docs/adr/0014-analysis-dialog-url-state.md` §決定3）。
 * `routes.ts` は形式チェックのみ行い、10指標との突き合わせは行わない設計のため、
 * ダイアログ側（`ListPage.tsx`）に切り出した `resolveActiveMetric` をここで検証する。
 * `@testing-library/react` 未導入のため、`ListPage.tsx` から切り出した純粋関数を直接テストする
 * （`tests/frontend/list-page-empty-state.test.tsx` と同じ方針）。
 */

const buildMetric = (
  overrides: Partial<ScoringResponse['metrics'][number]>,
): ScoringResponse['metrics'][number] => ({
  key: 'dividendYield',
  number: 10,
  label: '配当利回り',
  unit: '%',
  score: 7,
  value: 318,
  unavailableReason: null,
  ...overrides,
});

const metrics: ScoringResponse['metrics'] = [
  buildMetric({ key: 'dividendGrowthRate', number: 1, label: '増配率（5年CAGR）', unit: '%' }),
  buildMetric({ key: 'roeAverage', number: 5, label: 'ROEの5年平均', unit: '%' }),
  buildMetric({ key: 'dividendYield', number: 10, label: '配当利回り', unit: '%' }),
];

describe('resolveActiveMetric', () => {
  it('metricParam が metrics 内に実在すれば、その MetricView を返す', () => {
    expect(resolveActiveMetric('roeAverage', metrics)).toEqual(
      metrics.find((metric) => metric.key === 'roeAverage'),
    );
  });

  it('metricParam が metrics に無いキーなら概要モードへフォールバック（null）', () => {
    // routes.ts の形式チェック（英字1〜32文字）は通るが、実在しないキーのケース
    expect(resolveActiveMetric('notAMetricKey', metrics)).toBeNull();
  });

  it('metricParam が null（概要モード）なら null', () => {
    expect(resolveActiveMetric(null, metrics)).toBeNull();
  });

  it('metrics が undefined（読み込み中・未取得）なら null（詳細を描画できない）', () => {
    expect(resolveActiveMetric('roeAverage', undefined)).toBeNull();
  });

  it('metrics が空配列なら、どの metricParam でも null', () => {
    expect(resolveActiveMetric('roeAverage', [])).toBeNull();
  });
});
