import { AuthForm, type AuthFormPayload } from '../components/AuthForm';
import { routeToPath, type Route } from '../routes';

/**
 * ログイン/アカウント作成画面（`/login` `/signup`）。**薄いラッパー。**
 * データ取得・通信はしない（`App.tsx` から渡される props をそのまま `AuthForm` へ流す）。
 *
 * セグメント切替（`/login` ⇄ `/signup`）はここで持つ（`routes.ts`/`navigate` を知る必要が
 * あるため。`AuthForm` 自体は通信もルーティングも知らない）。
 * `docs/02_design/ui/pages/login-page.md` §1「1つのコンポーネント・2つのURL」:
 * セグメントのクリックは内部 state のトグルではなく実際のページ遷移にする。
 */

function AuthTab({
  label,
  to,
  active,
  onNavigate,
}: {
  readonly label: string;
  readonly to: Route;
  readonly active: boolean;
  readonly onNavigate: (route: Route) => void;
}) {
  return (
    <a
      href={routeToPath(to)}
      aria-current={active ? 'page' : undefined}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        onNavigate(to);
      }}
    >
      {label}
    </a>
  );
}

export function AuthPage({
  mode,
  redirect,
  busy,
  error,
  onNavigate,
  onLogin,
  onSignup,
}: {
  readonly mode: 'login' | 'signup';
  /** `sanitizeRedirect` 済みの安全な相対パス（`App.tsx` の `route.redirect`） */
  readonly redirect: string;
  readonly busy: boolean;
  readonly error: string | null;
  readonly onNavigate: (route: Route) => void;
  readonly onLogin: (payload: AuthFormPayload, redirect: string) => void;
  readonly onSignup: (payload: AuthFormPayload, redirect: string) => void;
}) {
  return (
    <section className="auth-card">
      <nav className="auth-tabs" aria-label="ログイン・アカウント作成の切り替え">
        <AuthTab
          label="ログイン"
          to={{ kind: 'login', redirect }}
          active={mode === 'login'}
          onNavigate={onNavigate}
        />
        <AuthTab
          label="アカウント作成"
          to={{ kind: 'signup', redirect }}
          active={mode === 'signup'}
          onNavigate={onNavigate}
        />
      </nav>
      <AuthForm
        mode={mode}
        redirect={redirect}
        busy={busy}
        error={error}
        onLogin={onLogin}
        onSignup={onSignup}
      />
      <p className="auth-footnote">
        パスワードはハッシュ化して保存され、平文では保持されません。
        ログインしなくても銘柄の検索は利用できます。
      </p>
    </section>
  );
}
