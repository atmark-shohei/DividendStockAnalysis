import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { zipSync } from 'fflate';
import { describe, expect, it, vi } from 'vitest';

import { type EdinetDocumentIndexLookup } from '@/domain/company/edinet-document-index';
import { EdinetClient } from '@/infra/edinet/edinet-client';

/**
 * EDINET クライアントの取得・ネットワーク耐性。
 * 仕様: `docs/02_design/logic/edinet-history-import.md` §7.5
 *
 * `fy-data-client.test.ts` / `chart-client.test.ts` と同型（`fetch` を注入、`sleep` を
 * 即時解決）。**実 API を叩かない**。ZIP フィクスチャは実物（`S100YKG2.zip`）から作る。
 */

type FetchImpl = typeof globalThis.fetch;

function zipBytes(): Uint8Array {
  const buffer = readFileSync(
    fileURLToPath(new URL('../../fixtures/edinet/S100YKG2.zip', import.meta.url)),
  );
  return new Uint8Array(buffer);
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function zipResponse(status = 200): Response {
  return new Response(zipBytes(), { status });
}

function client(fetchImpl: FetchImpl) {
  const sleep = vi.fn(async () => {
    /* 待たない */
  });
  return { client: new EdinetClient({ apiKey: 'dummy-key', fetch: fetchImpl, sleep }), sleep };
}

const emptyIndex: EdinetDocumentIndexLookup = {
  findDocId: () => Promise.resolve(null),
  findLatest: () => Promise.resolve(null),
};

/* ------------------------------------------------------------------------- *
 * 診断（`diagnostics`）用の構成ZIP。
 *
 * 実物フィクスチャ（`S100YKG2.zip`）には単位不整合が含まれないため、実物と同じ構造
 * （UTF-16LE・BOM付き・タブ区切り・引用符付き・`XBRL_TO_CSV/jpcrp030000-asr-*.csv`）を
 * そのまま踏襲した構成CSVをZIPに詰めて使う（`parse-summary-csv.test.ts` と同じ方針）。
 * ------------------------------------------------------------------------- */

const HEADER = [
  '要素ID',
  '項目名',
  'コンテキストID',
  '相対年度',
  '連結・個別',
  '期間・時点',
  'ユニットID',
  '単位',
  '値',
]
  .map((cell) => `"${cell}"`)
  .join('\t');

function csvRow(
  elementId: string,
  contextId: string,
  unitId: string,
  unit: string,
  value: string,
): string {
  return [elementId, '項目名', contextId, '相対年度', 'その他', '期間', unitId, unit, value]
    .map((cell) => `"${cell}"`)
    .join('\t');
}

/** UTF-16LE（BOM付き）へ。実物CSVと同じエンコーディングにする */
function utf16leBytes(text: string): Uint8Array {
  const withBom = `${String.fromCharCode(0xfeff)}${text}`;
  const bytes = new Uint8Array(withBom.length * 2);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < withBom.length; index += 1) {
    view.setUint16(index * 2, withBom.charCodeAt(index), true);
  }
  return bytes;
}

function buildSummaryZip(rows: readonly string[]): Uint8Array {
  return zipSync({
    'XBRL_TO_CSV/jpcrp030000-asr-001_E04425-000_2026-03-31_01_2026-06-25.csv': utf16leBytes(
      [HEADER, ...rows].join('\n'),
    ),
  });
}

const EPS_ELEMENT = 'jpcrp_cor:BasicEarningsLossPerShareSummaryOfBusinessResults';
const REVENUE_ELEMENT = 'jpcrp_cor:NetSalesSummaryOfBusinessResults';
const CURRENT_ASSETS_ELEMENT = 'jppfs_cor:CurrentAssets';

/**
 * 単位不整合を含むCSV。
 * - EPS: 当期(offset 0)・四期前(offset 4) の ユニットID が `JPYPerShares` でない
 * - 売上高: 当期(offset 0) の 単位が「千円」（円ではない）
 * - 流動資産: 前期末時点（offset は `null`）の単位が「千円」
 */
function unitMismatchRows(): readonly string[] {
  return [
    csvRow(EPS_ELEMENT, 'CurrentYearDuration', 'JPY', '円', '183.59'),
    csvRow(EPS_ELEMENT, 'Prior4YearDuration', 'JPY', '円', '150.01'),
    csvRow(REVENUE_ELEMENT, 'CurrentYearDuration', 'JPY', '千円', '6071915000'),
    csvRow(CURRENT_ASSETS_ELEMENT, 'Prior1YearInstant', 'JPY', '千円', '4706507000'),
  ];
}

/** 単位も値も正常なCSV（診断が1件も出ない） */
function cleanRows(): readonly string[] {
  return [
    csvRow(EPS_ELEMENT, 'CurrentYearDuration', 'JPYPerShares', '円', '183.59'),
    csvRow(REVENUE_ELEMENT, 'CurrentYearDuration', 'JPY', '円', '6071915000000'),
    csvRow(CURRENT_ASSETS_ELEMENT, 'Prior1YearInstant', 'JPY', '円', '4706507000000'),
  ];
}

function zipResponseOf(rows: readonly string[]): Response {
  return new Response(buildSummaryZip(rows), { status: 200 });
}

function indexOfBoth(): EdinetDocumentIndexLookup {
  return {
    findLatest: () =>
      Promise.resolve({
        companyCode: '9433',
        fiscalYear: 2026,
        docId: 'S100YKG2',
        submittedAt: '2026-06-25T06:30:00.000Z',
      }),
    findDocId: () =>
      Promise.resolve({
        companyCode: '9433',
        fiscalYear: 2025,
        docId: 'S100VXGZ',
        submittedAt: '2025-06-13T00:00:00.000Z',
      }),
  };
}

function indexOfLatestOnly(): EdinetDocumentIndexLookup {
  return {
    findLatest: () =>
      Promise.resolve({
        companyCode: '9433',
        fiscalYear: 2026,
        docId: 'S100YKG2',
        submittedAt: '2026-06-25T06:30:00.000Z',
      }),
    findDocId: () => Promise.resolve(null),
  };
}

describe('fetchByDate — documents.json', () => {
  it('results を EdinetDocumentIndexEntry へ変換して返す', async () => {
    const fetchImpl = vi.fn<FetchImpl>(() =>
      Promise.resolve(
        jsonResponse({
          results: [
            {
              docID: 'S100YKG2',
              secCode: '94330',
              formCode: '030000',
              periodEnd: '2026-03-31',
              submitDateTime: '2026-06-25 15:30',
              withdrawalStatus: '0',
            },
          ],
        }),
      ),
    );
    const { client: target } = client(fetchImpl);

    const result = await target.fetchByDate('2026-06-25');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual([
      {
        companyCode: '9433',
        fiscalYear: 2026,
        docId: 'S100YKG2',
        submittedAt: '2026-06-25T06:30:00.000Z',
      },
    ]);
  });

  it('Subscription-Key をクエリに含める', async () => {
    const fetchImpl = vi.fn<FetchImpl>(() => Promise.resolve(jsonResponse({ results: [] })));
    const { client: target } = client(fetchImpl);

    await target.fetchByDate('2026-06-25');

    const url = fetchImpl.mock.calls[0]?.[0];
    expect(String(url)).toContain('Subscription-Key=dummy-key');
    expect(String(url)).toContain('date=2026-06-25');
  });

  it('401（Subscription-Key無効）は source-unreachable。内部情報を含まない', async () => {
    const fetchImpl = vi.fn<FetchImpl>(() => Promise.resolve(new Response(null, { status: 401 })));
    const { client: target, sleep } = client(fetchImpl);

    const result = await target.fetchByDate('2026-06-25');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({ kind: 'source-unreachable', detail: 'HTTP 401' });
    expect(result.error.kind === 'source-unreachable' && result.error.detail).not.toContain(
      'dummy-key',
    );
    // 401はリトライしない
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('429（レート制限）は source-unreachable。リトライを増やさない', async () => {
    const fetchImpl = vi.fn<FetchImpl>(() => Promise.resolve(new Response(null, { status: 429 })));
    const { client: target } = client(fetchImpl);

    const result = await target.fetchByDate('2026-06-25');

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('source-unreachable');
  });

  it('5xx は1回だけリトライする', async () => {
    const fetchImpl = vi.fn<FetchImpl>(() =>
      Promise.resolve(new Response('boom', { status: 503 })),
    );
    const { client: target } = client(fetchImpl);

    const result = await target.fetchByDate('2026-06-25');

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result.ok).toBe(false);
  });

  it('ネットワーク例外は1回だけリトライして成功すれば取り込める', async () => {
    const fetchImpl = vi
      .fn<FetchImpl>()
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce(jsonResponse({ results: [] }));
    const { client: target, sleep } = client(fetchImpl);

    const result = await target.fetchByDate('2026-06-25');

    expect(result.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(1000);
  });

  it('2回失敗したら source-unreachable。3回目は試さない', async () => {
    const fetchImpl = vi.fn<FetchImpl>().mockRejectedValue(new Error('network down'));
    const { client: target } = client(fetchImpl);

    const result = await target.fetchByDate('2026-06-25');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('source-unreachable');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('JSONとして壊れた応答は malformed-response', async () => {
    const fetchImpl = vi.fn<FetchImpl>(() =>
      Promise.resolve(
        new Response('{ こわれた', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
    const { client: target } = client(fetchImpl);

    const result = await target.fetchByDate('2026-06-25');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('malformed-response');
  });
});

/**
 * EDINET は購読キーが無効でも **HTTP 200** を返し、本文に `{"StatusCode": 401, ...}` を入れる
 * （2026-08-09 実測。本番で `malformed-response` に化けて原因調査が遠回りになった回帰テスト）。
 */
const AUTH_FAILURE_BODY = {
  StatusCode: 401,
  message:
    'Access denied due to invalid subscription key.Make sure to provide a valid key for an active subscription.',
};

describe('認証失敗（HTTP 200 + StatusCode 401）', () => {
  it('documents.json: malformed-response ではなく authentication-failed を返す', async () => {
    const fetchImpl = vi.fn<FetchImpl>(() => Promise.resolve(jsonResponse(AUTH_FAILURE_BODY)));
    const { client: target } = client(fetchImpl);

    const result = await target.fetchByDate('2026-06-25');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({ kind: 'authentication-failed' });
    // HTTP 200 なので再試行はしない（リトライしても直らない）
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('StatusCode が文字列の "401" でも認証失敗として扱う', async () => {
    const fetchImpl = vi.fn<FetchImpl>(() =>
      Promise.resolve(jsonResponse({ ...AUTH_FAILURE_BODY, StatusCode: '401' })),
    );
    const { client: target } = client(fetchImpl);

    const result = await target.fetchByDate('2026-06-25');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({ kind: 'authentication-failed' });
  });

  it('有報本体: ZIPのはずがJSONで返ったら authentication-failed（ZIP展開失敗に化けない）', async () => {
    const fetchImpl = vi.fn<FetchImpl>(() => Promise.resolve(jsonResponse(AUTH_FAILURE_BODY)));
    const { client: target } = client(fetchImpl);
    const index: EdinetDocumentIndexLookup = {
      findLatest: () =>
        Promise.resolve({
          companyCode: '9433',
          fiscalYear: 2026,
          docId: 'S100YKG2',
          submittedAt: '2026-06-25T06:30:00.000Z',
        }),
      findDocId: () => Promise.resolve(null),
    };

    const result = await target.fetchHistory('9433', index);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({ kind: 'authentication-failed' });
  });

  it('有報本体: JSONだが認証失敗ではない場合は malformed-response', async () => {
    const fetchImpl = vi.fn<FetchImpl>(() => Promise.resolve(jsonResponse({ metadata: {} })));
    const { client: target } = client(fetchImpl);
    const index: EdinetDocumentIndexLookup = {
      findLatest: () =>
        Promise.resolve({
          companyCode: '9433',
          fiscalYear: 2026,
          docId: 'S100YKG2',
          submittedAt: '2026-06-25T06:30:00.000Z',
        }),
      findDocId: () => Promise.resolve(null),
    };

    const result = await target.fetchHistory('9433', index);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('malformed-response');
  });

  it('通常の成功応答は認証失敗と誤判定しない', async () => {
    const fetchImpl = vi.fn<FetchImpl>(() => Promise.resolve(jsonResponse({ results: [] })));
    const { client: target } = client(fetchImpl);

    const result = await target.fetchByDate('2026-06-25');

    expect(result.ok).toBe(true);
  });
});

describe('fetchHistory — 銘柄コードの検証', () => {
  it.each(['943', '94333', 'ABCD', ''])('形式が違う %s は外部へ問い合わせない', async (code) => {
    const fetchImpl = vi.fn<FetchImpl>();
    const { client: target } = client(fetchImpl);

    const result = await target.fetchHistory(code, emptyIndex);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('invalid-code');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('fetchHistory — docIDが見つからない', () => {
  it('インデックスに該当エントリが無ければ document-not-found（例外にしない）', async () => {
    const fetchImpl = vi.fn<FetchImpl>();
    const { client: target } = client(fetchImpl);

    const result = await target.fetchHistory('9433', emptyIndex);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({ kind: 'document-not-found', code: '9433' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('fetchHistory — 取得成功（実物ZIPフィクスチャ）', () => {
  function indexWithLatestOnly(): EdinetDocumentIndexLookup {
    return {
      findLatest: () =>
        Promise.resolve({
          companyCode: '9433',
          fiscalYear: 2026,
          docId: 'S100YKG2',
          submittedAt: '2026-06-25T06:30:00.000Z',
        }),
      findDocId: () => Promise.resolve(null), // 1年前の有報は無い
    };
  }

  it('1本の有報だけでも5期分を返す。6期目は無く epsHistoryRestated は false', async () => {
    const fetchImpl = vi.fn<FetchImpl>(() => Promise.resolve(zipResponse()));
    const { client: target } = client(fetchImpl);

    const result = await target.fetchHistory('9433', indexWithLatestOnly());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.years).toHaveLength(5);
    expect(result.value.years[0]).toEqual({
      fiscalYear: 2026,
      epsSen: 18_359,
      revenueSen: 607_191_500_000_000,
      sourceDocId: 'S100YKG2',
    });
    expect(result.value.epsHistoryRestated).toBe(false); // 比較できなければ false
    expect(result.value.revenueHistoryRestated).toBe(false);
  });

  it('⑥用の貸借対照表スナップショットを返す（IFRS企業は投資有価証券が null）', async () => {
    const fetchImpl = vi.fn<FetchImpl>(() => Promise.resolve(zipResponse()));
    const { client: target } = client(fetchImpl);

    const result = await target.fetchHistory('9433', indexWithLatestOnly());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.balanceSheet).toEqual({
      currentAssetsSen: 470_650_700_000_000,
      investmentSecuritiesSen: null,
      sourceDocId: 'S100YKG2',
    });
  });

  it('Subscription-Key をクエリに含める', async () => {
    const fetchImpl = vi.fn<FetchImpl>(() => Promise.resolve(zipResponse()));
    const { client: target } = client(fetchImpl);

    await target.fetchHistory('9433', indexWithLatestOnly());

    const url = fetchImpl.mock.calls[0]?.[0];
    expect(String(url)).toContain('Subscription-Key=dummy-key');
    expect(String(url)).toContain('/documents/S100YKG2');
    expect(String(url)).toContain('type=5');
  });
});

describe('fetchHistory — 1年前有報の取得が失敗しても最新有報の5期分は成功する（CR-5の回帰テスト）', () => {
  function indexWithBothEntries(): EdinetDocumentIndexLookup {
    return {
      findLatest: () =>
        Promise.resolve({
          companyCode: '9433',
          fiscalYear: 2026,
          docId: 'S100YKG2',
          submittedAt: '2026-06-25T06:30:00.000Z',
        }),
      findDocId: () =>
        Promise.resolve({
          companyCode: '9433',
          fiscalYear: 2025,
          docId: 'S100VXGZ',
          submittedAt: '2025-06-13T00:00:00.000Z',
        }),
    };
  }

  it('1年前有報のZIPが壊れていても、全体を失敗にせず5期分のみで成功する', async () => {
    let callCount = 0;
    const fetchImpl = vi.fn<FetchImpl>(() => {
      callCount += 1;
      // 1回目（最新有報）は正常、2回目（1年前有報）は壊れたZIP
      return Promise.resolve(
        callCount === 1
          ? zipResponse()
          : new Response(new Uint8Array([0x00, 0x01, 0x02]), { status: 200 }),
      );
    });
    const { client: target } = client(fetchImpl);

    const result = await target.fetchHistory('9433', indexWithBothEntries());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.years).toHaveLength(5);
    expect(result.value.epsHistoryRestated).toBe(false);
    expect(result.value.revenueHistoryRestated).toBe(false);
    // 最新有報・1年前有報あわせて2回 fetch を試みている（1年前の失敗はリトライされない。
    // status 200 は 5xx ではないため `fetchWithRetry` が即座に応答として扱う）
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

describe('fetchHistory — ZIP展開失敗', () => {
  it('壊れたZIP応答は malformed-response', async () => {
    const fetchImpl = vi.fn<FetchImpl>(() =>
      Promise.resolve(new Response(new Uint8Array([0x00, 0x01, 0x02]), { status: 200 })),
    );
    const { client: target } = client(fetchImpl);

    const result = await target.fetchHistory('9433', indexOf('9433'));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('malformed-response');
  });

  function indexOf(companyCode: string): EdinetDocumentIndexLookup {
    return {
      findLatest: () =>
        Promise.resolve({
          companyCode,
          fiscalYear: 2026,
          docId: 'S100YKG2',
          submittedAt: '2026-06-25T06:30:00.000Z',
        }),
      findDocId: () => Promise.resolve(null),
    };
  }
});

describe('fetchHistory — ネットワーク耐性（有報本体の取得）', () => {
  function indexWithLatestOnly(): EdinetDocumentIndexLookup {
    return {
      findLatest: () =>
        Promise.resolve({
          companyCode: '9433',
          fiscalYear: 2026,
          docId: 'S100YKG2',
          submittedAt: '2026-06-25T06:30:00.000Z',
        }),
      findDocId: () => Promise.resolve(null),
    };
  }

  it('タイムアウト5秒・リトライは1回だけ', async () => {
    const abort = new Error('The operation was aborted');
    abort.name = 'TimeoutError';
    const fetchImpl = vi.fn<FetchImpl>().mockRejectedValue(abort);
    const { client: target } = client(fetchImpl);

    const result = await target.fetchHistory('9433', indexWithLatestOnly());

    expect(result.ok).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const init = fetchImpl.mock.calls[0]?.[1];
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('401（Subscription-Key無効）は source-unreachable。エラー本文にキーを含めない', async () => {
    const fetchImpl = vi.fn<FetchImpl>(() => Promise.resolve(new Response(null, { status: 401 })));
    const { client: target } = client(fetchImpl);

    const result = await target.fetchHistory('9433', indexWithLatestOnly());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({ kind: 'source-unreachable', detail: 'HTTP 401' });
  });
});

/**
 * 取り込めなかった値の記録を応答まで運ぶ（設計書 §4.2・`.claude/rules/backend.md`
 * 「検証に落ちたデータは捨てずに記録する」）。パース時点の診断に `sourceDocId` と
 * 絶対年度 `fiscalYear` を付けてフラットな1配列で返す。
 */
describe('fetchHistory — パース診断の伝播', () => {
  it('① 最新有報のみ: 単位不整合の診断が sourceDocId 付きで返る', async () => {
    const fetchImpl = vi.fn<FetchImpl>(() => Promise.resolve(zipResponseOf(unitMismatchRows())));
    const { client: target } = client(fetchImpl);

    const result = await target.fetchHistory('9433', indexOfLatestOnly());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.diagnostics).toContainEqual({
      field: 'eps',
      offset: 0,
      fiscalYear: 2026,
      elementId: EPS_ELEMENT,
      reason: 'unit-mismatch',
      raw: 'unitId=JPY',
      sourceDocId: 'S100YKG2',
    });
    expect(
      result.value.diagnostics.every((diagnostic) => diagnostic.sourceDocId === 'S100YKG2'),
    ).toBe(true);
  });

  it('② 最新＋1年前の2本: 診断が混ざり sourceDocId でどちらの有報由来か区別できる', async () => {
    const fetchImpl = vi.fn<FetchImpl>(() => Promise.resolve(zipResponseOf(unitMismatchRows())));
    const { client: target } = client(fetchImpl);

    const result = await target.fetchHistory('9433', indexOfBoth());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const byDocId = new Set(result.value.diagnostics.map((diagnostic) => diagnostic.sourceDocId));
    expect(byDocId).toEqual(new Set(['S100YKG2', 'S100VXGZ']));
    // 同じ構成CSVを2本ぶん返しているので、診断も2本ぶん（4件×2）
    expect(result.value.diagnostics).toHaveLength(8);
    // 1年前有報（当期=2025）の当期EPSは fiscalYear 2025 になる（最新有報の 2026 と混同しない）
    expect(result.value.diagnostics).toContainEqual({
      field: 'eps',
      offset: 0,
      fiscalYear: 2025,
      elementId: EPS_ELEMENT,
      reason: 'unit-mismatch',
      raw: 'unitId=JPY',
      sourceDocId: 'S100VXGZ',
    });
  });

  const offsetCases: ReadonlyArray<{
    name: string;
    offset: number;
    expectedFiscalYear: number;
  }> = [
    { name: 'offset 0（当期）→ 有報の当期年度そのもの', offset: 0, expectedFiscalYear: 2026 },
    { name: 'offset 4（四期前）→ 有報の当期年度 − 4', offset: 4, expectedFiscalYear: 2022 },
  ];

  it.each(offsetCases)('③ $name', async ({ offset, expectedFiscalYear }) => {
    const fetchImpl = vi.fn<FetchImpl>(() => Promise.resolve(zipResponseOf(unitMismatchRows())));
    const { client: target } = client(fetchImpl);

    const result = await target.fetchHistory('9433', indexOfLatestOnly());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const found = result.value.diagnostics.find(
      (diagnostic) => diagnostic.field === 'eps' && diagnostic.offset === offset,
    );
    expect(found?.fiscalYear).toBe(expectedFiscalYear);
  });

  it('④ 貸借対照表項目の診断は offset も fiscalYear も null（勝手に年度を埋めない）', async () => {
    const fetchImpl = vi.fn<FetchImpl>(() => Promise.resolve(zipResponseOf(unitMismatchRows())));
    const { client: target } = client(fetchImpl);

    const result = await target.fetchHistory('9433', indexOfLatestOnly());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.diagnostics).toContainEqual({
      field: 'currentAssets',
      offset: null,
      fiscalYear: null,
      elementId: CURRENT_ASSETS_ELEMENT,
      reason: 'unit-mismatch',
      raw: 'unit=千円',
      sourceDocId: 'S100YKG2',
    });
  });

  it('⑤ 1年前有報の取得が失敗しても、最新有報側の診断は失われない（ok のまま返る）', async () => {
    let callCount = 0;
    const fetchImpl = vi.fn<FetchImpl>(() => {
      callCount += 1;
      return Promise.resolve(
        callCount === 1
          ? zipResponseOf(unitMismatchRows())
          : new Response(new Uint8Array([0x00, 0x01, 0x02]), { status: 200 }),
      );
    });
    const { client: target } = client(fetchImpl);

    const result = await target.fetchHistory('9433', indexOfBoth());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.diagnostics).toHaveLength(4);
    expect(
      result.value.diagnostics.every((diagnostic) => diagnostic.sourceDocId === 'S100YKG2'),
    ).toBe(true);
  });

  it('⑥ 診断が0件のときは空配列（undefined にしない）', async () => {
    const fetchImpl = vi.fn<FetchImpl>(() => Promise.resolve(zipResponseOf(cleanRows())));
    const { client: target } = client(fetchImpl);

    const result = await target.fetchHistory('9433', indexOfLatestOnly());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.diagnostics).toEqual([]);
  });

  it('実物フィクスチャ（S100YKG2）では診断が出ない', async () => {
    const fetchImpl = vi.fn<FetchImpl>(() => Promise.resolve(zipResponse()));
    const { client: target } = client(fetchImpl);

    const result = await target.fetchHistory('9433', indexOfLatestOnly());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.diagnostics).toEqual([]);
  });
});
