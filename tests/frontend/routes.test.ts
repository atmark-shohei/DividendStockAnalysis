import { describe, expect, it } from 'vitest';

import { parseRoute, routeToPath, type Route } from '../../frontend/routes';

/**
 * URL と画面の対応。**画面状態は URL が正**なので、ここが崩れると
 * リロード・共有・戻る/進むが壊れる（`.claude/rules/frontend.md`）。
 */
describe('parseRoute', () => {
  const cases: readonly (readonly [name: string, href: string, expected: Route])[] = [
    ['ルートは一覧・選択なし', '/', { kind: 'list', selectedCode: null, useActualForScoring: false }],
    [
      'code 付きは一覧・選択あり',
      '/?code=7203',
      { kind: 'list', selectedCode: '7203', useActualForScoring: false },
    ],
    [
      '3桁数字＋末尾英字の4文字コードも受ける',
      '/?code=130A',
      { kind: 'list', selectedCode: '130A', useActualForScoring: false },
    ],
    ['入力画面', '/input', { kind: 'input' }],
    ['入力画面の末尾スラッシュは同じ画面', '/input/', { kind: 'input' }],
    ['入力画面のクエリは無視する', '/input?code=7203', { kind: 'input' }],
    [
      '未知のパスは一覧へ倒す',
      '/no-such-page',
      { kind: 'list', selectedCode: null, useActualForScoring: false },
    ],
    [
      '他のクエリは選択に影響しない',
      '/?sort=score',
      { kind: 'list', selectedCode: null, useActualForScoring: false },
    ],
  ];

  it.each(cases)('%s', (_name, href, expected) => {
    expect(parseRoute(href)).toEqual(expected);
  });

  /**
   * 形式不正のコードをそのまま API へ渡さない。**判定は handler の `companyCode`
   * （`src/handler/dto/company-input.ts`）と同じ形式に揃える。**
   * 画面だけが緩いと API が 400 を返し、厳しいと登録済みの銘柄を開けなくなる。
   *
   * `1301A`（4桁数字＋英字の5文字）は JPX の実際の採番形式ではない
   * （4文字固定・末尾1文字だけが英字になりうる）ので、5文字コードは弾く。
   */
  const invalidCodes = ['', '720', '1301A', 'abcd', '7203a', '<script>', '7203 ', '７２０３'];

  it.each(invalidCodes)('形式不正のコード %j は選択なしにする', (code) => {
    expect(parseRoute(`/?code=${encodeURIComponent(code)}`)).toEqual({
      kind: 'list',
      selectedCode: null,
      useActualForScoring: false,
    });
  });

  it('code が空指定でも選択なしになる', () => {
    expect(parseRoute('/?code=')).toEqual({
      kind: 'list',
      selectedCode: null,
      useActualForScoring: false,
    });
  });

  /**
   * ③ 予想配当性向のソース切替（`docs/02_design/logic/payout-ratio-scoring.md` §7）。
   * 「リクエスト単位の一時指定」を URL 状態として扱う決定（Manager決定、2026-08-06）。
   */
  describe('useActualForScoring', () => {
    it('true 指定を受け取る', () => {
      expect(parseRoute('/?code=7203&useActualForScoring=true')).toEqual({
        kind: 'list',
        selectedCode: '7203',
        useActualForScoring: true,
      });
    });

    it('省略時は false（既定は予想優先）', () => {
      expect(parseRoute('/?code=7203')).toEqual({
        kind: 'list',
        selectedCode: '7203',
        useActualForScoring: false,
      });
    });

    it('"true" 以外の値（"1" 等）は false にする。文字列 "true" だけを真とする', () => {
      expect(parseRoute('/?code=7203&useActualForScoring=1')).toEqual({
        kind: 'list',
        selectedCode: '7203',
        useActualForScoring: false,
      });
    });

    it('選択なし（コード不正）でも独立して読める', () => {
      expect(parseRoute('/?useActualForScoring=true')).toEqual({
        kind: 'list',
        selectedCode: null,
        useActualForScoring: true,
      });
    });
  });
});

describe('routeToPath', () => {
  const cases: readonly (readonly [name: string, route: Route, expected: string])[] = [
    [
      '一覧・選択なし',
      { kind: 'list', selectedCode: null, useActualForScoring: false },
      '/',
    ],
    [
      '一覧・選択あり',
      { kind: 'list', selectedCode: '7203', useActualForScoring: false },
      '/?code=7203',
    ],
    ['入力画面', { kind: 'input' }, '/input'],
    [
      '実績優先も選択ありなら useActualForScoring=true を付ける',
      { kind: 'list', selectedCode: '7203', useActualForScoring: true },
      '/?code=7203&useActualForScoring=true',
    ],
    [
      '選択なしでも実績優先の指定は残す',
      { kind: 'list', selectedCode: null, useActualForScoring: true },
      '/?useActualForScoring=true',
    ],
  ];

  it.each(cases)('%s', (_name, route, expected) => {
    expect(routeToPath(route)).toBe(expected);
  });

  it('往復しても同じ画面になる', () => {
    for (const route of cases.map(([, value]) => value)) {
      expect(parseRoute(routeToPath(route))).toEqual(route);
    }
  });

  it('既定値（false）は URL に出さない。既存の見た目（/?code=7203）を変えない', () => {
    expect(routeToPath({ kind: 'list', selectedCode: '7203', useActualForScoring: false })).toBe(
      '/?code=7203',
    );
  });
});
