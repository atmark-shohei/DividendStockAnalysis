import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import { YahooChartMarketDataSource } from '@/infra/yahoo/chart-client';

/**
 * Yahoo Finance の chart エンドポイントからの取得。
 * 仕様: docs/02_design/logic/market-data-source.md §5・§7.3
 *
 * **実 API を叩かない**（`.claude/rules/backend.md`）。`fetch` を差し替え、
 * 応答は実物の fixture から作る。
 */

type FetchImpl = typeof globalThis.fetch;

function fixtureText(code: string): string {
  return readFileSync(
    fileURLToPath(new URL(`../../fixtures/yahoo/${code}.json`, import.meta.url)),
    'utf8',
  );
}

function jsonResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { 'content-type': 'application/json;charset=utf-8' },
  });
}

function respondWith(response: () => Response) {
  return vi.fn<FetchImpl>(() => Promise.resolve(response()));
}

/** リトライ待機を潰す。テストを1秒待たせない */
function source(fetchImpl: FetchImpl) {
  const sleep = vi.fn(async () => {
    /* 待たない */
  });
  return { client: new YahooChartMarketDataSource({ fetch: fetchImpl, sleep }), sleep };
}

describe('取得に成功する', () => {
  it('銘柄コードから URL を組み立てる（.T サフィックス、range=max&interval=1mo）', async () => {
    const fetchImpl = respondWith(() => jsonResponse(fixtureText('9433')));
    const { client } = source(fetchImpl);

    const result = await client.fetchByCode('9433');

    expect(result.ok).toBe(true);
    expect(fetchImpl.mock.calls[0]?.[0]).toBe(
      'https://query1.finance.yahoo.com/v8/finance/chart/9433.T?range=max&interval=1mo&events=div%7Csplit',
    );
  });

  it('取り込んだ結果はパーサの出力そのもの', async () => {
    const { client } = source(respondWith(() => jsonResponse(fixtureText('9433'))));

    const result = await client.fetchByCode('9433');

    if (!result.ok) throw new Error('取得に失敗した');
    expect(result.value.code).toBe('9433');
    expect(result.value.name).toBe('KDDI Corporation');
  });

  it('タイムアウトの signal を必ず付ける', async () => {
    const fetchImpl = respondWith(() => jsonResponse(fixtureText('9433')));
    const { client } = source(fetchImpl);

    await client.fetchByCode('9433');

    const init = fetchImpl.mock.calls[0]?.[1];
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('User-Agent を明示的に送る（workerd は UA を送らず、UA 無しだと Yahoo が 429 を返すため）', async () => {
    const fetchImpl = respondWith(() => jsonResponse(fixtureText('9433')));
    const { client } = source(fetchImpl);

    await client.fetchByCode('9433');

    const headers = fetchImpl.mock.calls[0]?.[1]?.headers;
    expect(headers).toHaveProperty('user-agent', 'node');
  });

  it('User-Agent にブラウザを騙る文字列を使わない（ADR-0010 決定#2）', async () => {
    const fetchImpl = respondWith(() => jsonResponse(fixtureText('9433')));
    const { client } = source(fetchImpl);

    await client.fetchByCode('9433');

    const headers = fetchImpl.mock.calls[0]?.[1]?.headers as Record<string, string> | undefined;
    const userAgent = headers?.['user-agent'] ?? '';
    for (const browserish of ['Mozilla', 'Chrome', 'Safari', 'AppleWebKit', 'Gecko', 'Edg']) {
      expect(userAgent).not.toContain(browserish);
    }
  });

  it('小文字の銘柄コードは大文字に正規化する', async () => {
    const fetchImpl = respondWith(() => jsonResponse(fixtureText('9433')));
    const { client } = source(fetchImpl);

    const result = await client.fetchByCode('130a');

    // fixture の chart は 9433.T のものだが、client は要求したコードをそのまま
    // parseChart へ渡すので、コード自体は '130A' に正規化されて通る
    expect(fetchImpl.mock.calls[0]?.[0]).toBe(
      'https://query1.finance.yahoo.com/v8/finance/chart/130A.T?range=max&interval=1mo&events=div%7Csplit',
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.code).toBe('130A');
  });
});

describe('銘柄が見つからない', () => {
  it('404 は source-not-found。リトライしない', async () => {
    const fetchImpl = respondWith(() => new Response('not found', { status: 404 }));
    const { client, sleep } = source(fetchImpl);

    const result = await client.fetchByCode('9999');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({ kind: 'source-not-found', code: '9999' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('chart.error が非 null の 200 応答も source-not-found', async () => {
    const body = JSON.stringify({
      chart: { result: [], error: { code: 'Not Found', description: 'No data found' } },
    });
    const { client } = source(respondWith(() => jsonResponse(body)));

    const result = await client.fetchByCode('9999');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('source-not-found');
  });
});

describe('レート制限とリトライ（§5.1）', () => {
  it('429 は source-unreachable。**リトライを増やさない**', async () => {
    const fetchImpl = respondWith(() => new Response('Too Many Requests', { status: 429 }));
    const { client, sleep } = source(fetchImpl);

    const result = await client.fetchByCode('9433');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('source-unreachable');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('5xx は1回だけリトライして、なお失敗なら source-unreachable', async () => {
    const fetchImpl = respondWith(() => new Response('boom', { status: 503 }));
    const { client } = source(fetchImpl);

    const result = await client.fetchByCode('9433');

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('source-unreachable');
  });

  it('5xx が1回だけなら、もう一度だけ試して成功すれば取り込める', async () => {
    const fetchImpl = vi
      .fn<FetchImpl>()
      .mockResolvedValueOnce(new Response('boom', { status: 503 }))
      .mockResolvedValueOnce(jsonResponse(fixtureText('9433')));
    const { client, sleep } = source(fetchImpl);

    const result = await client.fetchByCode('9433');

    expect(result.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(1000);
  });

  it('タイムアウトは1回だけリトライする', async () => {
    const abort = new Error('The operation was aborted');
    abort.name = 'TimeoutError';
    const fetchImpl = vi
      .fn<FetchImpl>()
      .mockRejectedValueOnce(abort)
      .mockResolvedValueOnce(jsonResponse(fixtureText('9433')));
    const { client } = source(fetchImpl);

    const result = await client.fetchByCode('9433');

    expect(result.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('2回失敗したら source-unreachable。**3回目は試さない**', async () => {
    const fetchImpl = vi.fn<FetchImpl>().mockRejectedValue(new Error('network down'));
    const { client } = source(fetchImpl);

    const result = await client.fetchByCode('9433');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('source-unreachable');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('404 以外の 4xx はリトライしない', async () => {
    const fetchImpl = respondWith(() => new Response('nope', { status: 403 }));
    const { client } = source(fetchImpl);

    const result = await client.fetchByCode('9433');

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    if (result.ok) return;
    expect(result.error.kind).toBe('source-unreachable');
  });

  it('エラーの detail にスタックトレースや URL を載せない', async () => {
    const { client } = source(
      vi.fn<FetchImpl>().mockRejectedValue(new Error('https://query1.finance.yahoo.com/secret')),
    );

    const result = await client.fetchByCode('9433');

    if (result.ok) return;
    if (result.error.kind !== 'source-unreachable') throw new Error('種別が違う');
    expect(result.error.detail).toBe('Error');
    expect(result.error.detail).not.toContain('yahoo');
  });
});

describe('銘柄コードの検証', () => {
  it.each(['943', '94333', 'ABCD', '', '94a3'])(
    '形式が違う %s は外部へ問い合わせない',
    async (code) => {
      const fetchImpl = respondWith(() => jsonResponse(fixtureText('9433')));
      const { client } = source(fetchImpl);

      const result = await client.fetchByCode(code);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.kind).toBe('invalid-code');
      expect(fetchImpl).not.toHaveBeenCalled();
    },
  );

  it('例外を投げない。失敗は Result で返す', async () => {
    const { client } = source(vi.fn<FetchImpl>().mockRejectedValue(new Error('boom')));

    await expect(client.fetchByCode('9433')).resolves.toMatchObject({ ok: false });
  });
});
