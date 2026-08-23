import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * 解析ダイアログ（`ListPage.tsx` の `ScoringBody`）への「総合点は比較不能」注記追加
 * （T-101。T-088レビュー指摘対応）。ADR-0012 §決定D-3「画面（指標カスタマイズ・
 * 解析ダイアログ）に必ず明記すること」への対応。
 *
 * `@testing-library/react` 未導入のため描画位置までは検証できない（RTL無しの制約。
 * `tests/frontend/criteria-page.test.tsx` と同じ方針）。ここでは「参照がある」ことのみ保証する。
 */
const listPageSource = readFileSync(
  resolve(__dirname, '../../frontend/pages/ListPage.tsx'),
  'utf-8',
);

describe('ListPage.tsx: 総合点比較不能の注記（ADR-0012 §決定D-3）', () => {
  it('TOTAL_SCORE_COMPARISON_NOTE を format.ts から import している', () => {
    expect(listPageSource).toMatch(/TOTAL_SCORE_COMPARISON_NOTE/);
  });

  it('注記の描画箇所が条件分岐（&&）に包まれていない', () => {
    const lines = listPageSource.split('\n');
    const targetLineIndex = lines.findIndex((line) =>
      line.includes('{TOTAL_SCORE_COMPARISON_NOTE}'),
    );
    expect(targetLineIndex).toBeGreaterThan(-1);
    expect(lines[targetLineIndex] ?? '').not.toMatch(/&&/);
  });
});
