/**
 * Worker のエントリ。**DI の組み立てだけを行う。**
 *
 * `D1Database` などの Cloudflare 固有の型が現れてよいのは
 * `src/infra/` とこのファイルだけ（`.claude/CLAUDE.md`）。
 */

import { createApp } from './handler/app';
import { WebCryptoPasswordHasher } from './infra/auth/webcrypto-password-hasher';
import { WebCryptoSessionTokenGenerator } from './infra/auth/webcrypto-session-token-generator';
import { D1CompanyRepository } from './infra/d1/company-repository';
import { D1EdinetDocumentIndexRepository } from './infra/d1/edinet-document-index-repository';
import { D1EdinetDocumentSummaryCacheRepository } from './infra/d1/edinet-document-summary-cache-repository';
import { D1SessionRepository } from './infra/d1/session-repository';
import { D1UserRepository } from './infra/d1/user-repository';
import { EdinetClient } from './infra/edinet/edinet-client';
import { IrBankFinancialSource } from './infra/irbank/fy-data-client';
import { YahooChartMarketDataSource } from './infra/yahoo/chart-client';
import { refreshEdinetDocumentIndex } from './usecase/refresh-edinet-document-index';

/**
 * バインディングの型は `wrangler types` が `worker-configuration.d.ts` に生成する。
 * **手で書かない。** `wrangler.jsonc` を変えたら `npm run cf-typegen` で作り直す。
 */
/**
 * 管理用エンドポイントの共有シークレット。**未設定なら管理APIは無効**（handler が 503 を返す）。
 *
 * 本番は `wrangler secret put EDINET_ADMIN_TOKEN`、ローカルは `.dev.vars` で設定する。
 * `.dev.vars` に足して `npm run cf-typegen` を回せば `Env` に生えるので、
 * そのときこの絞り込みは消してよい。
 */
function adminTokenOf(env: Env): string | undefined {
  const value = (env as unknown as Record<string, unknown>)['EDINET_ADMIN_TOKEN'];
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/**
 * サインアップ受付設定。**未設定なら安全側（受付停止）に倒す**
 * （T-091計画 §10 確認事項4・Manager承認）。
 *
 * `SIGNUP_ENABLED`/`SIGNUP_MAX_USERS` は秘密情報ではないので `wrangler.jsonc` の
 * `vars` で管理する（`EDINET_ADMIN_TOKEN` のような secret とは違う）。
 */
function signupConfigOf(env: Env): { readonly enabled: boolean; readonly maxUsers: number } {
  const enabled = env.SIGNUP_ENABLED === 'true';
  const rawMaxUsers = env.SIGNUP_MAX_USERS;
  const maxUsers = typeof rawMaxUsers === 'string' ? Number.parseInt(rawMaxUsers, 10) : 0;
  return { enabled, maxUsers: Number.isFinite(maxUsers) ? maxUsers : 0 };
}

/**
 * Cookie の `Secure` 属性。**未設定なら安全側（true）に倒す**（CR-4）。
 * ローカル http での手動確認だけ `.dev.vars` に `COOKIE_SECURE=false` を明示する。
 */
function cookieSecureOf(env: Env): boolean {
  // `String()` で明示的に string へ広げる。`wrangler.jsonc` に単一の値しか書かれていない間は
  // `wrangler types` が `COOKIE_SECURE` を `"true"` というリテラル型に絞り込むため、
  // `!== 'false'` の比較がリテラル型どうしの「常に true」判定として型エラーになる（実装時に実測）。
  return String(env.COOKIE_SECURE) !== 'false';
}

export default {
  async fetch(request: Request, env: Env, context: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // API 以外は静的アセット（React アプリ）へ渡す。
    // Assets が無い環境（テスト等）では 404 を返す
    if (!url.pathname.startsWith('/api/')) {
      if (env.ASSETS === undefined) return new Response('Not Found', { status: 404 });
      return env.ASSETS.fetch(request);
    }

    const edinetDocumentIndexRepository = new D1EdinetDocumentIndexRepository(env.DB);
    const edinetSummaryCacheRepository = new D1EdinetDocumentSummaryCacheRepository(env.DB);
    const signup = signupConfigOf(env);
    const app = createApp({
      repository: new D1CompanyRepository(env.DB),
      financialSource: new IrBankFinancialSource(),
      marketDataSource: new YahooChartMarketDataSource(),
      edinetHistorySource: new EdinetClient({
        apiKey: env.EDINET_API_KEY,
        summaryCache: edinetSummaryCacheRepository,
      }),
      edinetDocumentIndexLookup: edinetDocumentIndexRepository,
      userRepository: new D1UserRepository(env.DB),
      sessionRepository: new D1SessionRepository(env.DB),
      passwordHasher: new WebCryptoPasswordHasher(),
      sessionTokenGenerator: new WebCryptoSessionTokenGenerator(),
      signupEnabled: signup.enabled,
      maxUsers: signup.maxUsers,
      cookieSecure: cookieSecureOf(env),
      now: () => new Date(),
      edinetIndexAdmin: {
        documentsListSource: new EdinetClient({ apiKey: env.EDINET_API_KEY }),
        indexRepository: edinetDocumentIndexRepository,
        token: adminTokenOf(env),
      },
      edinetSummaryCacheAdmin: {
        repository: edinetSummaryCacheRepository,
        token: adminTokenOf(env),
      },
    });

    return app.fetch(request, env, context);
  },

  /**
   * EDINET docIDインデックスの日次バッチ（`wrangler.jsonc` の `triggers.crons`）。
   *
   * `event.scheduledTime`（epoch ms）を使う。`Date.now()` を直接使うとテストで
   * 固定できないため、event 由来の時刻を渡す（Yahoo/IRバンクの `now()` 注入と同じ思想）。
   */
  async scheduled(event: ScheduledEvent, env: Env): Promise<void> {
    const result = await refreshEdinetDocumentIndex({
      documentsListSource: new EdinetClient({ apiKey: env.EDINET_API_KEY }),
      indexRepository: new D1EdinetDocumentIndexRepository(env.DB),
      companyRepository: new D1CompanyRepository(env.DB),
      now: () => new Date(event.scheduledTime),
    });

    if (!result.ok) {
      // 例外を投げない。ログにだけ残し、次回のCronに任せる（設計書 §8-5 が明示的に
      // 未決としている挙動。アラート通知は別途実装が要る）
      console.error('edinet document index refresh failed', result.error.kind);
    }
  },
};
