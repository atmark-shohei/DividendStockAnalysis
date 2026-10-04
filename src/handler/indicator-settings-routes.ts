/**
 * 指標カスタマイズ設定の API（T-101）。**HTTP の入出力だけ。ロジックを書かない。**
 * 仕様: `docs/02_design/api/portfolio-api.md` §指標カスタマイズ。
 *
 * `registerAuthRoutes`（`auth-routes.ts`）と同じ「ルート登録関数」パターン。
 * `GET`/`PUT` とも `userOrAdmin`（`app.ts`）ミドルウェアで先にロール検証される
 * （`indicator-custom-page.md` §1「ログイン必須（user・admin ロール）」）。
 *
 * このコードベースは Hono の `Context` 変数（`c.set`/`c.get`）を使う前例が無いため、
 * ミドルウェアが検証したユーザーを引き継がず、ハンドラ側で `getCurrentUser` を
 * もう一度呼んでユーザーIDを取り直す（`requireRole` と同じ「失敗したら401」形。
 * `userOrAdmin` を通過済みなので通常は必ず成功する）。
 */

import { type Hono, type MiddlewareHandler } from 'hono';

import { type SessionRepository } from '../domain/auth/session-repository';
import { type UserRepository } from '../domain/auth/user-repository';
import { type UserIndicatorSettingsRepository } from '../domain/scoring/user-indicator-settings-repository';
import { getCurrentUser } from '../usecase/get-current-user';
import { getIndicatorSettings } from '../usecase/get-indicator-settings';
import { saveIndicatorSettings } from '../usecase/save-indicator-settings';
import { readSessionId } from './auth-cookie';
import {
  indicatorSettingsRequest,
  toIndicatorSettingsResponse,
  toSaveIndicatorSettingsErrorResponse,
} from './dto/indicator-settings';
import { toUnauthenticatedErrorResponse } from './dto/auth-input';

export interface IndicatorSettingsDependencies {
  readonly userRepository: UserRepository;
  readonly sessionRepository: SessionRepository;
  readonly userIndicatorSettingsRepository: UserIndicatorSettingsRepository;
  readonly now: () => Date;
}

/**
 * @param userOrAdmin `requireRole(['user', 'admin'])`（`app.ts` で組み立て）。
 *   `indicator-custom-page.md` §1「ログイン必須（user・admin ロール）」を先に検証する
 */
export function registerIndicatorSettingsRoutes(
  app: Hono,
  deps: IndicatorSettingsDependencies,
  userOrAdmin: MiddlewareHandler,
): void {
  app.get('/api/indicator-settings', userOrAdmin, async (context) => {
    const userResult = await getCurrentUser(deps, readSessionId(context), deps.now);
    if (!userResult.ok) {
      // `userOrAdmin` を通過していれば通常到達しない防御的分岐
      const { body, status } = toUnauthenticatedErrorResponse();
      return context.json(body, status);
    }

    const settings = await getIndicatorSettings(
      deps.userIndicatorSettingsRepository,
      userResult.value.id,
    );
    return context.json(toIndicatorSettingsResponse(settings));
  });

  app.put('/api/indicator-settings', userOrAdmin, async (context) => {
    const userResult = await getCurrentUser(deps, readSessionId(context), deps.now);
    if (!userResult.ok) {
      const { body, status } = toUnauthenticatedErrorResponse();
      return context.json(body, status);
    }

    const body: unknown = await context.req.json().catch(() => null);
    const parsed = indicatorSettingsRequest.safeParse(body);
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

    const result = await saveIndicatorSettings(
      deps.userIndicatorSettingsRepository,
      userResult.value.id,
      parsed.data,
    );
    if (!result.ok) {
      const { body: errorBody, status } = toSaveIndicatorSettingsErrorResponse(result.error);
      return context.json(errorBody, status);
    }

    return context.json(toIndicatorSettingsResponse(result.value));
  });
}
