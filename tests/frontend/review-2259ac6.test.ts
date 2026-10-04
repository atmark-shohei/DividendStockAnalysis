import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(__dirname, '../../frontend/style.css'), 'utf8');
const list = readFileSync(resolve(__dirname, '../../frontend/pages/ListPage.tsx'), 'utf8');

function block(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`${escaped}\\s*\\{([^}]+)\\}`).exec(css);
  expect(match, selector).not.toBeNull();
  return match?.[1] ?? '';
}

describe('2259ac6 regression contracts (browser layout verified separately)', () => {
  it('R-01/R-11: company rows define the containing block without :has or active transforms', () => {
    expect(list).toContain("'company-row is-selected' : 'company-row'");
    expect(block('.company-row')).toContain('position: relative;');
    expect(block('.row-actions button:first-child:active:not(:disabled)')).toContain(
      'transform: none;',
    );
  });

  it('R-02: both stretched buttons paint above positioned score bars', () => {
    expect(block('.row-actions button:first-child::after')).toContain('z-index: 1;');
    expect(block('.metric-row-button::after')).toContain('z-index: 1;');
    expect(block(".metric-row:hover > td:last-child[aria-hidden='true']")).not.toContain(
      'transform:',
    );
    expect(block('.holding-row-actions')).toContain('z-index: 2;');
    expect(block('.row-actions button + button')).toContain('z-index: 2;');
  });

  it('R-03: notes formatting is attached to the actual notes cell', () => {
    const source = readFileSync(
      resolve(__dirname, '../../frontend/components/MetricTable.tsx'),
      'utf8',
    );
    expect(source).toContain('<td className="metric-notes">');
    expect(css).not.toContain('.metric-row > td:nth-child(5)');
    expect(block('.metric-notes')).toContain('white-space: normal;');
  });

  it('R-04: tables contain horizontal overflow at every viewport width', () => {
    const table = block('.metric-table,\n.input-table');
    expect(table).toContain('display: block;');
    expect(table).toContain('overflow-x: auto;');
  });

  it('R-05/R-08: long tabs wrap and delete controls remain below the tabs', () => {
    const tabs = block('.portfolio-tabs button');
    expect(tabs).toContain('max-width: 100%;');
    expect(tabs).toContain('white-space: normal;');
    expect(tabs).toContain('overflow-wrap: anywhere;');
    const footer = block('.portfolio-tabs + .portfolio-footer');
    expect(footer).not.toContain('* -1');
    expect(footer).not.toContain('max-content');
  });

  it('R-06: the navigation exposes a scrollbar and does not permanently fade its last link', () => {
    expect(block('.nav')).toContain('scrollbar-width: thin;');
    expect(css).not.toMatch(/\.app-header \.nav\s*\{[^}]*mask-image:/);
  });

  it('R-07: disabled appearance survives component color overrides', () => {
    expect(block('button:disabled')).toContain('opacity: 0.6;');
  });

  it('R-09: warning banners are limited to direct children of the company form', () => {
    expect(block(".company-form > .warning[role='alert']")).toContain('padding:');
    expect(css).not.toContain(".company-form .warning[role='alert']");
  });

  it('R-10: compact form headings and labels match their div root', () => {
    expect(block('.dialog-card:not(:has(.dialog-header)) > div > h2')).toContain(
      'margin-bottom: var(--space-4);',
    );
    expect(block('.dialog-card > div > label')).toContain('display: flex;');
  });

  it.each([
    'thead th',
    '.dialog-header + .meta',
    '.dialog-summary-score > .meta',
    '.criteria-note',
    '.radar-note',
    'section.page > p.meta',
  ])('R-12: %s uses readable secondary text', (selector) => {
    expect(block(selector)).toContain('color: var(--color-text-secondary);');
  });

  it('R-13: document focus scrolling leaves room for one and two header rows', () => {
    expect(block('html')).toContain('scroll-padding-top:');
    expect(css).toContain('scroll-padding-top: calc(var(--header-height) * 2 + var(--space-4));');
  });

  it('R-14: scrolling resets after screen changes, while query changes preserve the position', () => {
    const source = readFileSync(resolve(__dirname, '../../frontend/use-route.ts'), 'utf8');
    expect(source).toMatch(
      /useLayoutEffect\(\(\) => \{\s*window\.scrollTo\(\{ top: 0, left: 0, behavior: 'instant' \}\);\s*\}, \[route\.kind\]\)/,
    );
  });

  it('R-15: company names expose their own hit target, tooltip and text selection', () => {
    expect(list).toContain('className="company-name company-name-button"');
    expect(list).toContain('title={company.name}');
    expect(list).toContain('window.getSelection()?.isCollapsed === false');
    expect(block('.company-name-button')).toContain('z-index: 2;');
    expect(block('.company-name-button')).toContain('user-select: text;');
  });
});
