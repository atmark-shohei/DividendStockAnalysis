/**
 * Hono のルート定義。**HTTP の入出力だけ。ロジックを書かない。**
 *
 * ドメインエラーを HTTP ステータスへ変換するのはこの層の責務
 * （`.claude/CLAUDE.md`）。逆に、ドメインは HTTP を知らない。
 *
 * エラー応答に内部情報（SQL・スタックトレース・パス）を含めない
 * （`.claude/rules/backend.md`）。
 */

import { Hono } from 'hono';

import { type CompanyRepository } from '../domain/company/company-repository';
import { analyzeCompany } from '../usecase/analyze-company';
import { deleteCompany, getCompanyScoring, listCompanies } from '../usecase/read-companies';
import { analyzeCompanyRequest, toCompany, toScoringResponse } from './dto/company-input';
import { parsePriceInput } from './dto/price-input';

export interface AppDependencies {
  /** リポジトリは**インターフェースで**受け取る。D1 を直接は知らない */
  readonly repository: CompanyRepository;
  /** 現在時刻。テストから固定できるように注入する */
  readonly now: () => Date;
}

/**
 * 銘柄コードの形式。パスパラメータにも同じ検証をかける。
 *
 * 4文字固定。先頭3文字は数字、末尾1文字は数字または英大文字（例: `130A`）。
 * JPX が 2024 年以降に採番している英字混じりコードに対応する。
 */
const COMPANY_CODE_PATTERN = /^\d{3}[0-9A-Z]$/;

export function createApp(dependencies: AppDependencies): Hono {
  const app = new Hono();

  app.get('/api/health', (context) => context.json({ status: 'ok' }));

  /** 株価入力の検証だけを行う。画面が入力中に呼ぶ */
  app.post('/api/price/parse', async (context) => {
    const body: unknown = await context.req.json().catch(() => null);
    const raw = typeof body === 'object' && body !== null && 'raw' in body ? body.raw : null;
    if (typeof raw !== 'string') {
      return context.json({ error: 'raw は文字列で指定する' }, 400);
    }
    return context.json(parsePriceInput(raw));
  });

  app.get('/api/companies', async (context) => {
    const summaries = await listCompanies(dependencies.repository);
    return context.json({ companies: summaries });
  });

  app.post('/api/companies', async (context) => {
    const body: unknown = await context.req.json().catch(() => null);
    const parsed = analyzeCompanyRequest.safeParse(body);
    if (!parsed.success) {
      // zod の issue は「どの項目がなぜ駄目か」だけを返す。内部構造は出さない
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

    const fetchedAt = dependencies.now().toISOString();
    const company = toCompany(parsed.data, fetchedAt);
    const scoring = await analyzeCompany(dependencies.repository, company, dependencies.now);
    return context.json(toScoringResponse(scoring), 201);
  });

  app.get('/api/companies/:code', async (context) => {
    const code = context.req.param('code');
    if (!COMPANY_CODE_PATTERN.test(code)) {
      return context.json({ error: '銘柄コードの形式が不正です' }, 400);
    }

    const scoring = await getCompanyScoring(dependencies.repository, code);
    if (scoring === null) {
      return context.json({ error: '指定された銘柄は保存されていません' }, 404);
    }
    return context.json(toScoringResponse(scoring));
  });

  app.delete('/api/companies/:code', async (context) => {
    const code = context.req.param('code');
    if (!COMPANY_CODE_PATTERN.test(code)) {
      return context.json({ error: '銘柄コードの形式が不正です' }, 400);
    }
    await deleteCompany(dependencies.repository, code);
    return context.body(null, 204);
  });

  app.onError((error, context) => {
    // 外部要因の失敗とこちらのバグを区別するため、サーバー側にだけ詳細を出す
    console.error('unhandled error', error);
    return context.json(
      { error: 'サーバー側で処理できませんでした。時間をおいて再試行してください' },
      500,
    );
  });

  return app;
}
