import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { zipSync } from 'fflate';
import { describe, expect, it, vi } from 'vitest';

import { type EdinetDocumentIndexLookup } from '@/domain/company/edinet-document-index';
import {
  type EdinetDocumentSummary,
  type EdinetDocumentSummaryCache,
} from '@/infra/edinet/document-summary-cache';
import { EdinetClient } from '@/infra/edinet/edinet-client';

/**
 * EDINET クライアントの取得・ネットワーク耐性。
 * 仕様: `docs/02_design/logic/edinet-history-import.md` §7.5
 *
 * `fy-data-client.test.ts` / `chart-client.test.ts` と同型（`fetch` を注入、`sleep` を
 * 即時解決）。**実 API を叩かない**。ZIP フィクスチャは実物（`S100YKG2.zip`・`S100VXGZ.zip`・
 * `1301-fy2026-S100YE8K.zip`）から作る（CR-1。§7.7実測値の突き合わせ用）。
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

function client(fetchImpl: FetchImpl, summaryCache?: EdinetDocumentSummaryCache) {
  const sleep = vi.fn(async () => {
    /* 待たない */
  });
  return {
    client: new EdinetClient({ apiKey: 'dummy-key', fetch: fetchImpl, sleep, summaryCache }),
    sleep,
  };
}

/**
 * インメモリの Fake `EdinetDocumentSummaryCache`（`Map<docId, EdinetDocumentSummary>`）。
 * `find`/`save` の呼び出し履歴を持ち、テストから振る舞いを差し替えられる。
 */
function fakeSummaryCache(overrides: Partial<EdinetDocumentSummaryCache> = {}): {
  cache: EdinetDocumentSummaryCache;
  store: Map<string, EdinetDocumentSummary>;
  findCalls: string[];
  saveCalls: string[];
} {
  const store = new Map<string, EdinetDocumentSummary>();
  const findCalls: string[] = [];
  const saveCalls: string[] = [];
  const cache: EdinetDocumentSummaryCache = {
    find:
      overrides.find ??
      ((docId) => {
        findCalls.push(docId);
        return Promise.resolve(store.get(docId) ?? null);
      }),
    save:
      overrides.save ??
      ((docId, summary) => {
        saveCalls.push(docId);
        store.set(docId, summary);
        return Promise.resolve();
      }),
  };
  return { cache, store, findCalls, saveCalls };
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
/** ⑧用（T-055追加）。日本基準の営業利益タグ */
const OPERATING_INCOME_ELEMENT = 'jppfs_cor:OperatingIncome';

/**
 * ⑧用（T-055追加）。営業利益（offset0・offset1）＋売上高（offset0・offset1）だけを持つ
 * 構成CSV行。売上高は常に1,000,000,000,000円（1兆円）に固定し、`operatingIncome` を
 * 変えるだけで%を制御できるようにする（例: 100000000000 → 10%）。
 */
function marginRows(
  operatingIncomeOffset0: string,
  operatingIncomeOffset1: string,
): readonly string[] {
  return [
    csvRow(OPERATING_INCOME_ELEMENT, 'CurrentYearDuration', 'JPY', '円', operatingIncomeOffset0),
    csvRow(OPERATING_INCOME_ELEMENT, 'Prior1YearDuration', 'JPY', '円', operatingIncomeOffset1),
    csvRow(REVENUE_ELEMENT, 'CurrentYearDuration', 'JPY', '円', '1000000000000'),
    csvRow(REVENUE_ELEMENT, 'Prior1YearDuration', 'JPY', '円', '1000000000000'),
  ];
}

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

/**
 * `Y`（latest）・`Y-1`（prior）の2本だけを返す。`Y-3`（third）は無い（`findDocId` が
 * `fiscalYear=2023`には`null`を返す）。
 */
function indexOfBoth(): EdinetDocumentIndexLookup {
  return {
    findLatest: () =>
      Promise.resolve({
        companyCode: '9433',
        fiscalYear: 2026,
        docId: 'S100YKG2',
        submittedAt: '2026-06-25T06:30:00.000Z',
      }),
    findDocId: (_companyCode, fiscalYear) =>
      Promise.resolve(
        fiscalYear === 2025
          ? {
              companyCode: '9433',
              fiscalYear: 2025,
              docId: 'S100VXGZ',
              submittedAt: '2025-06-13T00:00:00.000Z',
            }
          : null,
      ),
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

/** `Y-3` のdocID（T-055用の合成docID。実在の書類ではない） */
const THIRD_DOC_ID = 'S100T023';

/**
 * `Y`（latest・2026）/`Y-1`（prior・2025）/`Y-3`（third・2023）の3本構成（T-055）。
 * `findDocId`の`fiscalYear`引数で出し分ける。`Y-2`（2024）は要求されない前提のテストで
 * `null`を返す（要求されたら回帰: §4.2「Y-2を取得しに行っていないことの回帰テスト」）。
 */
function indexOfThree(): EdinetDocumentIndexLookup {
  return {
    findLatest: () =>
      Promise.resolve({
        companyCode: '9433',
        fiscalYear: 2026,
        docId: 'S100YKG2',
        submittedAt: '2026-06-25T06:30:00.000Z',
      }),
    findDocId: (_companyCode, fiscalYear) => {
      if (fiscalYear === 2025) {
        return Promise.resolve({
          companyCode: '9433',
          fiscalYear: 2025,
          docId: 'S100VXGZ',
          submittedAt: '2025-06-13T00:00:00.000Z',
        });
      }
      if (fiscalYear === 2023) {
        return Promise.resolve({
          companyCode: '9433',
          fiscalYear: 2023,
          docId: THIRD_DOC_ID,
          submittedAt: '2023-06-20T00:00:00.000Z',
        });
      }
      return Promise.resolve(null);
    },
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
      roePercent: 13.93,
      sourceDocId: 'S100YKG2',
      // 実物フィクスチャ（S100YKG2）の営業利益・売上高（当期）から算出した実測値（T-055）
      operatingMarginPercent: 18.101785021694145,
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

  it('⑤用: parseSummaryCsv の roePercentByOffset が mergeEdinetFilings 経由で years[].roePercent に届く（配線確認）', async () => {
    const fetchImpl = vi.fn<FetchImpl>(() => Promise.resolve(zipResponse()));
    const { client: target } = client(fetchImpl);

    const result = await target.fetchHistory('9433', indexWithLatestOnly());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 設計書 §2.8・§7.6 の実測値（年度降順）
    expect(result.value.years.map((year) => year.roePercent)).toEqual([
      13.93, 13.02, 11.57, 12.86, 13.5,
    ]);
  });
});

describe('fetchHistory — 1年前有報の取得が失敗しても最新有報の5期分は成功する（CR-5の回帰テスト）', () => {
  /** `Y-3`（third）は無い（`findDocId` が `fiscalYear=2023`には`null`を返す） */
  function indexWithBothEntries(): EdinetDocumentIndexLookup {
    return {
      findLatest: () =>
        Promise.resolve({
          companyCode: '9433',
          fiscalYear: 2026,
          docId: 'S100YKG2',
          submittedAt: '2026-06-25T06:30:00.000Z',
        }),
      findDocId: (_companyCode, fiscalYear) =>
        Promise.resolve(
          fiscalYear === 2025
            ? {
                companyCode: '9433',
                fiscalYear: 2025,
                docId: 'S100VXGZ',
                submittedAt: '2025-06-13T00:00:00.000Z',
              }
            : null,
        ),
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

/**
 * `Y-3`（third）有報の取得（T-055。`docs/02_design/logic/edinet-history-import.md`
 * §4.7.1・§4.7.2・§4.7.4・§7.7）。
 */
describe('fetchHistory — Y-3(third)有報の取得と⑧営業利益率（T-055）', () => {
  it('① 3本すべて取得成功: fetch が3回呼ばれ、operatingMarginPercent が5期埋まる', async () => {
    const fetchImpl = vi.fn<FetchImpl>((url) => {
      const urlString = String(url);
      if (urlString.includes('/documents/S100YKG2')) {
        return Promise.resolve(zipResponseOf(marginRows('100000000000', '90000000000')));
      }
      if (urlString.includes('/documents/S100VXGZ')) {
        return Promise.resolve(zipResponseOf(marginRows('500000000000', '80000000000')));
      }
      if (urlString.includes(`/documents/${THIRD_DOC_ID}`)) {
        return Promise.resolve(zipResponseOf(marginRows('70000000000', '60000000000')));
      }
      throw new Error(`unexpected url: ${urlString}`);
    });
    const { client: target } = client(fetchImpl);

    const result = await target.fetchHistory('9433', indexOfThree());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    // Y=10%・Y-1=9%（latest経由）・Y-2=8%（prior経由）・Y-3=7%・Y-4=6%（third経由）・6期目は常に null。
    // 7は浮動小数点演算の丸め誤差（`deriveOperatingMarginPercent`の既存挙動）を許容する
    expect(result.value.years.map((year) => year.operatingMarginPercent)).toEqual([
      10,
      9,
      8,
      expect.closeTo(7, 9),
      6,
      null,
    ]);
  });

  it('② Y-3 のみ取得失敗: ④⑦⑤⑥ は成功、⑧ の Y-3・Y-4 のみ null になる', async () => {
    const fetchImpl = vi.fn<FetchImpl>((url) => {
      const urlString = String(url);
      if (urlString.includes(`/documents/${THIRD_DOC_ID}`)) {
        // Y-3有報のZIPが壊れている
        return Promise.resolve(new Response(new Uint8Array([0x00, 0x01, 0x02]), { status: 200 }));
      }
      if (urlString.includes('/documents/S100YKG2')) {
        return Promise.resolve(zipResponseOf(marginRows('100000000000', '90000000000')));
      }
      return Promise.resolve(zipResponseOf(marginRows('500000000000', '80000000000')));
    });
    const { client: target } = client(fetchImpl);

    const result = await target.fetchHistory('9433', indexOfThree());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // prior は成功しているので6期目まで埋まる（④⑦⑤⑥は影響を受けない）
    expect(result.value.years).toHaveLength(6);
    expect(result.value.years.map((year) => year.operatingMarginPercent)).toEqual([
      10, 9, 8, null, null, null,
    ]);
  });

  it('③ Y-1 のみ取得失敗: ④⑦⑤⑥ は成功、⑧ は Y-2 のみ null（Y-1 は null にならない）', async () => {
    const fetchImpl = vi.fn<FetchImpl>((url) => {
      const urlString = String(url);
      if (urlString.includes('/documents/S100VXGZ')) {
        // Y-1有報のZIPが壊れている
        return Promise.resolve(new Response(new Uint8Array([0x00, 0x01, 0x02]), { status: 200 }));
      }
      if (urlString.includes('/documents/S100YKG2')) {
        return Promise.resolve(zipResponseOf(marginRows('100000000000', '90000000000')));
      }
      return Promise.resolve(zipResponseOf(marginRows('70000000000', '60000000000')));
    });
    const { client: target } = client(fetchImpl);

    const result = await target.fetchHistory('9433', indexOfThree());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // prior 失敗のため6期目（五期前）は作られない（CR-5の既存挙動）
    expect(result.value.years).toHaveLength(5);
    expect(result.value.years.map((year) => year.operatingMarginPercent)).toEqual([
      10,
      9,
      null,
      expect.closeTo(7, 9),
      6,
    ]);
  });

  it('④ Y 自体が取得失敗（findLatest が null）: document-not-found で全体失敗（④⑦⑤⑥⑧すべて対象外）', async () => {
    const fetchImpl = vi.fn<FetchImpl>();
    const { client: target } = client(fetchImpl);

    const result = await target.fetchHistory('9433', emptyIndex);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({ kind: 'document-not-found', code: '9433' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('⑤ Y-2 を取得しに行っていないことの回帰テスト（findDocId の呼び出し引数をスパイ）', async () => {
    const findDocId = vi.fn((_companyCode: string, fiscalYear: number) => {
      if (fiscalYear === 2025) {
        return Promise.resolve({
          companyCode: '9433',
          fiscalYear: 2025,
          docId: 'S100VXGZ',
          submittedAt: '2025-06-13T00:00:00.000Z',
        });
      }
      if (fiscalYear === 2023) {
        return Promise.resolve({
          companyCode: '9433',
          fiscalYear: 2023,
          docId: THIRD_DOC_ID,
          submittedAt: '2023-06-20T00:00:00.000Z',
        });
      }
      return Promise.resolve(null);
    });
    const index: EdinetDocumentIndexLookup = {
      findLatest: () =>
        Promise.resolve({
          companyCode: '9433',
          fiscalYear: 2026,
          docId: 'S100YKG2',
          submittedAt: '2026-06-25T06:30:00.000Z',
        }),
      findDocId,
    };
    const fetchImpl = vi.fn<FetchImpl>(() => Promise.resolve(zipResponse()));
    const { client: target } = client(fetchImpl);

    await target.fetchHistory('9433', index);

    const requestedFiscalYears = findDocId.mock.calls.map((call) => call[1]);
    expect(requestedFiscalYears).not.toContain(2024);
    expect(requestedFiscalYears).toEqual(expect.arrayContaining([2025, 2023]));
  });

  it('⑥ セグメント別内訳（コンテキストIDが違う行）を営業利益として拾わない', async () => {
    const rows = [
      ...marginRows('100000000000', '90000000000'),
      // セグメント別の内訳行。コンテキストIDが完全一致しないため無視されるべき
      csvRow(
        OPERATING_INCOME_ELEMENT,
        'CurrentYearDuration_ReportableSegmentsMember',
        'JPY',
        '円',
        '999999999999',
      ),
    ];
    const fetchImpl = vi.fn<FetchImpl>(() => Promise.resolve(zipResponseOf(rows)));
    const { client: target } = client(fetchImpl);

    const result = await target.fetchHistory('9433', indexOfLatestOnly());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // セグメント値（999999999999→99.9999...%相当）ではなく連結値（10%）が使われる
    expect(result.value.years[0]?.operatingMarginPercent).toBe(10);
  });

  it('⑦ 営業利益の単位が円以外: unit-mismatch 診断が残り、値は不採用（operatingMarginPercent は null）', async () => {
    const rows = [
      csvRow(OPERATING_INCOME_ELEMENT, 'CurrentYearDuration', 'JPY', '百万円', '1000'),
      csvRow(REVENUE_ELEMENT, 'CurrentYearDuration', 'JPY', '円', '1000000000000'),
    ];
    const fetchImpl = vi.fn<FetchImpl>(() => Promise.resolve(zipResponseOf(rows)));
    const { client: target } = client(fetchImpl);

    const result = await target.fetchHistory('9433', indexOfLatestOnly());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.years[0]?.operatingMarginPercent).toBeNull();
    expect(result.value.diagnostics).toContainEqual(
      expect.objectContaining({
        field: 'operatingIncome',
        reason: 'unit-mismatch',
        sourceDocId: 'S100YKG2',
      }),
    );
  });

  it('⑧ 営業利益が未使用タグ（"－"）: 0 にせず null になる', async () => {
    const rows = [
      csvRow(OPERATING_INCOME_ELEMENT, 'CurrentYearDuration', 'JPY', '円', String.fromCharCode(0xff0d)),
      csvRow(REVENUE_ELEMENT, 'CurrentYearDuration', 'JPY', '円', '1000000000000'),
    ];
    const fetchImpl = vi.fn<FetchImpl>(() => Promise.resolve(zipResponseOf(rows)));
    const { client: target } = client(fetchImpl);

    const result = await target.fetchHistory('9433', indexOfLatestOnly());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.years[0]?.operatingMarginPercent).toBeNull();
  });

  it('⑨ 金融業（営業利益の候補要素IDがどれも解決しない）: ⑧は null、④⑦⑤⑥ は影響を受けない（🟡 実フィクスチャ無しのため構成CSVで模擬。§2.9.3で「未実測」と明記する）', async () => {
    const rows = [
      csvRow(EPS_ELEMENT, 'CurrentYearDuration', 'JPYPerShares', '円', '183.59'),
      csvRow(REVENUE_ELEMENT, 'CurrentYearDuration', 'JPY', '円', '6071915000000'),
      // 営業利益の候補要素ID（jppfs_cor:OperatingIncome / jpigp_cor:OperatingProfitLossIFRS）を
      // どちらも含まない（金融業は損益計算書の様式が異なり、これらのタグを持たない。§2.9.3）
    ];
    const fetchImpl = vi.fn<FetchImpl>(() => Promise.resolve(zipResponseOf(rows)));
    const { client: target } = client(fetchImpl);

    const result = await target.fetchHistory('9433', indexOfLatestOnly());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.years[0]?.operatingMarginPercent).toBeNull();
    expect(result.value.years[0]?.epsSen).toBe(18359);
    expect(result.value.years[0]?.revenueSen).toBe(607191500000000);
  });
});

/**
 * §7.7 実測値の突き合わせ（CR-1）。9433 FY2026（`years[0]`）は
 * 「fetchHistory — 取得成功（実物ZIPフィクスチャ）」で既に検証済み。ここでは残り3値
 * （9433 FY2025・1301 FY2026・1301 FY2025）を実物ZIPフィクスチャで検証する。
 *
 * `S100VXGZ.zip`・`1301-fy2026-S100YE8K.zip` は、既存の実物CSVフィクスチャ
 * （`9433-fy2025-S100VXGZ.csv`・`1301-fy2026-S100YE8K.csv`。実データをそのまま
 * `XBRL_TO_CSV/jpcrp030000-asr-*.csv` としてZIP化しただけで、値は一切加工していない）
 * から作成した。金融業の項目（§2.9.3・§7.7末尾）とは異なり、フィクスチャが揃っているため
 * 「🟡 未実測」の対象ではない。
 */
describe('fetchHistory — §7.7 実測値の突き合わせ（実物ZIPフィクスチャ。CR-1）', () => {
  function fixtureZipBytes(name: string): Uint8Array {
    const buffer = readFileSync(
      fileURLToPath(new URL(`../../fixtures/edinet/${name}`, import.meta.url)),
    );
    return new Uint8Array(buffer);
  }

  it('9433 FY2025（years[1]）= 18.64%（実測値18.635307020362347%）。latest(S100YKG2)のoffset1のみから導出され、prior(S100VXGZ)の実在有無に左右されない', async () => {
    const fetchImpl = vi.fn<FetchImpl>((url) => {
      const urlString = String(url);
      if (urlString.includes('/documents/S100VXGZ')) {
        return Promise.resolve(new Response(fixtureZipBytes('S100VXGZ.zip'), { status: 200 }));
      }
      return Promise.resolve(zipResponse()); // S100YKG2.zip（latest）
    });
    const { client: target } = client(fetchImpl);

    const result = await target.fetchHistory('9433', indexOfBoth());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.years[1]).toMatchObject({
      fiscalYear: 2025,
      sourceDocId: 'S100YKG2',
      operatingMarginPercent: 18.635307020362347,
    });
  });

  it('1301 FY2026（years[0]）= 3.21%・FY2025（years[1]）= 3.66%（実測値。実物ZIP S100YE8K から）', async () => {
    const fetchImpl = vi.fn<FetchImpl>(() =>
      Promise.resolve(
        new Response(fixtureZipBytes('1301-fy2026-S100YE8K.zip'), { status: 200 }),
      ),
    );
    const { client: target } = client(fetchImpl);
    const index: EdinetDocumentIndexLookup = {
      findLatest: () =>
        Promise.resolve({
          companyCode: '1301',
          fiscalYear: 2026,
          docId: 'S100YE8K',
          submittedAt: '2026-06-25T00:00:00.000Z',
        }),
      findDocId: () => Promise.resolve(null),
    };

    const result = await target.fetchHistory('1301', index);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.years[0]).toMatchObject({
      fiscalYear: 2026,
      sourceDocId: 'S100YE8K',
      operatingMarginPercent: 3.2069979558413926,
    });
    expect(result.value.years[1]).toMatchObject({
      fiscalYear: 2025,
      sourceDocId: 'S100YE8K',
      operatingMarginPercent: 3.660289215378567,
    });
  });
});

/**
 * パース結果キャッシュ（`docs/02_design/logic/edinet-history-import.md` §4.8・§7.8）。
 * ヒット・ミスの基本動作は `fetch` スパイの呼び出し回数で検証する。
 */
describe('パース結果キャッシュ — ヒット・ミスの基本動作', () => {
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

  it('同一 docId を2回要求すると、2回目は fetch が呼ばれず、1回目と等値（diagnostics 込み）', async () => {
    const fetchImpl = vi.fn<FetchImpl>(() => Promise.resolve(zipResponse()));
    const { cache } = fakeSummaryCache();
    const { client: target } = client(fetchImpl, cache);

    const first = await target.fetchHistory('9433', indexWithLatestOnly());
    const callsAfterFirst = fetchImpl.mock.calls.length;
    const second = await target.fetchHistory('9433', indexWithLatestOnly());

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second).toEqual(first);
    // 1回目で1回 fetch（latest のみ。prior 無し）。2回目はキャッシュヒットで増えない
    expect(callsAfterFirst).toBe(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('未キャッシュの docId は従来どおり取得し、成功したら保存する', async () => {
    const fetchImpl = vi.fn<FetchImpl>(() => Promise.resolve(zipResponse()));
    const { cache, store, saveCalls } = fakeSummaryCache();
    const { client: target } = client(fetchImpl, cache);

    const result = await target.fetchHistory('9433', indexWithLatestOnly());

    expect(result.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(saveCalls).toEqual(['S100YKG2']);
    expect(store.has('S100YKG2')).toBe(true);
  });

  it('summaryCache を渡さない場合、毎回 fetch する（従来の挙動）', async () => {
    const fetchImpl = vi.fn<FetchImpl>(() => Promise.resolve(zipResponse()));
    const { client: target } = client(fetchImpl); // summaryCache 省略

    await target.fetchHistory('9433', indexWithLatestOnly());
    await target.fetchHistory('9433', indexWithLatestOnly());

    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  /**
   * 設計書 §7.8 は `Y`/`Y-1`/`Y-3` の3本構成で「`Y` だけキャッシュ済みなら `fetch` は
   * 2回だけ」と定めている（T-055 で `fetchHistory` が3本構成になったことで検証可能になった）。
   */
  it('Y のみキャッシュ済みなら、fetch は2回だけ呼ばれる（Y-1・Y-3）', async () => {
    const fetchImpl = vi.fn<FetchImpl>((url) => {
      const urlString = String(url);
      if (urlString.includes(`/documents/${THIRD_DOC_ID}`)) {
        return Promise.resolve(zipResponseOf(marginRows('70000000000', '60000000000')));
      }
      return Promise.resolve(zipResponse());
    });
    const { cache, store } = fakeSummaryCache();
    store.set('S100YKG2', {
      epsSenByOffset: [1, null, null, null, null],
      revenueSenByOffset: [null, null, null, null, null],
      roePercentByOffset: [null, null, null, null, null],
      operatingIncomeSenByOffset: [null, null],
      balanceSheet: { currentAssetsSen: null, investmentSecuritiesSen: null },
      diagnostics: [],
    });
    const { client: target } = client(fetchImpl, cache);

    const result = await target.fetchHistory('9433', indexOfThree());

    expect(result.ok).toBe(true);
    // latest（S100YKG2）はキャッシュヒットで fetch しない。prior（S100VXGZ）・third（Y-3）を fetch する
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const requestedUrls = fetchImpl.mock.calls.map((call) => String(call[0]));
    expect(requestedUrls.some((url) => url.includes('/documents/S100VXGZ'))).toBe(true);
    expect(requestedUrls.some((url) => url.includes(`/documents/${THIRD_DOC_ID}`))).toBe(true);
  });
});

describe('パース結果キャッシュ — 失敗時の堅牢性（§4.8.5・§7.8）', () => {
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

  it('find() が例外を投げても取り込みは成功する（ミス扱いで取得へ進む）', async () => {
    const fetchImpl = vi.fn<FetchImpl>(() => Promise.resolve(zipResponse()));
    const cache: EdinetDocumentSummaryCache = {
      find: () => Promise.reject(new Error('boom')),
      save: () => Promise.resolve(),
    };
    const { client: target } = client(fetchImpl, cache);

    const result = await target.fetchHistory('9433', indexWithLatestOnly());

    expect(result.ok).toBe(true);
    // ミス扱いに倒れ、通常どおりネットワークから取得している
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('save() が失敗しても取り込みは成功として返り、console.error にだけ残る', async () => {
    const fetchImpl = vi.fn<FetchImpl>(() => Promise.resolve(zipResponse()));
    const cache: EdinetDocumentSummaryCache = {
      find: () => Promise.resolve(null),
      save: () => Promise.reject(new Error('boom')),
    };
    const { client: target } = client(fetchImpl, cache);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {
      /* 出力を抑制 */
    });

    const result = await target.fetchHistory('9433', indexWithLatestOnly());

    expect(result.ok).toBe(true);
    expect(errorSpy).toHaveBeenCalled();
    // エラーメッセージに内部情報（スタックトレース等）を含めない（`.claude/rules/backend.md`）
    const loggedArgs = errorSpy.mock.calls.flat().map((argument) => String(argument));
    expect(loggedArgs.some((argument) => argument.includes('at '))).toBe(false);

    errorSpy.mockRestore();
  });

  it('パース（ZIP展開）に失敗した書類は保存しない', async () => {
    // 壊れたZIP応答。unzipSummaryCsv が失敗し、fetchDocumentSummaryFromNetwork が
    // err を返すため、writeToCache（save）は呼ばれないはず
    const fetchImpl = vi.fn<FetchImpl>(() =>
      Promise.resolve(new Response(new Uint8Array([0x00, 0x01, 0x02]), { status: 200 })),
    );
    const { cache, saveCalls } = fakeSummaryCache();
    const { client: target } = client(fetchImpl, cache);

    const result = await target.fetchHistory('9433', indexWithLatestOnly());

    expect(result.ok).toBe(false);
    expect(saveCalls).toEqual([]);
  });
});
