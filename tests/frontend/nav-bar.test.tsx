import { describe, expect, it } from 'vitest';

// `@testing-library/react` は導入していないので JSX は書かない（`auth-form.test.tsx` と同じ方針）。
// コンポーネントから切り出した純粋関数だけをテストする。
import { shouldShowInputTab } from '../../frontend/components/NavBar';
import type { AuthUser } from '../../frontend/api';

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
