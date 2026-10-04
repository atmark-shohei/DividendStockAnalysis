/**
 * 認証系 API のルート定義。**HTTP の入出力だけ。ロジックを書かない。**
 * 仕様: `docs/02_design/api/auth-api.md`。
 */

import { type Hono } from 'hono';

import { type PasswordHasher } from '../domain/auth/password-hasher';
import { type SessionRepository } from '../domain/auth/session-repository';
import { type SessionTokenGenerator } from '../domain/auth/session-token-generator';
import { type UserRepository } from '../domain/auth/user-repository';
import { getCurrentUser } from '../usecase/get-current-user';
import { login } from '../usecase/login';
import { logout } from '../usecase/logout';
import { signup } from '../usecase/signup';
import { clearSessionCookie, readSessionId, setSessionCookie } from './auth-cookie';
import {
  loginRequest,
  signupRequest,
  toLoginErrorResponse,
  toSignupErrorResponse,
  toUnauthenticatedErrorResponse,
  toUserView,
} from './dto/auth-input';

export interface AuthDependencies {
  readonly userRepository: UserRepository;
  readonly sessionRepository: SessionRepository;
  readonly passwordHasher: PasswordHasher;
  readonly sessionTokenGenerator: SessionTokenGenerator;
  readonly signupEnabled: boolean;
  readonly maxUsers: number;
  /** Cookie の `Secure` 属性。未設定時は呼び出し側（`src/index.ts`）が安全側（true）に倒す */
  readonly cookieSecure: boolean;
  readonly now: () => Date;
}

export function registerAuthRoutes(app: Hono, deps: AuthDependencies): void {
  app.post('/api/auth/signup', async (context) => {
    const body: unknown = await context.req.json().catch(() => null);
    const parsed = signupRequest.safeParse(body);
    if (!parsed.success) {
      return context.json(
        {
          error: '入力が不正です。項目を確認して再送信してください',
          issues: parsed.error.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
        },
        400,
      );
    }

    const result = await signup(deps, parsed.data.email, parsed.data.password, deps.now);
    if (!result.ok) {
      const { body: errorBody, status } = toSignupErrorResponse(result.error);
      return context.json(errorBody, status);
    }

    setSessionCookie(context, result.value.session, { secure: deps.cookieSecure });
    return context.json({ user: toUserView(result.value.user) }, 201);
  });

  app.post('/api/auth/login', async (context) => {
    const body: unknown = await context.req.json().catch(() => null);
    const parsed = loginRequest.safeParse(body);
    if (!parsed.success) {
      return context.json(
        {
          error: '入力が不正です。項目を確認して再送信してください',
          issues: parsed.error.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
        },
        400,
      );
    }

    const result = await login(deps, parsed.data.email, parsed.data.password, deps.now);
    if (!result.ok) {
      const { body: errorBody, status } = toLoginErrorResponse(result.error);
      return context.json(errorBody, status);
    }

    setSessionCookie(context, result.value.session, { secure: deps.cookieSecure });
    return context.json({ user: toUserView(result.value.user) }, 200);
  });

  app.post('/api/auth/logout', async (context) => {
    await logout(deps.sessionRepository, readSessionId(context));
    clearSessionCookie(context);
    return context.body(null, 204);
  });

  app.get('/api/auth/me', async (context) => {
    const result = await getCurrentUser(deps, readSessionId(context), deps.now);
    if (!result.ok) {
      const { body, status } = toUnauthenticatedErrorResponse();
      return context.json(body, status);
    }
    return context.json({ user: toUserView(result.value) }, 200);
  });
}
