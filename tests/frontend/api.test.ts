import { afterEach, describe, expect, it, vi } from 'vitest';

import { getCompany } from '../../frontend/api';

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
