import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * T-090: デザイントークン差し替え（`frontend/style.css`）の機械検証。
 *
 * `@testing-library/react` は導入されていない（`tests/frontend/company-form.test.tsx`）ため、
 * DOM描画結果は検証できない。代わりに CSS/コンポーネントのソースをテキストとして読み込み、
 * トークンの正（`docs/02_design/ui/design-tokens.md` §6 受入基準）を機械検証する。
 */

const styleCss = readFileSync(resolve(__dirname, '../../frontend/style.css'), 'utf-8');

describe('style.css のトークン網羅性（design-tokens.md §2〜§4）', () => {
  const expectedTokens: ReadonlyArray<readonly [string, string]> = [
    ['--color-bg', '#0e1014'],
    ['--color-surface', '#161a20'],
    ['--color-surface-dim', '#12151b'],
    ['--color-surface-inset', '#0e1014'],
    ['--color-line', '#262c37'],
    ['--color-line-row', '#1e242e'],
    ['--color-line-strong', '#333b48'],
    ['--color-text', '#e9ebef'],
    ['--color-text-secondary', '#98a1b0'],
    ['--color-text-tertiary', '#626c7a'],
    ['--color-brand', '#37b09a'],
    ['--color-action', '#4a80f0'],
    ['--color-on-action', '#0a1220'],
    ['--color-data', '#c4ccd6'],
    ['--color-caution', '#d6a13c'],
    ['--color-positive', '#52a06f'],
    ['--color-negative', '#cf6b5c'],
    ['--font-size-hero', '3.25rem'],
    ['--font-size-display', '2.375rem'],
    ['--font-size-score', '1.4375rem'],
    ['--font-size-xl', '1.1875rem'],
    ['--font-size-lg', '1.0625rem'],
    ['--font-size-md', '1rem'],
    ['--font-size-base', '0.875rem'],
    ['--font-size-sm', '0.8125rem'],
    ['--font-size-xs', '0.75rem'],
    ['--font-size-2xs', '0.6875rem'],
    ['--font-size-3xs', '0.625rem'],
    ['--space-1', '0.25rem'],
    ['--space-2', '0.5rem'],
    ['--space-3', '0.75rem'],
    ['--space-4', '1rem'],
    ['--space-5', '1.5rem'],
    ['--space-6', '2rem'],
    ['--radius-sm', '0.5rem'],
    ['--radius-md', '0.625rem'],
    ['--radius-lg', '0.75rem'],
    ['--radius-xl', '0.875rem'],
    ['--radius-2xl', '1rem'],
    ['--content-max', '72.5rem'],
  ];

  it.each(expectedTokens)('%s が %s で :root に定義されている', (name, value) => {
    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const escapedValue = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`${escapedName}:\\s*${escapedValue};`);
    expect(styleCss).toMatch(pattern);
  });

  it('--font-ui / --font-mono が定義されている（フォント族2つ）', () => {
    expect(styleCss).toMatch(
      /--font-ui:\s*system-ui,\s*-apple-system,\s*'Segoe UI',\s*'Hiragino Sans',\s*'Noto Sans JP',\s*sans-serif;/,
    );
    expect(styleCss).toMatch(
      /--font-mono:\s*ui-monospace,\s*'SFMono-Regular',\s*Consolas,\s*'Courier New',\s*monospace;/,
    );
  });

  it('--shadow-dialog が定義されている（Dialog用の唯一の影）', () => {
    expect(styleCss).toMatch(/--shadow-dialog:\s*0 24px 64px rgba\(0, 0, 0, 0\.6\);/);
  });

  it('トークンは43個（色17 + フォント族2 + フォントサイズ11 + 余白6 + 角丸5 + content-max1 + shadow-dialog1）', () => {
    // fe-plan.md は「42トークン」と記載していたが、内訳（17+2+11+6+5+1+1）を計算すると43。
    // design-tokens.md §2〜§4 のトークンは漏れなく:root に定義されているので、
    // ここでは実際の定義数（43）を正として検証する。
    const rootBlockMatch = styleCss.match(/:root\s*\{([\s\S]*?)\n\}/);
    expect(rootBlockMatch).not.toBeNull();
    const rootBlock = rootBlockMatch?.[1] ?? '';
    const declarationCount = (rootBlock.match(/--[a-z0-9-]+:\s*[^;]+;/g) ?? []).length;
    expect(declarationCount).toBe(43);
  });
});

describe('style.css の旧トークン・旧カラーコードの残存禁止', () => {
  it.each([
    ['--color-error', /--color-error\b/],
    ['--color-warning', /--color-warning\b/],
    ['--color-accent', /--color-accent\b/],
    ['--color-muted', /--color-muted\b/],
    ['--radius（無印。--radius-sm 等の派生は除く）', /--radius:/],
  ])('%s が残っていない', (_label, pattern) => {
    expect(styleCss).not.toMatch(pattern);
  });

  it.each([
    ['#0f172a（旧 --color-bg）'],
    ['#1e293b（旧 --color-surface）'],
    ['#e2e8f0（旧 --color-text）'],
    ['#94a3b8（旧 --color-muted）'],
    ['#38bdf8（旧 --color-accent）'],
    ['#f87171（旧 --color-error）'],
    ['#fbbf24（旧 --color-warning）'],
  ])('%s が残っていない', (label) => {
    const code = label.split('（')[0] ?? '';
    expect(styleCss).not.toContain(code);
  });
});

describe('style.css の rgba 直書き禁止（design-tokens.md §7 受入基準）', () => {
  it('rgba( の出現は --shadow-dialog の定義行1箇所のみ', () => {
    const matches = styleCss.match(/rgba\(/g) ?? [];
    expect(matches).toHaveLength(1);
  });

  it('.is-selected は color-mix() で --color-action を参照する（rgba直値を使わない）', () => {
    expect(styleCss).toMatch(
      /\.is-selected\s*\{\s*background:\s*color-mix\(in srgb, var\(--color-action\) 12%, transparent\);/,
    );
  });

  it('th/td の境界線は --color-line-row を参照する（rgba直値を使わない）', () => {
    expect(styleCss).toMatch(/border-bottom:\s*1px solid var\(--color-line-row\);/);
  });
});

describe('style.css の --font-mono 適用（数値・銘柄コード・日付表示）', () => {
  it('.numeric に var(--font-mono) が含まれる', () => {
    const numericBlockMatch = styleCss.match(/\.numeric\s*\{([\s\S]*?)\}/);
    expect(numericBlockMatch).not.toBeNull();
    expect(numericBlockMatch?.[1]).toContain('var(--font-mono)');
  });

  it('.total strong に var(--font-mono) が含まれる（総合点の数値部分）', () => {
    const totalStrongBlockMatch = styleCss.match(/\.total strong\s*\{([\s\S]*?)\}/);
    expect(totalStrongBlockMatch).not.toBeNull();
    expect(totalStrongBlockMatch?.[1]).toContain('var(--font-mono)');
  });

  it('.mono に var(--font-mono) が含まれる（右寄せ不要な銘柄コード・日付用。CR-1 是正）', () => {
    const monoBlockMatch = styleCss.match(/\n\.mono\s*\{([\s\S]*?)\}/);
    expect(monoBlockMatch).not.toBeNull();
    expect(monoBlockMatch?.[1]).toContain('var(--font-mono)');
  });
});

describe('style.css の font-weight 是正（design-tokens.md §3.2: 400/500/700のみ許可）', () => {
  it('font-weight: 600 が残っていない', () => {
    expect(styleCss).not.toMatch(/font-weight:\s*600;/);
  });

  it('button と .nav a は font-weight: 700 になっている', () => {
    const buttonBlockMatch = styleCss.match(/\nbutton\s*\{([\s\S]*?)\}/);
    expect(buttonBlockMatch).not.toBeNull();
    expect(buttonBlockMatch?.[1]).toMatch(/font-weight:\s*700;/);

    const navABlockMatch = styleCss.match(/\.nav a\s*\{([\s\S]*?)\}/);
    expect(navABlockMatch).not.toBeNull();
    expect(navABlockMatch?.[1]).toMatch(/font-weight:\s*700;/);
  });
});

describe('frontend/**/*.tsx に色・rgba直値が無い（design-tokens.md §6 受入基準・リグレッション防止）', () => {
  const tsxFiles = [
    '../../frontend/App.tsx',
    '../../frontend/pages/InputPage.tsx',
    '../../frontend/pages/ListPage.tsx',
    '../../frontend/components/NavBar.tsx',
    '../../frontend/components/MetricTable.tsx',
    '../../frontend/components/ScoreRadar.tsx',
    '../../frontend/components/BalanceSheetFields.tsx',
    '../../frontend/components/CompanyForm.tsx',
  ];

  it.each(tsxFiles)('%s に #RRGGBB / rgba( の直値が無い', (relativePath) => {
    const source = readFileSync(resolve(__dirname, relativePath), 'utf-8');
    // CSS変数の値（var(--color-data) 等）は許可。生の16進カラー・rgba()関数呼び出しを禁止する
    expect(source).not.toMatch(/#[0-9a-fA-F]{3,6}(?![0-9a-fA-F])/);
    expect(source).not.toMatch(/rgba\(/);
  });
});

describe('ListPage.tsx の --font-mono 適用（class 付与の検証。CR-1/CR-2 是正の再発防止）', () => {
  const listPageSource = readFileSync(
    resolve(__dirname, '../../frontend/pages/ListPage.tsx'),
    'utf-8',
  );

  it('一覧表の銘柄コード列（company.code）に mono class が付与されている', () => {
    expect(listPageSource).toMatch(/className="mono">\{company\.code\}/);
  });

  it('一覧表の入力日時列（formatFetchedAt(company.fetchedAt)）に mono class が付与されている', () => {
    expect(listPageSource).toMatch(/className="mono">\{formatFetchedAt\(company\.fetchedAt\)\}/);
  });

  it('総合点の分母（maxTotalScore）に numeric class が付与されている', () => {
    expect(listPageSource).toMatch(/className="numeric">\{selected\.scoring\.maxTotalScore\}/);
  });

  it('解析結果詳細の入力日時（formatFetchedAt(selected.scoring.fetchedAt)）に numeric class が付与されている', () => {
    expect(listPageSource).toMatch(
      /className="numeric">\{formatFetchedAt\(selected\.scoring\.fetchedAt\)\}/,
    );
  });
});

describe('MetricTable.tsx の --font-mono 適用（class 付与の検証。CR-7 是正の再発防止）', () => {
  const metricTableSource = readFileSync(
    resolve(__dirname, '../../frontend/components/MetricTable.tsx'),
    'utf-8',
  );

  it('指標番号列（metric.number）に mono class が付与されている', () => {
    expect(metricTableSource).toMatch(/className="mono">\{metric\.number\}/);
  });
});
