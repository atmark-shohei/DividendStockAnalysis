import type { AuthUser } from '../api';
import { routeToPath, type Route } from '../routes';
import { RoleBadge } from './RoleBadge';

/**
 * ヘッダー右側の認証エリア（`docs/02_design/ui/screen-list.md` §2・§4）。
 *
 * - 未ログイン: 「ログイン」リンク。`redirect` に**現在のパス**を積む（同 §5.1）
 * - ログイン済み: メールアドレス＋（`role === 'admin'` なら）`<RoleBadge>`＋「ログアウト」
 *
 * 対話要素は `<button>`/`<a>`（`.claude/rules/frontend.md`）。ログインリンクは
 * `NavBar` の `NavLink` と同じ `<a href>` + `preventDefault` + `navigate` パターン。
 */
export function AuthStatus({
  user,
  currentPath,
  onNavigate,
  onLogout,
}: {
  readonly user: AuthUser | null;
  readonly currentPath: string;
  readonly onNavigate: (route: Route) => void;
  readonly onLogout: () => void;
}) {
  if (user === null) {
    const loginRoute: Route = { kind: 'login', redirect: currentPath };
    return (
      <div className="auth-status">
        <a
          href={routeToPath(loginRoute)}
          onClick={(event) => {
            if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            event.preventDefault();
            onNavigate(loginRoute);
          }}
        >
          ログイン
        </a>
      </div>
    );
  }

  return (
    <div className="auth-status">
      <span>{user.email}</span>
      {user.role === 'admin' && <RoleBadge role="admin" />}
      <button type="button" onClick={onLogout}>
        ログアウト
      </button>
    </div>
  );
}
