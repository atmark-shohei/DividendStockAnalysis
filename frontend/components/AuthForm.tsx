import { useState } from 'react';

/**
 * ログイン/アカウント作成フォーム本体。
 *
 * `docs/02_design/ui/pages/login-page.md` §4「1つのコンポーネント・2つのURL」に従い、
 * `mode` prop で1コンポーネントを出し分ける（`LoginPage`/`SignupPage` の2ファイルには分けない）。
 * セグメント切替（`/login` ⇄ `/signup`）は `AuthPage` 側が担当する（`routes.ts`/`navigate` を
 * 知る必要があるため）。このファイルは通信を知らない（`onLogin`/`onSignup` を呼ぶだけ）。
 *
 * バリデーション関数は `CompanyForm.tsx` の `toHalfWidth`/`yenToSen` と同じ流儀で
 * 純関数として export し、`@testing-library/react` 無しでもテストできるようにする
 * （`tests/frontend/auth-form.test.tsx`）。
 */

/** メールアドレスの形式チェック。RFC完全準拠は狙わない（サーバー側が最終検証する） */
const EMAIL_FORMAT = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * メールアドレスの形式チェック。**全角→半角正規化はしない**
 * （`.claude/rules/frontend.md` の一般則から意図的に外れる。
 * `docs/02_design/ui/pages/login-page.md` §4 に明記された決定）。
 */
export function isValidEmailFormat(email: string): boolean {
  return EMAIL_FORMAT.test(email);
}

/**
 * アカウント作成時のパスワード長の下限・上限。
 * `docs/02_design/api/auth-api.md` §POST /api/auth/signup、
 * `src/handler/dto/auth-input.ts` の zod `.min(8, ...).max(128, ...)` と値を揃える
 * （BE・FE 間で値を型として共有する仕組みは無いため、変更時は両方を手で同期する必要がある。
 * CR-6 指摘、完全な共有化は別途検討）。
 */
export const MIN_SIGNUP_PASSWORD_LENGTH = 8;
export const MAX_SIGNUP_PASSWORD_LENGTH = 128;

export function isValidSignupPasswordLength(password: string): boolean {
  return (
    password.length >= MIN_SIGNUP_PASSWORD_LENGTH && password.length <= MAX_SIGNUP_PASSWORD_LENGTH
  );
}

/** ログイン時は下限を課さない（既存アカウントの古いパスワードを弾かないため。同 §4） */
export function isNonEmptyPassword(password: string): boolean {
  return password.length > 0;
}

export function passwordsMatch(password: string, confirmPassword: string): boolean {
  return password === confirmPassword;
}

/** 送信ボタンを押せるか。「7文字以下は送信前にブロック」をここで実現する（同 §8受入基準） */
export function canSubmitAuthForm(
  mode: 'login' | 'signup',
  fields: { readonly email: string; readonly password: string; readonly confirmPassword: string },
): boolean {
  if (!isValidEmailFormat(fields.email)) return false;
  if (mode === 'login') return isNonEmptyPassword(fields.password);
  return (
    isValidSignupPasswordLength(fields.password) &&
    passwordsMatch(fields.password, fields.confirmPassword)
  );
}

/** 確認欄のインライン不一致メッセージ。未入力のうちは無警告にする（送信前にブロックする側の表示用） */
export function confirmPasswordErrorText(password: string, confirmPassword: string): string | null {
  if (confirmPassword === '' || passwordsMatch(password, confirmPassword)) return null;
  return 'パスワードが一致しません';
}

export interface AuthFormPayload {
  readonly email: string;
  readonly password: string;
}

export interface AuthFormProps {
  readonly mode: 'login' | 'signup';
  /** 現在の `redirect`（成功後の遷移先）。送信時にそのまま呼び出し元へ渡すだけで、ここでは使わない */
  readonly redirect: string;
  /** 通信中。送信ボタンを disabled にする（二重送信防止。`CompanyForm` の `importing` と同型） */
  readonly busy: boolean;
  /** サーバーから返った文言、またはクライアント検証エラー。`reasonText` のような変換はしない
   * （`auth-api.md` は文言そのものを返す設計のため、FE側の変換テーブルは二重管理になる） */
  readonly error: string | null;
  readonly onLogin: (payload: AuthFormPayload, redirect: string) => void;
  readonly onSignup: (payload: AuthFormPayload, redirect: string) => void;
}

export function AuthForm({ mode, redirect, busy, error, onLogin, onSignup }: AuthFormProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const confirmError =
    mode === 'signup' ? confirmPasswordErrorText(password, confirmPassword) : null;
  const canSubmit = !busy && canSubmitAuthForm(mode, { email, password, confirmPassword });

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmitAuthForm(mode, { email, password, confirmPassword })) return;
    if (mode === 'login') {
      onLogin({ email, password }, redirect);
    } else {
      onSignup({ email, password }, redirect);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <label>
        メールアドレス
        <input
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          autoComplete="email"
          required
        />
      </label>
      <label>
        パスワード
        <input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
          required
        />
      </label>
      {mode === 'signup' && (
        <label>
          パスワード（確認）
          <input
            type="password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            autoComplete="new-password"
            aria-invalid={confirmError !== null}
            required
          />
          {confirmError !== null && (
            <span className="warning" role="alert">
              {confirmError}
            </span>
          )}
        </label>
      )}
      <button type="submit" disabled={!canSubmit}>
        {mode === 'login' ? 'ログイン' : 'アカウント作成'}
      </button>
      {error !== null && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
