import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  getCompany,
  getCurrentUser,
  importFromEdinet,
  listCompanies,
  login,
  logout,
  signup,
} from '../../frontend/api';

/**
 * `getCompany` のクエリパラメータ組み立て（③ 予想配当性向のソース切替。
 * `docs/02_design/logic/payout-ratio-scoring.md` §7）。
 *
 * **実 API は叩かない**（`.claude/rules/backend.md` と同じ方針を FE 側にも適用する）。
 * `fetch` はグローバルを差し替える（vitest 標準の `vi.stubGlobal`。新規ライブラリは
 * 追加しない）。`vitest.unit.config.ts` は `environment: 'node'` だが、Node 18+ の
 * `fetch` はグローバルに存在するため差し替え対象になる。
 *
 * `vi.fn<FetchImpl>` で引数の型を付ける（`tests/infra/yahoo/chart-client.test.ts` と
 * 同じパターン）。型を付けないと `mock.calls[0]?.[0]` の要素数がタプル `[]` に
 * 推論されて読めない。
 */
type FetchImpl = typeof globalThis.fetch;

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('getCompany', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('useActualForScoring を省略したらクエリを付けない（既定は予想優先）', async () => {
    const fetchMock = vi.fn<FetchImpl>(() => Promise.resolve(jsonResponse({})));
    vi.stubGlobal('fetch', fetchMock);

    await getCompany('7203');

    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/companies/7203');
  });

  it('useActualForScoring: true のときだけクエリを付ける', async () => {
    const fetchMock = vi.fn<FetchImpl>(() => Promise.resolve(jsonResponse({})));
    vi.stubGlobal('fetch', fetchMock);

    await getCompany('7203', true);

    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/companies/7203?useActualForScoring=true');
  });

  it('useActualForScoring: false は省略と同じくクエリを付けない', async () => {
    const fetchMock = vi.fn<FetchImpl>(() => Promise.resolve(jsonResponse({})));
    vi.stubGlobal('fetch', fetchMock);

    await getCompany('7203', false);

    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/companies/7203');
  });

  it('銘柄コードは URL エンコードする（クエリ有無に関わらず）', async () => {
    const fetchMock = vi.fn<FetchImpl>(() => Promise.resolve(jsonResponse({})));
    vi.stubGlobal('fetch', fetchMock);

    await getCompany('130A', true);

    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/companies/130A?useActualForScoring=true');
  });
});

/**
 * `listCompanies` のクエリ組み立て（T-094。`docs/02_design/api/company-api.md`
 * §GET /api/companies）。既定値省略パターンは `getCompany` と同じ。
 * **実 API は叩かない**（`getCompany` と同じ方針）。
 */
describe('listCompanies', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('引数省略時はクエリ無し', async () => {
    const fetchMock = vi.fn<FetchImpl>(() =>
      Promise.resolve(jsonResponse({ companies: [], page: 1, perPage: 15, total: 0 })),
    );
    vi.stubGlobal('fetch', fetchMock);

    await listCompanies();

    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/companies');
  });

  it('q だけ指定するとクエリに q だけ付く', async () => {
    const fetchMock = vi.fn<FetchImpl>(() =>
      Promise.resolve(jsonResponse({ companies: [], page: 1, perPage: 15, total: 0 })),
    );
    vi.stubGlobal('fetch', fetchMock);

    await listCompanies({ q: '7203' });

    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/companies?q=7203');
  });

  it('q が空文字ならクエリを付けない（絞り込まない扱い）', async () => {
    const fetchMock = vi.fn<FetchImpl>(() =>
      Promise.resolve(jsonResponse({ companies: [], page: 1, perPage: 15, total: 0 })),
    );
    vi.stubGlobal('fetch', fetchMock);

    await listCompanies({ q: '' });

    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/companies');
  });

  it('sort が既定値（created_desc）と同じならクエリを付けない', async () => {
    const fetchMock = vi.fn<FetchImpl>(() =>
      Promise.resolve(jsonResponse({ companies: [], page: 1, perPage: 15, total: 0 })),
    );
    vi.stubGlobal('fetch', fetchMock);

    await listCompanies({ sort: 'created_desc' });

    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/companies');
  });

  it('sort が既定値と異なればクエリに付く', async () => {
    const fetchMock = vi.fn<FetchImpl>(() =>
      Promise.resolve(jsonResponse({ companies: [], page: 1, perPage: 15, total: 0 })),
    );
    vi.stubGlobal('fetch', fetchMock);

    await listCompanies({ sort: 'score_desc' });

    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/companies?sort=score_desc');
  });

  it('page が 1（既定値）ならクエリを付けない', async () => {
    const fetchMock = vi.fn<FetchImpl>(() =>
      Promise.resolve(jsonResponse({ companies: [], page: 1, perPage: 15, total: 0 })),
    );
    vi.stubGlobal('fetch', fetchMock);

    await listCompanies({ page: 1 });

    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/companies');
  });

  it('page が 1 以外ならクエリに付く', async () => {
    const fetchMock = vi.fn<FetchImpl>(() =>
      Promise.resolve(jsonResponse({ companies: [], page: 2, perPage: 15, total: 30 })),
    );
    vi.stubGlobal('fetch', fetchMock);

    await listCompanies({ page: 2 });

    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/companies?page=2');
  });

  it('q・sort・page を複合指定できる', async () => {
    const fetchMock = vi.fn<FetchImpl>(() =>
      Promise.resolve(jsonResponse({ companies: [], page: 2, perPage: 15, total: 0 })),
    );
    vi.stubGlobal('fetch', fetchMock);

    await listCompanies({ q: 'トヨタ', sort: 'code_asc', page: 2 });

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      `/api/companies?q=${encodeURIComponent('トヨタ')}&sort=code_asc&page=2`,
    );
  });

  it('レスポンスの companies/page/perPage/total をそのまま透過する', async () => {
    const body = {
      companies: [
        {
          code: '9433',
          name: 'テスト商事',
          totalScore: 74,
          maxTotalScore: 100,
          effectiveMetricCount: 10,
          totalMetricCount: 10,
          fetchedAt: '2026-07-28T00:00:00.000Z',
          priceSen: 425000,
          dividendYieldValue: 318,
          payoutRatioValue: 32.4,
        },
      ],
      page: 1,
      perPage: 15,
      total: 1,
    };
    const fetchMock = vi.fn<FetchImpl>(() => Promise.resolve(jsonResponse(body)));
    vi.stubGlobal('fetch', fetchMock);

    await expect(listCompanies()).resolves.toEqual(body);
  });
});

/**
 * `importFromEdinet` のパス組み立て（fe-fix-plan.md CR-3）。
 * BE確定ルート（`src/handler/app.ts` の `GET /api/edinet/:code`）と一致することを
 * 固定する回帰テスト。**実 API は叩かない**（`getCompany` と同じ方針）。
 */
describe('importFromEdinet', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('/api/edinet/:code へ GET する', async () => {
    const fetchMock = vi.fn<FetchImpl>(() => Promise.resolve(jsonResponse({})));
    vi.stubGlobal('fetch', fetchMock);

    await importFromEdinet('7203');

    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/edinet/7203');
  });

  it('銘柄コードは URL エンコードする', async () => {
    const fetchMock = vi.fn<FetchImpl>(() => Promise.resolve(jsonResponse({})));
    vi.stubGlobal('fetch', fetchMock);

    await importFromEdinet('130A');

    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/edinet/130A');
  });
});

/**
 * 認証系（T-091 FE分）。契約は `docs/02_design/api/auth-api.md`。**実 API は叩かない**
 * （`getCompany` と同じ方針。`vi.stubGlobal('fetch', ...)`）。
 */
describe('signup', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('POST /api/auth/signup へ { email, password } を JSON で送る（confirm は含まれない）', async () => {
    const fetchMock = vi.fn<FetchImpl>(() =>
      Promise.resolve(jsonResponse({ user: { id: 1, email: 'a@b.com', role: 'admin' } })),
    );
    vi.stubGlobal('fetch', fetchMock);

    await signup({ email: 'a@b.com', password: '12345678' });

    const [input, init] = fetchMock.mock.calls[0] ?? [];
    expect(input).toBe('/api/auth/signup');
    expect(init?.method).toBe('POST');
    const body: unknown = JSON.parse(init?.body as string);
    expect(body).toEqual({ email: 'a@b.com', password: '12345678' });
    // password confirm はサーバーへ送らない（auth-api.md §POST /api/auth/signup）
    expect(body).not.toHaveProperty('confirmPassword');
  });
});

describe('login', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('POST /api/auth/login へ { email, password } を送る', async () => {
    const fetchMock = vi.fn<FetchImpl>(() =>
      Promise.resolve(jsonResponse({ user: { id: 1, email: 'a@b.com', role: 'user' } })),
    );
    vi.stubGlobal('fetch', fetchMock);

    await login({ email: 'a@b.com', password: 'x' });

    const [input, init] = fetchMock.mock.calls[0] ?? [];
    expect(input).toBe('/api/auth/login');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(init?.body as string)).toEqual({ email: 'a@b.com', password: 'x' });
  });
});

describe('logout', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('204（本文なし）で解決する。本文パースに失敗しても例外にならない', async () => {
    const fetchMock = vi.fn<FetchImpl>(() => Promise.resolve(new Response(null, { status: 204 })));
    vi.stubGlobal('fetch', fetchMock);

    await expect(logout()).resolves.toBeUndefined();
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/auth/logout');
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe('POST');
  });

  it('非200系（500等）で例外を投げる', async () => {
    const fetchMock = vi.fn<FetchImpl>(() => Promise.resolve(new Response(null, { status: 500 })));
    vi.stubGlobal('fetch', fetchMock);

    await expect(logout()).rejects.toThrow('ログアウトに失敗しました');
  });
});

describe('getCurrentUser', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('200 で user を返す', async () => {
    const fetchMock = vi.fn<FetchImpl>(() =>
      Promise.resolve(jsonResponse({ user: { id: 1, email: 'a@b.com', role: 'admin' } })),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(getCurrentUser()).resolves.toEqual({ id: 1, email: 'a@b.com', role: 'admin' });
  });

  it('401 は例外を投げず null を返す（ゲスト状態。最重要ケース）', async () => {
    const fetchMock = vi.fn<FetchImpl>(() =>
      Promise.resolve(
        new Response(JSON.stringify({ error: 'ログインが必要です' }), { status: 401 }),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(getCurrentUser()).resolves.toBeNull();
  });

  it('500 は例外を投げる（.error があればその文言）', async () => {
    const fetchMock = vi.fn<FetchImpl>(() =>
      Promise.resolve(
        new Response(JSON.stringify({ error: 'サーバーエラーです' }), { status: 500 }),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(getCurrentUser()).rejects.toThrow('サーバーエラーです');
  });

  it('500 で本文が無い/読めない場合は既定文言で例外を投げる', async () => {
    const fetchMock = vi.fn<FetchImpl>(() => Promise.resolve(new Response(null, { status: 500 })));
    vi.stubGlobal('fetch', fetchMock);

    await expect(getCurrentUser()).rejects.toThrow('ログイン状態の確認に失敗しました');
  });
});
