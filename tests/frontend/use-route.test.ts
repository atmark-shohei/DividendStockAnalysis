import { describe, expect, it, vi } from 'vitest';

// `useRoute()` は React フックであり、`jsdom`/`@testing-library/react` が未導入の現状
// レンダラ無しに直接呼び出せない（"Invalid hook call"）。ここでは `navigate` から
// 切り出した「`replace` か `push` かを選ぶ」純粋関数（`selectHistoryMethod`）だけを
// テストする。`window.history` の実呼び出し・`popstate` 購読・フックとしての結線
// （`useSyncExternalStore` 等）はここでは検証できない（CR-8、T-094 FEレビュー）。
import { selectHistoryMethod } from '../../frontend/use-route';

describe('selectHistoryMethod', () => {
  const cases: readonly (readonly [
    name: string,
    replace: boolean | undefined,
    expectReplace: boolean,
  ])[] = [
    ['replace省略 -> pushState（既定）', undefined, false],
    ['replace: false -> pushState', false, false],
    ['replace: true -> replaceState', true, true],
  ];

  it.each(cases)('%s', (_name, replace, expectReplace) => {
    const pushState = vi.fn();
    const replaceState = vi.fn();
    const method = selectHistoryMethod({ pushState, replaceState }, replace);
    method(null, '', '/foo');

    if (expectReplace) {
      expect(replaceState).toHaveBeenCalledWith(null, '', '/foo');
      expect(pushState).not.toHaveBeenCalled();
    } else {
      expect(pushState).toHaveBeenCalledWith(null, '', '/foo');
      expect(replaceState).not.toHaveBeenCalled();
    }
  });
});
