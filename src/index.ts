/**
 * Worker のエントリ。**DI の組み立てだけを行う。**
 *
 * `D1Database` などの Cloudflare 固有の型が現れてよいのは
 * `src/infra/` とこのファイルだけ（`.claude/CLAUDE.md`）。
 */

import { createApp } from './handler/app';
import { D1CompanyRepository } from './infra/d1/company-repository';

/**
 * バインディングの型は `wrangler types` が `worker-configuration.d.ts` に生成する。
 * **手で書かない。** `wrangler.jsonc` を変えたら `npm run cf-typegen` で作り直す。
 */
export default {
  async fetch(request: Request, env: Env, context: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // API 以外は静的アセット（React アプリ）へ渡す。
    // Assets が無い環境（テスト等）では 404 を返す
    if (!url.pathname.startsWith('/api/')) {
      if (env.ASSETS === undefined) return new Response('Not Found', { status: 404 });
      return env.ASSETS.fetch(request);
    }

    const app = createApp({
      repository: new D1CompanyRepository(env.DB),
      now: () => new Date(),
    });

    return app.fetch(request, env, context);
  },
};
