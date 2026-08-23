/**
 * ポートフォリオ API（T-103）。**HTTP の入出力だけ。ロジックを書かない。**
 * 仕様: `docs/02_design/api/portfolio-api.md`。
 *
 * `registerIndicatorSettingsRoutes` と同じ「ルート登録関数」パターン。`userOrAdmin`
 * （`app.ts` で組み立て）ミドルウェアで先にロール検証される
 * （`screen-list.md:117-122`「user・admin どちらも閲覧・操作可」）。
 *
 * このコードベースは Hono の `Context` 変数（`c.set`/`c.get`）を使う前例が無いため、
 * ミドルウェアが検証したユーザーを引き継がず、ハンドラ側で `getCurrentUser` を
 * もう一度呼んでユーザーIDを取り直す（`indicator-settings-routes.ts` と同型）。
 */

import { type Hono, type MiddlewareHandler } from 'hono';

import { type SessionRepository } from '../domain/auth/session-repository';
import { type UserRepository } from '../domain/auth/user-repository';
import { type CompanyRepository } from '../domain/company/company-repository';
import { type PortfolioIdGenerator } from '../domain/portfolio/portfolio-id-generator';
import { type PortfolioRepository } from '../domain/portfolio/portfolio-repository';
import { addHolding } from '../usecase/add-holding';
import { createPortfolio } from '../usecase/create-portfolio';
import { deletePortfolio } from '../usecase/delete-portfolio';
import { getPortfolioDetail } from '../usecase/get-portfolio-detail';
import { listPortfolios } from '../usecase/list-portfolios';
import { removeHolding } from '../usecase/remove-holding';
import { updateHolding } from '../usecase/update-holding';
import { readSessionId } from './auth-cookie';
import { toUnauthenticatedErrorResponse } from './dto/auth-input';
import { COMPANY_CODE_PATTERN } from './dto/company-code';
import {
  addHoldingRequest,
  createPortfolioRequest,
  toAddHoldingErrorResponse,
  toCreatePortfolioErrorResponse,
  toHoldingResponse,
  toPortfolioDetailResponse,
  toPortfolioListResponse,
  toPortfolioNotFoundResponse,
  toPortfolioResponse,
  toUpdateHoldingErrorResponse,
  updateHoldingRequest,
} from './dto/portfolio';
import { getCurrentUser } from '../usecase/get-current-user';

export interface PortfolioDependencies {
  readonly userRepository: UserRepository;
  readonly sessionRepository: SessionRepository;
  readonly portfolioRepository: PortfolioRepository;
  readonly portfolioIdGenerator: PortfolioIdGenerator;
  readonly companyRepository: CompanyRepository;
  readonly now: () => Date;
}

function invalidBodyResponse(issues: readonly { path: readonly PropertyKey[]; message: string }[]) {
  return {
    error: '入力が不正です。項目を確認して再送信してください',
    issues: issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
  };
}

/**
 * @param userOrAdmin `requireRole(['user', 'admin'])`（`app.ts` で組み立て）
 */
export function registerPortfolioRoutes(
  app: Hono,
  deps: PortfolioDependencies,
  userOrAdmin: MiddlewareHandler,
): void {
  app.get('/api/portfolios', userOrAdmin, async (context) => {
    const userResult = await getCurrentUser(deps, readSessionId(context), deps.now);
    if (!userResult.ok) {
      const { body, status } = toUnauthenticatedErrorResponse();
      return context.json(body, status);
    }

    const result = await listPortfolios(deps.portfolioRepository, userResult.value.id);
    return context.json(toPortfolioListResponse(result));
  });

  app.post('/api/portfolios', userOrAdmin, async (context) => {
    const userResult = await getCurrentUser(deps, readSessionId(context), deps.now);
    if (!userResult.ok) {
      const { body, status } = toUnauthenticatedErrorResponse();
      return context.json(body, status);
    }

    const body: unknown = await context.req.json().catch(() => null);
    const parsed = createPortfolioRequest.safeParse(body);
    if (!parsed.success) {
      return context.json(invalidBodyResponse(parsed.error.issues), 400);
    }

    const result = await createPortfolio(
      { repository: deps.portfolioRepository, idGenerator: deps.portfolioIdGenerator },
      userResult.value.id,
      parsed.data.name,
      deps.now,
    );
    if (!result.ok) {
      const { body: errorBody, status } = toCreatePortfolioErrorResponse(result.error);
      return context.json(errorBody, status);
    }

    return context.json(toPortfolioResponse(result.value), 201);
  });

  app.delete('/api/portfolios/:id', userOrAdmin, async (context) => {
    const userResult = await getCurrentUser(deps, readSessionId(context), deps.now);
    if (!userResult.ok) {
      const { body, status } = toUnauthenticatedErrorResponse();
      return context.json(body, status);
    }

    const portfolioId = context.req.param('id');
    const result = await deletePortfolio(
      deps.portfolioRepository,
      userResult.value.id,
      portfolioId,
    );
    if (!result.ok) {
      const { body, status } = toPortfolioNotFoundResponse();
      return context.json(body, status);
    }
    return context.body(null, 204);
  });

  app.get('/api/portfolios/:id', userOrAdmin, async (context) => {
    const userResult = await getCurrentUser(deps, readSessionId(context), deps.now);
    if (!userResult.ok) {
      const { body, status } = toUnauthenticatedErrorResponse();
      return context.json(body, status);
    }

    const portfolioId = context.req.param('id');
    const detail = await getPortfolioDetail(
      deps.portfolioRepository,
      userResult.value.id,
      portfolioId,
    );
    if (detail === null) {
      const { body, status } = toPortfolioNotFoundResponse();
      return context.json(body, status);
    }
    return context.json(toPortfolioDetailResponse(detail));
  });

  app.post('/api/portfolios/:id/holdings', userOrAdmin, async (context) => {
    const userResult = await getCurrentUser(deps, readSessionId(context), deps.now);
    if (!userResult.ok) {
      const { body, status } = toUnauthenticatedErrorResponse();
      return context.json(body, status);
    }

    const body: unknown = await context.req.json().catch(() => null);
    const parsed = addHoldingRequest.safeParse(body);
    if (!parsed.success) {
      return context.json(invalidBodyResponse(parsed.error.issues), 400);
    }

    const portfolioId = context.req.param('id');
    const result = await addHolding(
      { portfolioRepository: deps.portfolioRepository, companyRepository: deps.companyRepository },
      userResult.value.id,
      portfolioId,
      parsed.data,
      deps.now,
    );
    if (!result.ok) {
      const { body: errorBody, status } = toAddHoldingErrorResponse(result.error);
      return context.json(errorBody, status);
    }

    return context.json(toHoldingResponse(result.value), 201);
  });

  app.patch('/api/portfolios/:id/holdings/:code', userOrAdmin, async (context) => {
    const userResult = await getCurrentUser(deps, readSessionId(context), deps.now);
    if (!userResult.ok) {
      const { body, status } = toUnauthenticatedErrorResponse();
      return context.json(body, status);
    }

    const code = context.req.param('code');
    if (!COMPANY_CODE_PATTERN.test(code)) {
      return context.json({ error: '銘柄コードの形式が不正です' }, 400);
    }

    const body: unknown = await context.req.json().catch(() => null);
    const parsed = updateHoldingRequest.safeParse(body);
    if (!parsed.success) {
      return context.json(invalidBodyResponse(parsed.error.issues), 400);
    }

    const portfolioId = context.req.param('id');
    const result = await updateHolding(
      deps.portfolioRepository,
      userResult.value.id,
      portfolioId,
      code,
      parsed.data,
      deps.now,
    );
    if (!result.ok) {
      const { body: errorBody, status } = toUpdateHoldingErrorResponse(result.error);
      return context.json(errorBody, status);
    }

    return context.json(toHoldingResponse(result.value));
  });

  app.delete('/api/portfolios/:id/holdings/:code', userOrAdmin, async (context) => {
    const userResult = await getCurrentUser(deps, readSessionId(context), deps.now);
    if (!userResult.ok) {
      const { body, status } = toUnauthenticatedErrorResponse();
      return context.json(body, status);
    }

    const code = context.req.param('code');
    if (!COMPANY_CODE_PATTERN.test(code)) {
      return context.json({ error: '銘柄コードの形式が不正です' }, 400);
    }

    const portfolioId = context.req.param('id');
    const result = await removeHolding(
      deps.portfolioRepository,
      userResult.value.id,
      portfolioId,
      code,
    );
    if (!result.ok) {
      const { body, status } = toPortfolioNotFoundResponse();
      return context.json(body, status);
    }
    return context.body(null, 204);
  });
}
