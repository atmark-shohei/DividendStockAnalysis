import { describe, expect, it } from 'vitest';

import { chartAmountLabel, fiscalYearTickLabel } from '../../frontend/components/DividendLineChart';
import { formatSen } from '../../frontend/format';

/**
 * ①増配率（5年CAGR）の指標詳細（線グラフ）。`docs/02_design/ui/pages/analysis-dialog.md` §5.1。
 *
 * `@testing-library/react` 未導入のため、Recharts の実SVG描画（`<LineChart>` 自体）は
 * テストしない。コンポーネントから切り出した副作用の無い純粋関数だけを検証する
 * （`tests/frontend/list-page-active-metric.test.tsx` と同じ方針。fe-plan.md §4-1）。
 */
describe('fiscalYearTickLabel', () => {
  const cases: readonly (readonly [
    name: string,
    fiscalYear: number,
    isForecast: boolean,
    expected: string,
  ])[] = [
    ['通常年度は年度のみ', 2025, false, '2025'],
    ['予想年度は「（予想）」を付ける', 2026, true, '2026（予想）'],
  ];

  it.each(cases)('%s', (_name, fiscalYear, isForecast, expected) => {
    expect(fiscalYearTickLabel(fiscalYear, isForecast)).toBe(expected);
  });
});

describe('chartAmountLabel', () => {
  it('通常額は formatSen と同じ文字列を返す', () => {
    expect(chartAmountLabel(500_000)).toBe(formatSen(500_000));
    expect(chartAmountLabel(500_000)).toBe('5,000.00 円');
  });

  it('無配（0）は「0.00 円」。null と混同しない（境界値テスト必須）', () => {
    expect(chartAmountLabel(0)).toBe('0.00 円');
    expect(chartAmountLabel(0)).not.toBe('');
  });

  it('null（データ欠損）は空文字。点にラベルを出さない', () => {
    expect(chartAmountLabel(null)).toBe('');
  });
});
