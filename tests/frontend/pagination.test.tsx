import { describe, expect, it } from 'vitest';

import {
  computePageCount,
  isNextDisabled,
  isPrevDisabled,
} from '../../frontend/components/Pagination';

/**
 * `<Pagination>`（`docs/02_design/ui/components.md` §3）の純粋関数。
 * `@testing-library/react` 未導入のため、描画結果ではなく計算ロジックをテストする
 * （`tests/frontend/nav-bar.test.tsx` と同じ方針）。
 */
describe('computePageCount', () => {
  const cases: readonly (readonly [
    name: string,
    total: number,
    perPage: number,
    expected: number,
  ])[] = [
    ['0件でも最小1ページ', 0, 15, 1],
    ['ちょうど割り切れる', 30, 15, 2],
    ['端数は切り上げ', 31, 15, 3],
    ['1件のみ', 1, 15, 1],
    ['perPage が 0 以下でもゼロ除算にならない（1ページ扱い）', 30, 0, 1],
    ['perPage が負でもゼロ除算にならない（1ページ扱い）', 30, -1, 1],
  ];

  it.each(cases)('%s', (_name, total, perPage, expected) => {
    expect(computePageCount(total, perPage)).toBe(expected);
  });
});

describe('isPrevDisabled', () => {
  const cases: readonly (readonly [name: string, page: number, expected: boolean])[] = [
    ['先頭ページ（1）は disabled', 1, true],
    ['2ページ目以降は disabled ではない', 2, false],
  ];

  it.each(cases)('%s', (_name, page, expected) => {
    expect(isPrevDisabled(page)).toBe(expected);
  });
});

describe('isNextDisabled', () => {
  const cases: readonly (readonly [
    name: string,
    page: number,
    pageCount: number,
    expected: boolean,
  ])[] = [
    ['最終ページは disabled', 3, 3, true],
    ['最終ページを超えていても disabled（防御的）', 4, 3, true],
    ['中間ページは disabled ではない', 2, 3, false],
    ['1ページしか無いときは常に disabled', 1, 1, true],
  ];

  it.each(cases)('%s', (_name, page, pageCount, expected) => {
    expect(isNextDisabled(page, pageCount)).toBe(expected);
  });
});
