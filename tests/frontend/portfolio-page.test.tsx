import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * `PortfolioPage.tsx`/`HoldingsTable.tsx`/`PortfolioTabs.tsx` の構造的な回帰防止テスト
 * （T-103 fe-review CR-5）。`fe-plan.md` §6-2 が計画していたが未作成だったファイルを
 * ここで作る。`@testing-library/react` 未導入のため、`readFileSync` + 正規表現で
 * ソースを直接検証する（`list-page-total-score-note.test.tsx`/`nav-bar.test.tsx` と同型）。
 */

const portfolioPageSource = readFileSync(
  resolve(__dirname, '../../frontend/pages/PortfolioPage.tsx'),
  'utf-8',
);
const holdingsTableSource = readFileSync(
  resolve(__dirname, '../../frontend/components/HoldingsTable.tsx'),
  'utf-8',
);
const portfolioTabsSource = readFileSync(
  resolve(__dirname, '../../frontend/components/PortfolioTabs.tsx'),
  'utf-8',
);

describe('HoldingsTable.tsx: <table> を使っている（<div>グリッドで代替していない）', () => {
  it('<table className="metric-table"> が使われている', () => {
    expect(holdingsTableSource).toMatch(/<table className="metric-table">/);
  });
});

describe('HoldingsTable.tsx: 行クリックが stretched button パターン（.metric-row-button）を使っている', () => {
  it('<tr className="metric-row"> と <button className="metric-row-button"> が対で存在する', () => {
    expect(holdingsTableSource).toMatch(/<tr key=\{holding\.code\} className="metric-row">/);
    expect(holdingsTableSource).toMatch(/className="metric-row-button"/);
  });
});

describe('HoldingsTable.tsx: スコア列の「有効N/10」相当の併記が省略されていない', () => {
  it('effectiveMetricCount/totalMetricCount が併記されている', () => {
    expect(holdingsTableSource).toMatch(
      /（有効 \{holding\.effectiveMetricCount\}\/\{holding\.totalMetricCount\}）/,
    );
  });
});

describe('PortfolioPage.tsx: TOTAL_SCORE_COMPARISON_NOTE の描画箇所が条件分岐（&&）に包まれていない', () => {
  it('{TOTAL_SCORE_COMPARISON_NOTE} を含む行に && が無い', () => {
    const lines = portfolioPageSource.split('\n');
    const targetLineIndex = lines.findIndex((line) =>
      line.includes('{TOTAL_SCORE_COMPARISON_NOTE}'),
    );
    expect(targetLineIndex).toBeGreaterThan(-1);
    expect(lines[targetLineIndex] ?? '').not.toMatch(/&&/);
  });
});

describe('PortfolioPage.tsx: 「＋ 作成」「＋ 銘柄を追加」の disabled がマジックナンバーでハードコードされていない', () => {
  it('「＋ 作成」（EmptyState の cta）は canAddPortfolio 呼び出し由来の値を使う', () => {
    expect(portfolioPageSource).toMatch(
      /canAddNewPortfolio = canAddPortfolio\(portfolios\.items\.length, portfolios\.maxPortfolios\)/,
    );
  });

  it('「＋ 銘柄を追加」の disabled は canAddHolding(...) の呼び出し結果である', () => {
    expect(portfolioPageSource).toMatch(
      /disabled=\{\s*!canAddHolding\(detail\.data\.holdings\.length, MAX_HOLDINGS_PER_PORTFOLIO\)\s*\}/,
    );
  });
});

/**
 * CR-2: `evaluableValueCount`（`portfolio-metrics.md` §3.1「画面は必ず併記する」）が
 * `PortfolioPage.tsx` 内で条件分岐に包まれず参照されていること。全銘柄評価額算出済み
 * （`evaluableValueCount === holdings.length`）のケースでも省略されないことを、
 * マジックナンバーではなく変数参照であることで確認する。
 */
describe('PortfolioPage.tsx: evaluableValueCount の併記（CR-2是正）', () => {
  it('detail.data.metrics.evaluableValueCount を参照している', () => {
    expect(portfolioPageSource).toMatch(/detail\.data\.metrics\.evaluableValueCount/);
  });

  it('母数は holdings.length（yieldEvaluableHoldingCount とは別集合）', () => {
    expect(portfolioPageSource).toMatch(
      /evaluableValueCount\}\/\s*\{?\s*detail\.data\.holdings\.length/,
    );
  });

  it('併記箇所が条件分岐（&&）に包まれていない', () => {
    const lines = portfolioPageSource.split('\n');
    const targetLineIndex = lines.findIndex((line) =>
      line.includes('detail.data.metrics.evaluableValueCount'),
    );
    expect(targetLineIndex).toBeGreaterThan(-1);
    expect(lines[targetLineIndex] ?? '').not.toMatch(/&&/);
  });
});

/**
 * CR-3・推測仕様#5（Manager承認済み）: 保有銘柄の削除・数量編集、ポートフォリオの
 * 削除操作。`HoldingsTable.tsx` の操作列・`.holding-row-actions`（stretched button の
 * 当たり判定回避）・`PortfolioPage.tsx` のポートフォリオ削除ボタン・`<ConfirmDialog>`
 * 経由の呼び出しを検証する。
 *
 * T-105 確認事項B: `window.confirm`（ブラウザネイティブ）を `<Dialog>` ベースの独自
 * 確認モーダル（`ConfirmDialog.tsx`）に置き換えた。フォーカストラップ・Escape・
 * aria-modal は `<Dialog>` 側の実装をそのまま継承する。
 */
describe('HoldingsTable.tsx: 操作列（編集・削除ボタン）が存在する（CR-3是正）', () => {
  it('<th scope="col">操作</th> の見出しがある', () => {
    expect(holdingsTableSource).toMatch(/<th scope="col">操作<\/th>/);
  });

  it('編集ボタンが onEditHolding(holding.code) を呼ぶ', () => {
    expect(holdingsTableSource).toMatch(/onEditHolding\(holding\.code\);/);
  });

  it('削除ボタンは window.confirm を直接呼ばない（T-105是正）', () => {
    expect(holdingsTableSource).not.toMatch(/window\.confirm\(/);
  });

  it('削除ボタンは確認対象を state にセットし、<ConfirmDialog> の onConfirm から onRemoveHolding を呼ぶ', () => {
    expect(holdingsTableSource).toMatch(/setConfirmTarget\(holding\);/);
    expect(holdingsTableSource).toMatch(
      /onConfirm=\{\(\) => \{\s*if \(confirmTarget === null\) return;\s*onRemoveHolding\(confirmTarget\.code\);/,
    );
  });

  it('<ConfirmDialog> が配線されている（open は confirmTarget !== null 由来）', () => {
    expect(holdingsTableSource).toMatch(/<ConfirmDialog/);
    expect(holdingsTableSource).toMatch(/open=\{confirmTarget !== null\}/);
  });

  it('操作列の <td> に .holding-row-actions（stretched button の当たり判定回避）が付与されている', () => {
    expect(holdingsTableSource).toMatch(/<td className="holding-row-actions">/);
  });

  // CR-5: title/message の実文言自体を固定するテスト（配線の有無だけでなく、
  // 文言が意図せず変わったら検知する）
  it('<ConfirmDialog> に title="保有銘柄を削除" が渡っている', () => {
    expect(holdingsTableSource).toMatch(/title="保有銘柄を削除"/);
  });

  it('<ConfirmDialog> の message が対象銘柄名・銘柄コードを含むテンプレートである', () => {
    expect(holdingsTableSource).toMatch(
      /confirmTarget !== null\s*\?\s*`\$\{confirmTarget\.name\}（\$\{confirmTarget\.code\}）を削除しますか？`/,
    );
  });
});

describe('style.css: .holding-row-actions が position:relative/z-index で stretched button の前面に出る', () => {
  const styleCss = readFileSync(resolve(__dirname, '../../frontend/style.css'), 'utf-8');

  it('.holding-row-actions が定義されている', () => {
    const blockMatch = styleCss.match(/\.holding-row-actions\s*\{([\s\S]*?)\}/);
    expect(blockMatch).not.toBeNull();
    const block = blockMatch?.[1] ?? '';
    expect(block).toMatch(/position:\s*relative;/);
    expect(block).toMatch(/z-index:\s*1;/);
  });
});

describe('PortfolioPage.tsx: ポートフォリオ削除ボタン（CR-3是正・T-105で確認モーダルへ置き換え）', () => {
  it('「ポートフォリオを削除」ボタンが存在する', () => {
    expect(portfolioPageSource).toMatch(/ポートフォリオを削除/);
  });

  it('削除ボタンは window.confirm を直接呼ばない（T-105是正）', () => {
    expect(portfolioPageSource).not.toMatch(/window\.confirm\(/);
  });

  it('削除ボタンは確認モーダルを開くだけで、即座に onDeletePortfolio を呼ばない', () => {
    expect(portfolioPageSource).toMatch(/setIsDeletePortfolioConfirmOpen\(true\);/);
  });

  it('<ConfirmDialog> の onConfirm から actions.onDeletePortfolio(activePortfolioId) を呼ぶ', () => {
    const confirmBlockMatch = portfolioPageSource.match(
      /onConfirm=\{\(\) => \{\s*setIsDeletePortfolioConfirmOpen\(false\);\s*if \(activePortfolioId === null\) return;\s*actions\.onDeletePortfolio\(activePortfolioId\);\s*\}\}/,
    );
    expect(confirmBlockMatch).not.toBeNull();
  });

  it('<ConfirmDialog> が配線されている（open は isDeletePortfolioConfirmOpen 由来）', () => {
    expect(portfolioPageSource).toMatch(/<ConfirmDialog/);
    expect(portfolioPageSource).toMatch(/open=\{isDeletePortfolioConfirmOpen\}/);
  });

  /**
   * CR-4: 削除確認メッセージに対象ポートフォリオ名を含める。
   * CR-5: title/message の実文言自体を固定するテスト（配線の有無だけでなく、
   * 文言が意図せず変わったら検知する）。
   */
  it('activePortfolioName が portfolios.items から activePortfolioId で解決されている', () => {
    expect(portfolioPageSource).toMatch(
      /activePortfolioName =\s*portfolios\.items\.find\(\(portfolio\) => portfolio\.id === activePortfolioId\)\?\.name \?\? null;/,
    );
  });

  it('<ConfirmDialog> に title="ポートフォリオを削除" が渡っている', () => {
    expect(portfolioPageSource).toMatch(/title="ポートフォリオを削除"/);
  });

  it('message は activePortfolioName を参照し、「「名前」を削除しますか？」の形式になる', () => {
    expect(portfolioPageSource).toMatch(
      /activePortfolioName !== null\s*\?\s*`「\$\{activePortfolioName\}」を削除しますか？`/,
    );
  });

  it('activePortfolioName が null のときの固定文言フォールバックが残っている', () => {
    expect(portfolioPageSource).toMatch(/'このポートフォリオを削除しますか？'/);
  });
});

describe('PortfolioTabs.tsx: 「＋ 追加」ボタンに portfolio-tabs-add クラスが付与されている（CR-6是正の前提条件）', () => {
  it('className="portfolio-tabs-add" が付いた「＋ 追加」ボタンがある', () => {
    expect(portfolioTabsSource).toMatch(
      /<button\s+type="button"\s+className="portfolio-tabs-add"[\s\S]*?＋ 追加/,
    );
  });
});
