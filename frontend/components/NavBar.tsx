import type { AuthUser } from '../api';
import { createListRoute, createPortfolioRoute, isAdmin, routeToPath, type Route } from '../routes';

/**
 * 2画面の切り替え。**本物の `<a href>` を使う**（`.claude/rules/frontend.md`:
 * 対話要素は `<button>` / `<a>`）。href があるので中クリックでの別タブ表示も効く。
 */

/**
 * 「銘柄登録」タブを表示するか（`docs/02_design/ui/screen-list.md` §2。admin のみ）。
 *
 * **タブを隠すことは認可ではない。** 実効的な制限は BE 側の `requireRole('admin')`
 * （`src/handler/require-role.ts`）が別途必要。T-091で `POST/DELETE /api/companies` へ
 * 配線済み（`.claude/rules/frontend.md`）。
 * guest 判定は常に `user === null`（`Role` 型に `'guest'` は無い）。
 */
export function shouldShowInputTab(user: AuthUser | null): boolean {
  return isAdmin(user);
}

/**
 * 「指標カスタマイズ」タブを表示するか（`docs/02_design/ui/screen-list.md` §2。
 * `/input` と異なりロール不問。ログイン済みなら user/admin どちらにも表示する）。
 * guest（`user === null`）には表示しない（`indicator-custom-page.md` §1「ログイン必須」）。
 */
export function shouldShowIndicatorsTab(user: AuthUser | null): boolean {
  return user !== null;
}

/**
 * 「ポートフォリオ」タブを表示するか（T-103。`portfolio-page.md` §1「ログイン必須
 * （user・admin）」）。`shouldShowIndicatorsTab` と同型（ロール不問・guest は非表示）。
 */
export function shouldShowPortfolioTab(user: AuthUser | null): boolean {
  return user !== null;
}

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
  user,
  onNavigate,
}: {
  readonly current: Route;
  readonly user: AuthUser | null;
  readonly onNavigate: (route: Route) => void;
}) {
  return (
    <nav className="nav" aria-label="画面切り替え">
      <NavLink to={createListRoute()} active={current.kind === 'list'} onNavigate={onNavigate}>
        検索
      </NavLink>
      {/* 並び順は screen-list.md §4「検索・ポートフォリオ・指標カスタマイズ・評価基準・銘柄登録」。
          T-103でポートフォリオタブを本来の位置（検索の直後・評価基準の直前）へ追加した。
          評価基準⇄指標カスタマイズの順序自体が完成形と食い違っている件は本タスクのスコープ外
          （fe-plan.md §1 確認事項E、Manager確認済み） */}
      {shouldShowPortfolioTab(user) && (
        <NavLink
          to={createPortfolioRoute()}
          active={current.kind === 'portfolio'}
          onNavigate={onNavigate}
        >
          ポートフォリオ
        </NavLink>
      )}
      <NavLink to={{ kind: 'criteria' }} active={current.kind === 'criteria'} onNavigate={onNavigate}>
        評価基準
      </NavLink>
      {shouldShowIndicatorsTab(user) && (
        <NavLink
          to={{ kind: 'indicators' }}
          active={current.kind === 'indicators'}
          onNavigate={onNavigate}
        >
          指標カスタマイズ
        </NavLink>
      )}
      {shouldShowInputTab(user) && (
        <NavLink to={{ kind: 'input' }} active={current.kind === 'input'} onNavigate={onNavigate}>
          銘柄登録
        </NavLink>
      )}
    </nav>
  );
}
