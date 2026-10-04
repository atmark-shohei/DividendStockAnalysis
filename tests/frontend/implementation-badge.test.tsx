import { describe, expect, it } from 'vitest';

import { implementationBadgeLabel } from '../../frontend/components/ImplementationBadge';

/**
 * 評価基準タブ（T-099）の実装状態バッジ。`@testing-library/react` 未導入のため、
 * コンポーネントから切り出した純粋関数だけを検証する（`dividend-line-chart.test.tsx` と同じ方針）。
 * 「色だけで区別せず、必ず文言を出す」（`criteria-tab.md` §2.2）を機械検証する。
 */
describe('implementationBadgeLabel', () => {
  const cases: readonly (readonly [name: string, implemented: boolean, expected: string])[] = [
    ['実装済みは「自動計算済」', true, '自動計算済'],
    ['未実装は「未実装」', false, '未実装'],
  ];

  it.each(cases)('%s', (_name, implemented, expected) => {
    expect(implementationBadgeLabel(implemented)).toBe(expected);
  });
});
