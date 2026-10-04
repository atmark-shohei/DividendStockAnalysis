import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * 評価基準タブ（T-099、`docs/02_design/ui/pages/criteria-tab.md`）の構造・回帰防止テスト。
 *
 * `@testing-library/react` 未導入のため、DOM描画結果は検証できない。代わりにソースを
 * テキストとして読み込み正規表現で検証する既存パターン（`style-tokens.test.ts`）を踏襲する。
 */
const criteriaPageSource = readFileSync(
  resolve(__dirname, '../../frontend/pages/CriteriaPage.tsx'),
  'utf-8',
);
const metricCriteriaCardSource = readFileSync(
  resolve(__dirname, '../../frontend/components/MetricCriteriaCard.tsx'),
  'utf-8',
);
const navBarSource = readFileSync(resolve(__dirname, '../../frontend/components/NavBar.tsx'), 'utf-8');

describe('MetricCriteriaCard.tsx: 境界値の解釈の注記（criteria-tab.md §2.3・§4受入基準）', () => {
  it('「各区分は下限以上・上限未満」の注記がソースに存在する', () => {
    expect(metricCriteriaCardSource).toContain('各区分は下限以上・上限未満（最上位のみ上が開く）');
  });

  it('注記はカードごとに毎回描画される（1カード分のコンポーネント内に1回だけ書かれている）', () => {
    const matches = metricCriteriaCardSource.match(/各区分は下限以上・上限未満/g) ?? [];
    expect(matches).toHaveLength(1);
  });
});

describe('CriteriaPage.tsx: 区分表はBEレスポンスをそのまま描画する（criteria-tab.md §3・§4受入基準）', () => {
  it('bands.metrics.map でBEレスポンスをそのまま描画している', () => {
    expect(criteriaPageSource).toMatch(/bands\.metrics\.map/);
  });

  it('区分表のリテラル（points: 数値のハードコード配列）が存在しない', () => {
    expect(criteriaPageSource).not.toMatch(/points:\s*\d+/);
  });

  it('minInclusive/maxExclusive のハードコード値が存在しない（区分の二重管理防止）', () => {
    expect(criteriaPageSource).not.toMatch(/minInclusive:\s*\d+/);
    expect(criteriaPageSource).not.toMatch(/maxExclusive:\s*\d+/);
  });
});

describe('MetricCriteriaCard.tsx: 区分表はBEレスポンスをそのまま描画する（同上）', () => {
  it('metric.bands.map で描画し、区分表のリテラルを持たない', () => {
    expect(metricCriteriaCardSource).toMatch(/metric\.bands\.map/);
    expect(metricCriteriaCardSource).not.toMatch(/points:\s*\d+/);
  });
});

describe('NavBar.tsx: 評価基準タブへの導線（fe-index.md §4）', () => {
  it('評価基準への NavLink が guest含め常時表示される（条件分岐なし）', () => {
    expect(navBarSource).toMatch(
      /<NavLink to=\{\{ kind: 'criteria' \}\} active=\{current\.kind === 'criteria'\} onNavigate=\{onNavigate\}>\s*評価基準/,
    );
  });
});
