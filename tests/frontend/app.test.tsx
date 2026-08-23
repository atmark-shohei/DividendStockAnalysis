import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { AuthUser } from '../../frontend/api';
import { authIdentityKey } from '../../frontend/App';

/**
 * `App.tsx`（`.claude/rules/frontend.md` のデータ取得・状態管理の集約点）の回帰防止テスト。
 * `@testing-library/react` 未導入のため、DOM描画結果は検証できない。
 * `authIdentityKey` は純関数として export し直接呼び出す（`indicator-custom-logic.ts` と同じ
 * 方針）。useEffect の配線自体は `tests/frontend/indicator-custom-page.test.tsx` と同様、
 * ソースをテキストとして読み込み検証する。
 */
const appSource = readFileSync(resolve(__dirname, '../../frontend/App.tsx'), 'utf-8');

function makeUser(id: number): AuthUser {
  return { id, email: `user${String(id)}@example.com`, role: 'user' };
}

describe('authIdentityKey（fe-reviewer CR-1: ログイン/ログアウト検知の比較キー）', () => {
  const cases: readonly (readonly [
    name: string,
    input: AuthUser | null,
    expected: number | null,
  ])[] = [
    ['未ログイン（guest）は null', null, null],
    ['ログイン中ユーザー（id=1）はそのid', makeUser(1), 1],
    ['別ユーザー（id=2）は別のid（境界: idが違えば別人として扱う）', makeUser(2), 2],
  ];

  it.each(cases)('%s', (_name, input, expected) => {
    expect(authIdentityKey(input)).toBe(expected);
  });

  it('同一ユーザーの再取得でオブジェクト参照が変わっても、id が同じなら同じキーになる', () => {
    const first = makeUser(5);
    const second: AuthUser = { ...first };
    expect(first).not.toBe(second);
    expect(authIdentityKey(first)).toBe(authIdentityKey(second));
  });
});

describe('App.tsx: ユーザー切り替え時に indicatorSettings をリセットする（fe-reviewer CR-1）', () => {
  it('authIdentityKey(user) を依存配列に持つ useEffect が indicatorSettings/indicatorSettingsError を null に戻す', () => {
    // ログイン/ログアウトでユーザーが変わった際にキャッシュガード（`indicatorSettings !== null`）
    // が誤って前ユーザーの設定を出し続けないよう、リセット専用の useEffect が
    // authIdentityKey(user) の変化だけで発火する配線になっていることを確認する
    expect(appSource).toMatch(
      /useEffect\(\(\) => \{\s*setIndicatorSettings\(null\);\s*setIndicatorSettingsError\(null\);\s*\}, \[authIdentityKey\(user\)\]\);/,
    );
  });

  it('リセット useEffect は指標設定の取得 useEffect より前で定義されている（先に破棄してから再取得する）', () => {
    const resetIndex = appSource.indexOf(
      'setIndicatorSettings(null);\n    setIndicatorSettingsError(null);',
    );
    const fetchIndex = appSource.indexOf(
      "if (route.kind !== 'indicators' || indicatorSettings !== null) return;",
    );
    expect(resetIndex).toBeGreaterThan(-1);
    expect(fetchIndex).toBeGreaterThan(-1);
    expect(resetIndex).toBeLessThan(fetchIndex);
  });
});
