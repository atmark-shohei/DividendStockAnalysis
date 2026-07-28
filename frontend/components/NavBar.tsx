import { routeToPath, type Route } from '../routes';

/**
 * 2画面の切り替え。**本物の `<a href>` を使う**（`.claude/rules/frontend.md`:
 * 対話要素は `<button>` / `<a>`）。href があるので中クリックでの別タブ表示も効く。
 */

function NavLink({
  to,
  active,
  onNavigate,
  children,
}: {
  readonly to: Route;
  readonly active: boolean;
  readonly onNavigate: (route: Route) => void;
  readonly children: string;
}) {
  return (
    <a
      href={routeToPath(to)}
      aria-current={active ? 'page' : undefined}
      onClick={(event) => {
        // 修飾キー付きのクリックはブラウザ本来の動作（別タブ・別窓）に任せる
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        onNavigate(to);
      }}
    >
      {children}
    </a>
  );
}

export function NavBar({
  current,
  onNavigate,
}: {
  readonly current: Route;
  readonly onNavigate: (route: Route) => void;
}) {
  return (
    <nav className="nav" aria-label="画面切り替え">
      <NavLink
        to={{ kind: 'list', selectedCode: null }}
        active={current.kind === 'list'}
        onNavigate={onNavigate}
      >
        保存済み銘柄
      </NavLink>
      <NavLink to={{ kind: 'input' }} active={current.kind === 'input'} onNavigate={onNavigate}>
        データ入力
      </NavLink>
    </nav>
  );
}
