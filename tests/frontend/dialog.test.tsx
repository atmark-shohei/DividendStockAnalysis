import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { getFocusableSelector, nextFocusIndex } from '../../frontend/components/Dialog';

/**
 * `<Dialog>`（`docs/02_design/ui/components.md` §3、`docs/02_design/ui/pages/analysis-dialog.md` §8）
 * のフォーカストラップ計算ロジック。
 *
 * `@testing-library/react` が未導入のため、実際の `.focus()` 呼び出し・`keydown` 配線・
 * scrim クリックでの `onClose` 発火は検証できない（`Dialog.tsx` 内のコメントで明示）。
 * DOM に依存しない純粋関数（`nextFocusIndex`/`getFocusableSelector`）だけをここで検証する
 * （`tests/frontend/score-bar.test.tsx` と同じ方針）。
 */
describe('nextFocusIndex', () => {
  const cases: readonly (readonly [
    name: string,
    currentIndex: number,
    count: number,
    shiftKey: boolean,
    expected: number,
  ])[] = [
    ['要素0件は常に-1（フォーカス対象が無い）', 0, 0, false, -1],
    ['要素0件はShift+Tabでも-1', 0, 0, true, -1],
    ['要素1件はTabで自身のまま（0→0の循環）', 0, 1, false, 0],
    ['要素1件はShift+Tabでも自身のまま', 0, 1, true, 0],
    ['末尾でTabすると先頭へ循環', 2, 3, false, 0],
    ['先頭でShift+Tabすると末尾へ循環', 0, 3, true, 2],
    ['中間でTabすると次の要素へ', 1, 3, false, 2],
    ['中間でShift+Tabすると前の要素へ', 1, 3, true, 0],
    // document.activeElement がダイアログ内に見つからない（-1）場合のフォールバック
    ['現在地が見つからない(-1)場合、Tabは先頭(0)へ', -1, 3, false, 0],
    ['現在地が見つからない(-1)場合、Shift+Tabは末尾へ', -1, 3, true, 2],
  ];

  it.each(cases)('%s', (_name, currentIndex, count, shiftKey, expected) => {
    expect(nextFocusIndex(currentIndex, count, shiftKey)).toBe(expected);
  });
});

describe('getFocusableSelector', () => {
  it('button・href付き要素・フォーム部品・tabindex(-1以外)を含むセレクタを返す', () => {
    const selector = getFocusableSelector();
    expect(selector).toContain('button');
    expect(selector).toContain('[href]');
    expect(selector).toContain('input');
    expect(selector).toContain('select');
    expect(selector).toContain('textarea');
    expect(selector).toContain('[tabindex]:not([tabindex="-1"])');
  });
});

/**
 * `Dialog.tsx` の DOM 副作用の配線（T-105 問題2）。
 *
 * これは**バグ修正ではない**。`Dialog.tsx` 自体は規約通り実装済み（`role="dialog"` +
 * `aria-modal="true"` + `aria-labelledby` + Escape + Tab循環 + フォーカス保存/復帰）。
 * 未検証だったのは「実装が規約通りの配線を保っているか」を機械的に固定する構造テストが
 * 無かった点。`@testing-library/react` は未導入のため、実際の `.focus()` 呼び出し・
 * `keydown` イベントの発火は検証できない。`readFileSync` + 正規表現でソース文字列上の
 * 配線の存在を固定する（`nav-bar.test.tsx` と同型。fe-plan.md §3.1）。
 */
describe('Dialog.tsx: DOM副作用の配線が存在する（構造テスト。実装変更はしていない）', () => {
  const dialogSource = readFileSync(
    resolve(__dirname, '../../frontend/components/Dialog.tsx'),
    'utf-8',
  );

  it('role="dialog" と aria-modal="true" が同じ要素に付与されている', () => {
    expect(dialogSource).toMatch(/role="dialog"\s*\n\s*aria-modal="true"/);
  });

  it('aria-labelledby={labelId} が付与されている', () => {
    expect(dialogSource).toMatch(/aria-labelledby=\{labelId\}/);
  });

  it('Escape で onClose を呼ぶ keydown 配線が存在する', () => {
    expect(dialogSource).toMatch(/document\.addEventListener\('keydown', handleKeyDown\)/);
    expect(dialogSource).toMatch(/event\.key === 'Escape'/);
  });

  it('Tab のフォーカストラップ配線（早期returnとnextFocusIndex呼び出し）が存在する', () => {
    expect(dialogSource).toMatch(/event\.key !== 'Tab'/);
    expect(dialogSource).toMatch(
      /nextFocusIndex\(currentIndex, focusable\.length, event\.shiftKey\)/,
    );
  });

  it('開いた瞬間にフォーカスを保存し、閉じた瞬間に復帰させる配線が存在する', () => {
    expect(dialogSource).toMatch(/previouslyFocusedRef\.current =\s*\n\s*document\.activeElement/);
    expect(dialogSource).toMatch(/previouslyFocusedRef\.current\?\.focus\(\);/);
  });

  it('open === false のとき null を返す（DOMから完全に外す）', () => {
    expect(dialogSource).toMatch(/if \(!open\) return null;/);
  });

  it('scrim クリック（event.target === event.currentTarget）で onClose を呼ぶ', () => {
    expect(dialogSource).toMatch(/if \(event\.target === event\.currentTarget\) onClose\(\);/);
  });
});
