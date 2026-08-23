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
    ['--width-auth-card', '25rem'],
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

  it('--dialog-scrim-color / --dialog-scrim-blur / --dialog-max-width が定義されている（T-096・確認事項C。design-tokens.md に汎用トークンの定義が無いためダイアログ専用トークンとして切り出した）', () => {
    expect(styleCss).toMatch(/--dialog-scrim-color:\s*rgba\(6, 8, 12, 0\.74\);/);
    expect(styleCss).toMatch(/--dialog-scrim-blur:\s*0\.1875rem;/);
    expect(styleCss).toMatch(/--dialog-max-width:\s*58\.75rem;/);
  });

  it('トークンは47個（色17 + フォント族2 + フォントサイズ11 + 余白6 + 角丸5 + content-max1 + width-auth-card1 + shadow-dialog1 + dialog専用3）', () => {
    // fe-plan.md は「42トークン」と記載していたが、内訳（17+2+11+6+5+1+1）を計算すると43。
    // その後 CR-3（T-091 FEレビュー）で `--width-auth-card` を追加したため44になった。
    // T-096 で dialog 専用トークン（scrim-color/scrim-blur/max-width）を3個追加し47になった。
    // design-tokens.md §2〜§4 のトークンは漏れなく:root に定義されているので、
    // ここでは実際の定義数（47）を正として検証する。
    const rootBlockMatch = styleCss.match(/:root\s*\{([\s\S]*?)\n\}/);
    expect(rootBlockMatch).not.toBeNull();
    const rootBlock = rootBlockMatch?.[1] ?? '';
    const declarationCount = (rootBlock.match(/--[a-z0-9-]+:\s*[^;]+;/g) ?? []).length;
    expect(declarationCount).toBe(47);
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
  it('rgba( の出現は --shadow-dialog / --dialog-scrim-color の定義行2箇所のみ（T-096でscrim用トークンを追加）', () => {
    const matches = styleCss.match(/rgba\(/g) ?? [];
    expect(matches).toHaveLength(2);
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
    '../../frontend/pages/AuthPage.tsx',
    '../../frontend/components/NavBar.tsx',
    '../../frontend/components/MetricTable.tsx',
    '../../frontend/components/ScoreRadar.tsx',
    '../../frontend/components/BalanceSheetFields.tsx',
    '../../frontend/components/CompanyForm.tsx',
    '../../frontend/components/AuthForm.tsx',
    '../../frontend/components/AuthStatus.tsx',
    '../../frontend/components/RoleBadge.tsx',
    '../../frontend/components/ScoreBar.tsx',
    '../../frontend/components/Pagination.tsx',
    '../../frontend/components/EmptyState.tsx',
    '../../frontend/components/Skeleton.tsx',
    '../../frontend/components/Dialog.tsx',
    '../../frontend/pages/CriteriaPage.tsx',
    '../../frontend/components/MetricCriteriaCard.tsx',
    '../../frontend/components/ImplementationBadge.tsx',
    // T-103: ポートフォリオ画面（解析ダイアログの共有抽出を含む）
    '../../frontend/components/AnalysisDialogBody.tsx',
    '../../frontend/pages/PortfolioPage.tsx',
    '../../frontend/components/PortfolioTabs.tsx',
    '../../frontend/components/HoldingForm.tsx',
    '../../frontend/components/HoldingsTable.tsx',
    '../../frontend/components/CreatePortfolioForm.tsx',
    // T-103 fe-review CR-3: 保有銘柄編集フォーム
    '../../frontend/components/EditHoldingForm.tsx',
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

  it('一覧表の銘柄コード列（company.code）に mono company-code class が付与されている（CR-1是正）', () => {
    expect(listPageSource).toMatch(/className="mono company-code">\{company\.code\}/);
  });

  it('.company-code が --font-size-2xs / --color-text-tertiary を参照する（CR-1是正）', () => {
    const companyCodeBlockMatch = styleCss.match(/\.company-code\s*\{([\s\S]*?)\}/);
    expect(companyCodeBlockMatch).not.toBeNull();
    expect(companyCodeBlockMatch?.[1]).toContain('var(--font-size-2xs)');
    expect(companyCodeBlockMatch?.[1]).toContain('var(--color-text-tertiary)');
  });

  it('総合点セルの「点」が .score-unit で数値より弱い書体になっている（CR-2是正）', () => {
    expect(listPageSource).toMatch(
      /score-value">\s*\{company\.totalScore\} \/ \{company\.maxTotalScore\}\s*<span className="score-unit">/,
    );
    const scoreUnitBlockMatch = styleCss.match(/\.score-unit\s*\{([\s\S]*?)\}/);
    expect(scoreUnitBlockMatch).not.toBeNull();
    expect(scoreUnitBlockMatch?.[1]).toContain('var(--font-size-base)');
    expect(scoreUnitBlockMatch?.[1]).toContain('font-weight: 400;');
  });

  // T-094: 検索一覧に入力日時列は無い（`search-page.md` §4 の行仕様に記載が無い）。
  // 代わりに配当利回り・配当性向・株価が numeric class で表示される
  it('一覧表の配当利回り列（dividendYieldValue）に numeric class が付与されている', () => {
    expect(listPageSource).toMatch(
      /className="numeric">\s*\{formatMetricValue\(company\.dividendYieldValue, '%', true\)\}/,
    );
  });

  it('一覧表の配当性向列（payoutRatioValue）に numeric class が付与されている（二次情報として text-secondary も付与）', () => {
    expect(listPageSource).toMatch(
      /className="numeric text-secondary">\s*\{formatMetricValue\(company\.payoutRatioValue, '%', false\)\}/,
    );
  });

  it('一覧表の株価列（priceSen）に numeric class が付与されている', () => {
    expect(listPageSource).toMatch(
      /className="numeric text-secondary">\{formatSen\(company\.priceSen\)\}/,
    );
  });

  // T-103: 以下2件は `ScoringBody`（`scoring` ローカル変数）が `AnalysisDialogBody.tsx` へ
  // 移設されたため、参照元をそちらへ更新した（動作は変えず抽出のみ）
  it('総合点の分母（maxTotalScore）に numeric class が付与されている（T-096: AnalysisDialogBody 内でローカル変数 scoring に束縛）', () => {
    const analysisDialogBodySource = readFileSync(
      resolve(__dirname, '../../frontend/components/AnalysisDialogBody.tsx'),
      'utf-8',
    );
    expect(analysisDialogBodySource).toMatch(/className="numeric">\{scoring\.maxTotalScore\}/);
  });

  it('解析結果詳細の入力日時（formatFetchedAt(scoring.fetchedAt)）に numeric class が付与されている（T-096: ローカル変数 scoring）', () => {
    const analysisDialogBodySource = readFileSync(
      resolve(__dirname, '../../frontend/components/AnalysisDialogBody.tsx'),
      'utf-8',
    );
    expect(analysisDialogBodySource).toMatch(
      /className="numeric">\{formatFetchedAt\(scoring\.fetchedAt\)\}/,
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

describe('MetricTable.tsx のスコア列に <ScoreBar> が追加されている（T-096 fe-review CR-1 是正）', () => {
  const metricTableSource = readFileSync(
    resolve(__dirname, '../../frontend/components/MetricTable.tsx'),
    'utf-8',
  );

  it('判定可の行に <ScoreBar value={metric.score} max={MAX_METRIC_SCORE} /> が描画される', () => {
    expect(metricTableSource).toMatch(
      /<ScoreBar value=\{metric\.score\} max=\{MAX_METRIC_SCORE\} \/>/,
    );
  });

  it('MAX_METRIC_SCORE が定数化されている（マジックナンバー禁止。ai/rules/fe/coding-standards.md §4）', () => {
    expect(metricTableSource).toMatch(/const MAX_METRIC_SCORE = 10;/);
  });

  it('判定不能に 0 を出さない。0 に丸めかねない旧パターン `unavailable ? NO_DATA` が残っていない', () => {
    expect(metricTableSource).not.toMatch(/unavailable \? NO_DATA/);
  });

  it('スコア列の判定は metric.score === null を直接見る（TypeScript narrowing のため）', () => {
    expect(metricTableSource).toMatch(/\{metric\.score === null \? \(\s*NO_DATA/);
  });
});

describe('MetricTable.tsx に「›」装飾列が追加されている（T-096 fe-review CR-2 是正）', () => {
  const metricTableSource = readFileSync(
    resolve(__dirname, '../../frontend/components/MetricTable.tsx'),
    'utf-8',
  );

  it('<thead> に aria-hidden な装飾列見出しがある', () => {
    expect(metricTableSource).toMatch(/<th scope="col" aria-hidden="true" \/>/);
  });

  it('各行末尾に aria-hidden な「›」セルがある', () => {
    expect(metricTableSource).toMatch(/<td aria-hidden="true">›<\/td>/);
  });
});

// T-103: 以下3ブロックは `ScoringBody` の `AnalysisDialogBody.tsx` への抽出に伴い、
// 参照元を `ListPage.tsx` から `AnalysisDialogBody.tsx` へ更新した
// （動作は変えず抽出のみ。アサーション内容自体は変更していない）。
describe('AnalysisDialogBody.tsx のダイアログ内エラー表示に role="alert"（T-096 fe-review CR-3 是正）', () => {
  const analysisDialogBodySource = readFileSync(
    resolve(__dirname, '../../frontend/components/AnalysisDialogBody.tsx'),
    'utf-8',
  );

  it('解析結果取得失敗時の <p className="meta"> に role="alert" が付与されている', () => {
    expect(analysisDialogBodySource).toMatch(
      /<p className="meta" role="alert">\s*解析結果を表示できませんでした。/,
    );
  });
});

describe('AnalysisDialogBody.tsx のダイアログ見出しに銘柄コードが併記されている（T-096 fe-review CR-4 是正）', () => {
  const analysisDialogBodySource = readFileSync(
    resolve(__dirname, '../../frontend/components/AnalysisDialogBody.tsx'),
    'utf-8',
  );

  it('<h2> 内で selected.code が mono company-code class 付きで描画される', () => {
    expect(analysisDialogBodySource).toMatch(
      /\{selected\.code !== null && <span className="mono company-code">\{selected\.code\}<\/span>\}/,
    );
  });
});

describe('概要モードの2カラム化（T-096 fe-review CR-5 是正。analysis-dialog.md §3）', () => {
  const analysisDialogBodySource = readFileSync(
    resolve(__dirname, '../../frontend/components/AnalysisDialogBody.tsx'),
    'utf-8',
  );

  it('AnalysisDialogBody.tsx: 総合スコアカード（dialog-summary-score）とレーダーチャート（dialog-summary-chart）が dialog-summary でグリッド化されている', () => {
    expect(analysisDialogBodySource).toMatch(/<div className="dialog-summary">/);
    expect(analysisDialogBodySource).toMatch(/<div className="dialog-summary-score">/);
    expect(analysisDialogBodySource).toMatch(/<div className="dialog-summary-chart">/);
  });

  it('style.css: .dialog-summary が2列グリッドで、左カラム幅を --space-* の組み合わせ（新規トークン無し）で表現している', () => {
    const dialogSummaryBlockMatch = styleCss.match(/\.dialog-summary\s*\{([\s\S]*?)\}/);
    expect(dialogSummaryBlockMatch).not.toBeNull();
    const block = dialogSummaryBlockMatch?.[1] ?? '';
    expect(block).toContain('display: grid;');
    expect(block).toMatch(
      /grid-template-columns:\s*calc\(var\(--space-6\) \* 8 \+ var\(--space-4\)\) 1fr;/,
    );
  });
});

/**
 * ポートフォリオ画面（`/portfolio`、T-103）。`docs/02_design/ui/pages/portfolio-page.md` §3
 * 「評価額合計は `--font-size-display`（38px）/700」・§4.3「評価損益にのみ
 * `--color-positive`/`--color-negative`」。`design-tokens.md` §3.2・§4.3 が正。
 */
describe('style.css: .portfolio-total-value（評価額合計。design-tokens.md §3.2）', () => {
  it('--font-size-display / font-weight: 700 を参照している', () => {
    const blockMatch = styleCss.match(/\.portfolio-total-value\s*\{([\s\S]*?)\}/);
    expect(blockMatch).not.toBeNull();
    const block = blockMatch?.[1] ?? '';
    expect(block).toContain('var(--font-size-display)');
    expect(block).toMatch(/font-weight:\s*700;/);
  });
});

describe('style.css: .pl-positive / .pl-negative（評価損益専用の色。design-tokens.md §2.2）', () => {
  it('.pl-positive は --color-positive を参照している', () => {
    expect(styleCss).toMatch(/\.pl-positive\s*\{\s*color:\s*var\(--color-positive\);\s*\}/);
  });

  it('.pl-negative は --color-negative を参照している', () => {
    expect(styleCss).toMatch(/\.pl-negative\s*\{\s*color:\s*var\(--color-negative\);\s*\}/);
  });
});

/**
 * ポートフォリオタブの選択中スタイル（T-103 fe-review CR-6）。`PortfolioTabs.tsx` の
 * `aria-current="true"` に対応するスタイルが `style.css` に存在することを機械検証する
 * （`.nav a[aria-current='page']` の検証ブロックと同型）。トークン参照のみで
 * 色の直値が無いことも確認する（design-tokens.md §6 受入基準）。
 */
describe('style.css: .portfolio-tabs button[aria-current] の選択中スタイル（CR-6是正）', () => {
  it('選択中タブは --color-action / --color-surface を参照している（直値なし）', () => {
    const blockMatch = styleCss.match(
      /\.portfolio-tabs button\[aria-current='true'\]\s*\{([\s\S]*?)\}/,
    );
    expect(blockMatch).not.toBeNull();
    const block = blockMatch?.[1] ?? '';
    expect(block).toContain('var(--color-surface)');
    expect(block).toContain('var(--color-action)');
    expect(block).not.toMatch(/#[0-9a-fA-F]{3,6}/);
    expect(block).not.toMatch(/rgba\(/);
  });

  it('非選択タブ（「＋ 追加」は除外）は --color-line-strong / --color-text を参照している（.button-outline相当）', () => {
    const blockMatch = styleCss.match(
      /\.portfolio-tabs button:not\(\[aria-current='true'\]\):not\(\.portfolio-tabs-add\)\s*\{([\s\S]*?)\}/,
    );
    expect(blockMatch).not.toBeNull();
    const block = blockMatch?.[1] ?? '';
    expect(block).toContain('var(--color-line-strong)');
    expect(block).toContain('var(--color-text)');
  });
});
