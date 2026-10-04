import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

// `@testing-library/react` は導入していないので JSX は書かない（`auth-form.test.tsx` と同じ方針）。
// コンポーネントから切り出した純粋関数だけをテストする。
import {
  shouldShowIndicatorsTab,
  shouldShowInputTab,
  shouldShowPortfolioTab,
} from '../../frontend/components/NavBar';
import type { AuthUser } from '../../frontend/api';

const navBarSource = readFileSync(
  resolve(__dirname, '../../frontend/components/NavBar.tsx'),
  'utf-8',
);

/**
 * 「銘柄登録」タブの出し分け（T-092）。`docs/02_design/ui/screen-list.md` §2。
 * タブを隠すことは認可ではない。実効的な制限は BE 側の `requireRole('admin')`
 * （T-091で配線済み）。
 */
describe('shouldShowInputTab', () => {
  const asUser: AuthUser = { id: 1, email: 'user@example.com', role: 'user' };
  const asAdmin: AuthUser = { id: 2, email: 'admin@example.com', role: 'admin' };

  const cases: readonly (readonly [name: string, user: AuthUser | null, expected: boolean])[] = [
    ['guest（未ログイン） -> 非表示', null, false],
    ['一般ユーザー -> 非表示', asUser, false],
    ['管理者 -> 表示', asAdmin, true],
  ];

  it.each(cases)('%s', (_name, user, expected) => {
    expect(shouldShowInputTab(user)).toBe(expected);
  });
});

/**
 * 「指標カスタマイズ」タブの出し分け（T-101）。`docs/02_design/ui/screen-list.md` §2
 * 「指標カスタマイズ: guest — / user ✅ / admin ✅」。`/input` と異なりロール不問。
 */
describe('shouldShowIndicatorsTab', () => {
  const asUser: AuthUser = { id: 1, email: 'user@example.com', role: 'user' };
  const asAdmin: AuthUser = { id: 2, email: 'admin@example.com', role: 'admin' };

  const cases: readonly (readonly [name: string, user: AuthUser | null, expected: boolean])[] = [
    ['guest（未ログイン） -> 非表示', null, false],
    ['一般ユーザー -> 表示', asUser, true],
    ['管理者 -> 表示', asAdmin, true],
  ];

  it.each(cases)('%s', (_name, user, expected) => {
    expect(shouldShowIndicatorsTab(user)).toBe(expected);
  });
});

describe('NavBar.tsx: 指標カスタマイズタブへの導線（fe-plan.md §3）', () => {
  it('/indicators への NavLink が存在する', () => {
    expect(navBarSource).toMatch(
      /<NavLink[\s\S]*?to=\{\{ kind: 'indicators' \}\}[\s\S]*?>\s*指標カスタマイズ/,
    );
  });

  it('shouldShowIndicatorsTab の判定でガードされている', () => {
    expect(navBarSource).toMatch(/\{shouldShowIndicatorsTab\(user\) && \(/);
  });
});

/**
 * 「ポートフォリオ」タブの出し分け（T-103）。`docs/02_design/ui/pages/portfolio-page.md`
 * §1「ログイン必須（user・admin）」。`/indicators` と同型でロール不問。
 */
describe('shouldShowPortfolioTab', () => {
  const asUser: AuthUser = { id: 1, email: 'user@example.com', role: 'user' };
  const asAdmin: AuthUser = { id: 2, email: 'admin@example.com', role: 'admin' };

  const cases: readonly (readonly [name: string, user: AuthUser | null, expected: boolean])[] = [
    ['guest（未ログイン） -> 非表示', null, false],
    ['一般ユーザー -> 表示', asUser, true],
    ['管理者 -> 表示', asAdmin, true],
  ];

  it.each(cases)('%s', (_name, user, expected) => {
    expect(shouldShowPortfolioTab(user)).toBe(expected);
  });
});

describe('NavBar.tsx: ポートフォリオタブへの導線（T-103・screen-list.md §4 の並び順）', () => {
  it('createPortfolioRoute() への NavLink が存在する', () => {
    expect(navBarSource).toMatch(
      /<NavLink[\s\S]*?to=\{createPortfolioRoute\(\)\}[\s\S]*?>\s*ポートフォリオ/,
    );
  });

  it('shouldShowPortfolioTab の判定でガードされている', () => {
    expect(navBarSource).toMatch(/\{shouldShowPortfolioTab\(user\) && \(/);
  });

  it('「検索」の直後・「評価基準」の直前に位置する（screen-list.md §4「検索・ポートフォリオ・指標カスタマイズ・評価基準・銘柄登録」）', () => {
    // ソース全文には `shouldShowPortfolioTab` の JSDoc（39行目付近）にも「ポートフォリオ」
    // という単語が登場するため、実際にレンダリングされる `<nav>`〜`</nav>` の JSX 部分だけを
    // 切り出してから並び順を検証する（JSDoc の文言はタブの表示順を左右しない）。
    const navMatch = navBarSource.match(/<nav[\s\S]*?<\/nav>/);
    expect(navMatch).not.toBeNull();
    const navJsx = navMatch![0];

    const searchIndex = navJsx.indexOf('検索');
    const portfolioIndex = navJsx.indexOf('ポートフォリオ');
    const criteriaIndex = navJsx.indexOf('評価基準');
    expect(searchIndex).toBeGreaterThan(-1);
    expect(portfolioIndex).toBeGreaterThan(searchIndex);
    expect(criteriaIndex).toBeGreaterThan(portfolioIndex);
  });
});
