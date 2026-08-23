import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

import { type EdinetDocumentIndexLookup } from '@/domain/company/edinet-document-index';
import { type EdinetHistorySource } from '@/domain/company/edinet-history-source';
import { type FinancialSource } from '@/domain/company/financial-source';
import { type MarketDataSource } from '@/domain/company/market-data-source';
import { createApp } from '@/handler/app';
import { WebCryptoPasswordHasher } from '@/infra/auth/webcrypto-password-hasher';
import { WebCryptoSessionTokenGenerator } from '@/infra/auth/webcrypto-session-token-generator';
import { D1CompanyRepository } from '@/infra/d1/company-repository';
import { D1PortfolioRepository } from '@/infra/d1/portfolio-repository';
import { D1SessionRepository } from '@/infra/d1/session-repository';
import { D1UserIndicatorSettingsRepository } from '@/infra/d1/user-indicator-settings-repository';
import { D1UserRepository } from '@/infra/d1/user-repository';
import { WebCryptoPortfolioIdGenerator } from '@/infra/portfolio/webcrypto-portfolio-id-generator';

/**
 * `signup → me → logout → me(401)` を実 D1・実 WebCrypto 経由で通しに検証する
 * （BEレビュー CR-1）。フェイクは使わない。
 *
 * `tests/handler/auth-routes.test.ts` はフェイクリポジトリのまま zod 境界値・文言を検証する。
 * こちらは層をまたいだ結線（handler → usecase → domain ← infra）が壊れていないかを見る。
 */

const FIXED_NOW = new Date('2026-08-18T00:00:00.000Z');

/** このテストファイルは IRバンク取り込みを対象にしないので、呼ばれたら落とす */
const unusedFinancialSource: FinancialSource = {
  fetchByCode: () => {
    throw new Error('このテストで FinancialSource が呼ばれるのは想定外');
  },
};

/** このテストファイルは Yahoo 取り込みを対象にしないので、呼ばれたら落とす */
const unusedMarketDataSource: MarketDataSource = {
  fetchByCode: () => {
    throw new Error('このテストで MarketDataSource が呼ばれるのは想定外');
  },
};

/** このテストファイルは EDINET 取り込みを対象にしないので、呼ばれたら落とす */
const unusedEdinetHistorySource: EdinetHistorySource = {
  fetchHistory: () => {
    throw new Error('このテストで EdinetHistorySource が呼ばれるのは想定外');
  },
};

const unusedEdinetDocumentIndexLookup: EdinetDocumentIndexLookup = {
  findDocId: () => {
    throw new Error('このテストで EdinetDocumentIndexLookup が呼ばれるのは想定外');
  },
  findLatest: () => {
    throw new Error('このテストで EdinetDocumentIndexLookup が呼ばれるのは想定外');
  },
};

function app() {
  return createApp({
    repository: new D1CompanyRepository(env.DB),
    userIndicatorSettingsRepository: new D1UserIndicatorSettingsRepository(env.DB),
    portfolioRepository: new D1PortfolioRepository(env.DB),
    portfolioIdGenerator: new WebCryptoPortfolioIdGenerator(),
    financialSource: unusedFinancialSource,
    marketDataSource: unusedMarketDataSource,
    edinetHistorySource: unusedEdinetHistorySource,
    edinetDocumentIndexLookup: unusedEdinetDocumentIndexLookup,
    userRepository: new D1UserRepository(env.DB),
    sessionRepository: new D1SessionRepository(env.DB),
    passwordHasher: new WebCryptoPasswordHasher(),
    sessionTokenGenerator: new WebCryptoSessionTokenGenerator(),
    signupEnabled: true,
    maxUsers: 5,
    cookieSecure: true,
    now: () => FIXED_NOW,
  });
}

beforeEach(async () => {
  await env.DB.exec('DELETE FROM sessions');
  await env.DB.exec('DELETE FROM users');
});

function extractSessionCookie(response: Response): string {
  const setCookie = response.headers.get('set-cookie');
  expect(setCookie).toBeTruthy();
  const match = setCookie?.match(/session_id=[^;]+/);
  expect(match).not.toBeNull();
  return match![0];
}

describe('認証フロー: signup → me → logout → me(401)', () => {
  it('一連の流れを実 D1・実 WebCrypto 経由で通しで検証する', async () => {
    // 1. signup → 201 + Set-Cookie
    const signupResponse = await app().request('/api/auth/signup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'flow@example.com', password: 'correct-horse-battery' }),
    });
    expect(signupResponse.status).toBe(201);
    const cookie = extractSessionCookie(signupResponse);

    // 2. me → 200、登録したメールが返る
    const meAfterSignup = await app().request('/api/auth/me', { headers: { cookie } });
    expect(meAfterSignup.status).toBe(200);
    const meBody = (await meAfterSignup.json()) as { user: { email: string; role: string } };
    expect(meBody.user.email).toBe('flow@example.com');
    // 最初の登録者は admin（roleForNewSignup。ADR-0013 §決定2）
    expect(meBody.user.role).toBe('admin');

    // 3. logout → 204
    const logoutResponse = await app().request('/api/auth/logout', {
      method: 'POST',
      headers: { cookie },
    });
    expect(logoutResponse.status).toBe(204);

    // 4. logout後の me → 401（セッションが実際に破棄されている）
    const meAfterLogout = await app().request('/api/auth/me', { headers: { cookie } });
    expect(meAfterLogout.status).toBe(401);
  });

  it('存在しないメールでログイン → 401（ダミー verify が例外にならない。CR-2 の検出経路）', async () => {
    const response = await app().request('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'nobody@example.com', password: 'whatever-password' }),
    });
    // 500 になっていないこと（fromHex が非16進文字列で壊れていないか）を最優先で確認
    expect(response.status).toBe(401);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe('メールアドレスまたはパスワードが正しくありません');
  });
});
