import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

// 入力フォームのうち、React の state を持たない部分をテストする。
// `@testing-library/react` は導入していないので JSX は書かない（`company-form.test.tsx` と同じ方針）。
import {
  canSubmitAuthForm,
  confirmPasswordErrorText,
  isNonEmptyPassword,
  isValidEmailFormat,
  isValidSignupPasswordLength,
  passwordsMatch,
} from '../../frontend/components/AuthForm';

const authFormSource = readFileSync(
  resolve(__dirname, '../../frontend/components/AuthForm.tsx'),
  'utf-8',
);

describe('isValidEmailFormat', () => {
  const cases: readonly (readonly [name: string, email: string, expected: boolean])[] = [
    ['正常系', 'a@b.com', true],
    ['@ 無し', 'ab.com', false],
    ['ドット無し', 'a@bcom', false],
    ['空文字', '', false],
    // 全角→半角正規化はしない決定の裏返し（login-page.md §4）。
    // 全角の @（＠）は半角 @ と同一視されず、構造的にマッチしないため弾かれる
    ['全角＠は弾く（正規化しない決定の裏返し）', 'ａ＠ｂ.com', false],
  ];

  it.each(cases)('%s: %j -> %s', (_name, email, expected) => {
    expect(isValidEmailFormat(email)).toBe(expected);
  });
});

describe('isValidSignupPasswordLength', () => {
  const cases: readonly (readonly [name: string, password: string, expected: boolean])[] = [
    ['7文字（下限未満・境界）', '1234567', false],
    ['8文字（下限・境界）', '12345678', true],
    ['128文字（上限・境界）', 'a'.repeat(128), true],
    ['129文字（上限超・境界）', 'a'.repeat(129), false],
    ['空文字', '', false],
  ];

  it.each(cases)('%s', (_name, password, expected) => {
    expect(isValidSignupPasswordLength(password)).toBe(expected);
  });
});

describe('isNonEmptyPassword', () => {
  const cases: readonly (readonly [name: string, password: string, expected: boolean])[] = [
    ['空文字', '', false],
    ['1文字', 'a', true],
    // ログイン時は上限を課さない（既存アカウントの古いパスワードを弾かないため）
    ['128文字超（ログインは上限を課さない）', 'a'.repeat(200), true],
  ];

  it.each(cases)('%s', (_name, password, expected) => {
    expect(isNonEmptyPassword(password)).toBe(expected);
  });
});

describe('passwordsMatch', () => {
  it('一致', () => {
    expect(passwordsMatch('abcdefgh', 'abcdefgh')).toBe(true);
  });

  it('不一致', () => {
    expect(passwordsMatch('abcdefgh', 'abcdefgi')).toBe(false);
  });

  it('両方空文字は一致扱いになる（canSubmitAuthForm 側で別途弾かれる）', () => {
    expect(passwordsMatch('', '')).toBe(true);
  });
});

describe('canSubmitAuthForm', () => {
  describe('mode: login', () => {
    it('有効メール + 非空パスワード -> true', () => {
      expect(
        canSubmitAuthForm('login', { email: 'a@b.com', password: 'x', confirmPassword: '' }),
      ).toBe(true);
    });

    it('不正メール -> false', () => {
      expect(
        canSubmitAuthForm('login', { email: 'ab.com', password: 'x', confirmPassword: '' }),
      ).toBe(false);
    });

    it('空パスワード -> false', () => {
      expect(
        canSubmitAuthForm('login', { email: 'a@b.com', password: '', confirmPassword: '' }),
      ).toBe(false);
    });
  });

  describe('mode: signup', () => {
    it('有効メール + 8文字パスワード + 一致確認 -> true', () => {
      expect(
        canSubmitAuthForm('signup', {
          email: 'a@b.com',
          password: '12345678',
          confirmPassword: '12345678',
        }),
      ).toBe(true);
    });

    it('7文字パスワード -> false（境界値）', () => {
      expect(
        canSubmitAuthForm('signup', {
          email: 'a@b.com',
          password: '1234567',
          confirmPassword: '1234567',
        }),
      ).toBe(false);
    });

    it('確認欄が不一致 -> false', () => {
      expect(
        canSubmitAuthForm('signup', {
          email: 'a@b.com',
          password: '12345678',
          confirmPassword: '87654321',
        }),
      ).toBe(false);
    });

    it('不正メール -> false', () => {
      expect(
        canSubmitAuthForm('signup', {
          email: 'ab.com',
          password: '12345678',
          confirmPassword: '12345678',
        }),
      ).toBe(false);
    });

    it('両方空文字（パスワード欄未入力）-> false（passwordsMatch は true だが長さ不足で弾かれる）', () => {
      expect(
        canSubmitAuthForm('signup', { email: 'a@b.com', password: '', confirmPassword: '' }),
      ).toBe(false);
    });
  });
});

describe('confirmPasswordErrorText', () => {
  it('確認欄未入力 -> null（送信前は無警告）', () => {
    expect(confirmPasswordErrorText('12345678', '')).toBeNull();
  });

  it('一致 -> null', () => {
    expect(confirmPasswordErrorText('12345678', '12345678')).toBeNull();
  });

  it('不一致 -> 文言あり', () => {
    expect(confirmPasswordErrorText('12345678', '87654321')).toBe('パスワードが一致しません');
  });
});

/**
 * T-105 問題3: 確認用パスワード欄とエラー文言の `aria-describedby` 紐付け。
 * `@testing-library/react` 未導入のため、`readFileSync` + 正規表現でソースを直接検証する
 * （`nav-bar.test.tsx` と同型）。
 */
describe('AuthForm.tsx: 確認用パスワード欄がエラー文言と aria-describedby で紐付いている（T-105 問題3）', () => {
  it('確認欄の aria-describedby は confirmError の有無で id/undefined を出し分ける', () => {
    expect(authFormSource).toMatch(
      /aria-describedby=\{confirmError !== null \? 'confirm-password-error' : undefined\}/,
    );
  });

  it('エラー <span role="alert"> の id が確認欄の aria-describedby と同じ値である', () => {
    expect(authFormSource).toMatch(
      /<span className="warning" role="alert" id="confirm-password-error">/,
    );
  });
});
