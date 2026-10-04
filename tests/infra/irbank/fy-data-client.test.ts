import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import { IrBankFinancialSource } from '@/infra/irbank/fy-data-client';

/**
 * IRバンクからの取得。
 * 仕様: docs/02_design/logic/irbank-json-import.md §4
 *
 * **実 API を叩かない**（`.claude/rules/backend.md`）。`fetch` を差し替え、
 * 応答は実物の fixture から作る。
 */

type FetchImpl = typeof globalThis.fetch;

function fixtureText(code: string): string {
  return readFileSync(
    fileURLToPath(new URL(`../../fixtures/irbank/${code}.json`, import.meta.url)),
    'utf8',
  );
}

function jsonResponse(body: string, status = 200): Response {
  return new Response(body, { status, headers: { 'content-type': 'application/json' } });
}

/** 応答を1つ返すだけの `fetch`。呼び出し引数を検証できるよう型を付ける */
function respondWith(response: () => Response) {
  return vi.fn<FetchImpl>(() => Promise.resolve(response()));
}

/** リトライ待機を潰す。テストを1秒待たせない */
function source(fetchImpl: FetchImpl) {
  const sleep = vi.fn(async () => {
    /* 待たない */
  });
  return { client: new IrBankFinancialSource({ fetch: fetchImpl, sleep }), sleep };
}

describe('取得に成功する', () => {
  it('銘柄コードから URL を組み立てる', async () => {
    const fetchImpl = respondWith(() => jsonResponse(fixtureText('9433')));
    const { client } = source(fetchImpl);

    const result = await client.fetchByCode('9433');

    expect(result.ok).toBe(true);
    expect(fetchImpl.mock.calls[0]?.[0]).toBe('https://f.irbank.net/files/9433/fy-data-all.json');
  });

  it('取り込んだ結果はパーサの出力そのもの', async () => {
    const { client } = source(respondWith(() => jsonResponse(fixtureText('9433'))));

    const result = await client.fetchByCode('9433');

    if (!result.ok) throw new Error('取得に失敗した');
    expect(result.value.code).toBe('9433');
    expect(result.value.latestActualEpsSen).toBe(18359);
  });

  it('タイムアウトの signal を必ず付け、リダイレクトを追わない', async () => {
    const fetchImpl = respondWith(() => jsonResponse(fixtureText('9433')));
    const { client } = source(fetchImpl);

    await client.fetchByCode('9433');

    const init = fetchImpl.mock.calls[0]?.[1];
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    // 302 を追いかけると HTML を掴まされる
    expect(init?.redirect).toBe('manual');
  });

  it('小文字の銘柄コードは大文字に正規化する（JPX の英字コード）', async () => {
    const body = fixtureText('9433').replace(/"9433"/g, '"130A"');
    const fetchImpl = respondWith(() => jsonResponse(body));
    const { client } = source(fetchImpl);

    const result = await client.fetchByCode('130a');

    expect(fetchImpl.mock.calls[0]?.[0]).toBe('https://f.irbank.net/files/130A/fy-data-all.json');
    expect(result.ok).toBe(true);
  });
});

describe('銘柄が見つからない', () => {
  it('302 は source-not-found。リトライしない', async () => {
    const fetchImpl = respondWith(() => new Response(null, { status: 302 }));
    const { client, sleep } = source(fetchImpl);

    const result = await client.fetchByCode('9999');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({ kind: 'source-not-found', code: '9999' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('404 は source-not-found', async () => {
    const { client } = source(respondWith(() => new Response('not found', { status: 404 })));

    const result = await client.fetchByCode('9999');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('source-not-found');
  });

  it('200 でも JSON でなければ source-not-found（HTML を掴まされた場合）', async () => {
    const { client } = source(
      respondWith(
        () => new Response('<html></html>', { headers: { 'content-type': 'text/html' } }),
      ),
    );

    const result = await client.fetchByCode('9999');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('source-not-found');
  });
});

describe('通信の失敗とリトライ', () => {
  it('1回失敗しても、もう一度だけ試して成功すれば取り込める', async () => {
    const fetchImpl = vi
      .fn<FetchImpl>()
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce(jsonResponse(fixtureText('9433')));
    const { client, sleep } = source(fetchImpl);

    const result = await client.fetchByCode('9433');

    expect(result.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(1000);
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

  it('タイムアウトもリトライの対象', async () => {
    const abort = new Error('The operation was aborted');
    abort.name = 'TimeoutError';
    const { client } = source(vi.fn<FetchImpl>().mockRejectedValue(abort));

    const result = await client.fetchByCode('9433');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({ kind: 'source-unreachable', detail: 'TimeoutError' });
  });

  it('5xx はリトライする', async () => {
    const fetchImpl = respondWith(() => new Response('boom', { status: 503 }));
    const { client } = source(fetchImpl);

    const result = await client.fetchByCode('9433');

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result.ok).toBe(false);
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
      vi.fn<FetchImpl>().mockRejectedValue(new Error('https://f.irbank.net/secret/path')),
    );

    const result = await client.fetchByCode('9433');

    if (result.ok) return;
    if (result.error.kind !== 'source-unreachable') throw new Error('種別が違う');
    expect(result.error.detail).toBe('Error');
    expect(result.error.detail).not.toContain('irbank');
  });
});

describe('応答が読めない', () => {
  it('JSON として壊れていれば malformed-response', async () => {
    const { client } = source(respondWith(() => jsonResponse('{ こわれた')));

    const result = await client.fetchByCode('9433');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('malformed-response');
  });

  it('別の銘柄のデータが返ってきたら code-mismatch', async () => {
    const { client } = source(respondWith(() => jsonResponse(fixtureText('9433'))));

    const result = await client.fetchByCode('7203');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({ kind: 'code-mismatch', expected: '7203', actual: '9433' });
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
