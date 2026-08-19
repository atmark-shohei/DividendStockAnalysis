import { describe, expect, it } from 'vitest';

import { companyListQuery } from '@/handler/dto/company-list-query';

/**
 * `GET /api/companies?q=&sort=&page=&perPage=` の検証。
 *
 * `useActualForScoringQuery`（不正なら400）とは異なり、**不正値・未知値は例外にせず
 * 既定値へ丸める**（`docs/02_design/api/company-api.md` §GET /api/companies）。
 * `parse()` が常に成功する（例外を投げない）ことも併せて確認する。
 */

describe('companyListQuery — q', () => {
  const cases: ReadonlyArray<{ name: string; input: unknown; expected: string }> = [
    { name: '未指定 → 空文字（絞り込まない）', input: undefined, expected: '' },
    { name: '前後空白はトリムされる', input: '  KDDI  ', expected: 'KDDI' },
    { name: '空文字はそのまま空文字', input: '', expected: '' },
    { name: '通常値はそのまま', input: '9433', expected: '9433' },
  ];

  it.each(cases)('$name', ({ input, expected }) => {
    const result = companyListQuery.parse({
      q: input,
      sort: undefined,
      page: undefined,
      perPage: undefined,
    });
    expect(result.q).toBe(expected);
  });
});

describe('companyListQuery — sort', () => {
  const cases: ReadonlyArray<{ name: string; input: unknown; expected: string }> = [
    { name: '未指定 → 既定 created_desc', input: undefined, expected: 'created_desc' },
    {
      name: '未知値 → 既定 created_desc へ丸める（400にしない）',
      input: 'unknown',
      expected: 'created_desc',
    },
    { name: 'score_desc はそのまま通す', input: 'score_desc', expected: 'score_desc' },
    { name: 'score_asc はそのまま通す', input: 'score_asc', expected: 'score_asc' },
    { name: 'code_asc はそのまま通す', input: 'code_asc', expected: 'code_asc' },
  ];

  it.each(cases)('$name', ({ input, expected }) => {
    const result = companyListQuery.parse({
      q: undefined,
      sort: input,
      page: undefined,
      perPage: undefined,
    });
    expect(result.sort).toBe(expected);
  });
});

describe('companyListQuery — page', () => {
  const cases: ReadonlyArray<{ name: string; input: unknown; expected: number }> = [
    { name: '未指定 → 既定 1', input: undefined, expected: 1 },
    { name: '0以下 → 既定 1 へ丸める', input: '0', expected: 1 },
    { name: '負値 → 既定 1 へ丸める', input: '-1', expected: 1 },
    { name: '非数値 → 既定 1 へ丸める', input: 'abc', expected: 1 },
    { name: '小数 → 既定 1 へ丸める（整数のみ許可）', input: '1.5', expected: 1 },
    { name: '2 はそのまま通す', input: '2', expected: 2 },
  ];

  it.each(cases)('$name', ({ input, expected }) => {
    const result = companyListQuery.parse({
      q: undefined,
      sort: undefined,
      page: input,
      perPage: undefined,
    });
    expect(result.page).toBe(expected);
  });
});

describe('companyListQuery — perPage', () => {
  const cases: ReadonlyArray<{ name: string; input: unknown; expected: number }> = [
    { name: '未指定 → 既定 15', input: undefined, expected: 15 },
    { name: '0 → 既定 15 へ丸める', input: '0', expected: 15 },
    { name: '101（上限超え） → 既定 15 へ丸める', input: '101', expected: 15 },
    { name: '100（上限ちょうど） → そのまま通す', input: '100', expected: 100 },
    { name: '1（下限ちょうど） → そのまま通す', input: '1', expected: 1 },
    { name: '非数値 → 既定 15 へ丸める', input: 'abc', expected: 15 },
  ];

  it.each(cases)('$name', ({ input, expected }) => {
    const result = companyListQuery.parse({
      q: undefined,
      sort: undefined,
      page: undefined,
      perPage: input,
    });
    expect(result.perPage).toBe(expected);
  });
});

describe('companyListQuery.parse は例外を投げない（.catch() があるため常に成功する）', () => {
  it('全項目が不正でも parse() が成功する', () => {
    expect(() =>
      companyListQuery.parse({ q: undefined, sort: 'bogus', page: 'NaN', perPage: '9999' }),
    ).not.toThrow();
  });
});
