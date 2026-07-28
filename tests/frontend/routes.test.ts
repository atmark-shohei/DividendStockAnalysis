import { describe, expect, it } from 'vitest';

import { parseRoute, routeToPath, type Route } from '../../frontend/routes';

/**
 * URL と画面の対応。**画面状態は URL が正**なので、ここが崩れると
 * リロード・共有・戻る/進むが壊れる（`.claude/rules/frontend.md`）。
 */
describe('parseRoute', () => {
  const cases: readonly (readonly [name: string, href: string, expected: Route])[] = [
    ['ルートは一覧・選択なし', '/', { kind: 'list', selectedCode: null }],
    ['code 付きは一覧・選択あり', '/?code=7203', { kind: 'list', selectedCode: '7203' }],
    ['4桁数字＋英字1文字も受ける', '/?code=1301A', { kind: 'list', selectedCode: '1301A' }],
    ['入力画面', '/input', { kind: 'input' }],
    ['入力画面の末尾スラッシュは同じ画面', '/input/', { kind: 'input' }],
    ['入力画面のクエリは無視する', '/input?code=7203', { kind: 'input' }],
    ['未知のパスは一覧へ倒す', '/no-such-page', { kind: 'list', selectedCode: null }],
    ['他のクエリは選択に影響しない', '/?sort=score', { kind: 'list', selectedCode: null }],
  ];

  it.each(cases)('%s', (_name, href, expected) => {
    expect(parseRoute(href)).toEqual(expected);
  });

  /**
   * 形式不正のコードをそのまま API へ渡さない。**判定は handler の `companyCode`
   * （`src/handler/dto/company-input.ts`）と同じ形式に揃える。**
   * 画面だけが緩いと API が 400 を返し、厳しいと登録済みの銘柄を開けなくなる。
   *
   * ⚠️ `130A`（3桁数字＋英字の4文字）は JPX が 2024 年以降に採番している実在の形式だが、
   * 現在の handler の正規表現 `^\d{4}[0-9A-Z]?$` では弾かれる。ここは handler に
   * 追随させている。handler を直すときは、このテストも一緒に直すこと。
   */
  const invalidCodes = ['', '720', '130A', 'abcd', '7203a', '<script>', '7203 ', '７２０３'];

  it.each(invalidCodes)('形式不正のコード %j は選択なしにする', (code) => {
    expect(parseRoute(`/?code=${encodeURIComponent(code)}`)).toEqual({
      kind: 'list',
      selectedCode: null,
    });
  });

  it('code が空指定でも選択なしになる', () => {
    expect(parseRoute('/?code=')).toEqual({ kind: 'list', selectedCode: null });
  });
});

describe('routeToPath', () => {
  const cases: readonly (readonly [name: string, route: Route, expected: string])[] = [
    ['一覧・選択なし', { kind: 'list', selectedCode: null }, '/'],
    ['一覧・選択あり', { kind: 'list', selectedCode: '7203' }, '/?code=7203'],
    ['入力画面', { kind: 'input' }, '/input'],
  ];

  it.each(cases)('%s', (_name, route, expected) => {
    expect(routeToPath(route)).toBe(expected);
  });

  it('往復しても同じ画面になる', () => {
    for (const route of cases.map(([, value]) => value)) {
      expect(parseRoute(routeToPath(route))).toEqual(route);
    }
  });
});
