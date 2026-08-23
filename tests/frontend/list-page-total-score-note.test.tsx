import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * 解析ダイアログ（`frontend/components/AnalysisDialogBody.tsx`）への「総合点は比較不能」
 * 注記追加（T-101。T-088レビュー指摘対応）。ADR-0012 §決定D-3「画面（指標カスタマイズ・
 * 解析ダイアログ）に必ず明記すること」への対応。
 *
 * T-103: 元は `ListPage.tsx` に private 実装されていた `ScoringBody` を
 * `AnalysisDialogBody.tsx` へ抽出したため、参照先をそちらへ更新した
 * （動作は変えず抽出のみ。アサーション内容自体は変更していない）。
 *
 * `@testing-library/react` 未導入のため描画位置までは検証できない（RTL無しの制約。
 * `tests/frontend/criteria-page.test.tsx` と同じ方針）。ここでは「参照がある」ことのみ保証する。
 */
const analysisDialogBodySource = readFileSync(
  resolve(__dirname, '../../frontend/components/AnalysisDialogBody.tsx'),
  'utf-8',
);

describe('AnalysisDialogBody.tsx: 総合点比較不能の注記（ADR-0012 §決定D-3）', () => {
  it('TOTAL_SCORE_COMPARISON_NOTE を format.ts から import している', () => {
    expect(analysisDialogBodySource).toMatch(/TOTAL_SCORE_COMPARISON_NOTE/);
  });

  it('注記の描画箇所が条件分岐（&&）に包まれていない', () => {
    const lines = analysisDialogBodySource.split('\n');
    const targetLineIndex = lines.findIndex((line) =>
      line.includes('{TOTAL_SCORE_COMPARISON_NOTE}'),
    );
    expect(targetLineIndex).toBeGreaterThan(-1);
    expect(lines[targetLineIndex] ?? '').not.toMatch(/&&/);
  });
});
