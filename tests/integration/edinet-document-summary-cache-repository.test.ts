import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type EdinetDocumentSummary } from '@/infra/edinet/document-summary-cache';
import { D1EdinetDocumentSummaryCacheRepository } from '@/infra/d1/edinet-document-summary-cache-repository';

/**
 * `D1EdinetDocumentSummaryCacheRepository` — 永続化ラウンドトリップ・
 * `schema_version` 不一致時のミス扱い・壊れたJSONのミス扱い・`clearAll`。
 * 仕様: `docs/02_design/logic/edinet-history-import.md` §4.8・§7.8
 */

beforeEach(async () => {
  await env.DB.exec('DELETE FROM edinet_document_summary');
});

function summary(overrides: Partial<EdinetDocumentSummary> = {}): EdinetDocumentSummary {
  return {
    epsSenByOffset: [18_359, 15_001, null, null, null],
    revenueSenByOffset: [607_191_500_000_000, null, null, null, null],
    roePercentByOffset: [13.93, null, null, null, null],
    operatingIncomeSenByOffset: [109_912_500_000_000, 108_746_800_000_000],
    balanceSheet: { currentAssetsSen: 470_650_700_000_000, investmentSecuritiesSen: null },
    diagnostics: [
      {
        field: 'eps',
        offset: 0,
        elementId: 'jpcrp_cor:BasicEarningsLossPerShareSummaryOfBusinessResults',
        reason: 'unit-mismatch',
        raw: 'unitId=JPY',
      },
    ],
    ...overrides,
  };
}

describe('find — 未登録時は null（例外にしない）', () => {
  it('未保存の docId は null を返す', async () => {
    const repository = new D1EdinetDocumentSummaryCacheRepository(env.DB);
    expect(await repository.find('S100YKG2')).toBeNull();
  });
});

describe('save / find — 永続化ラウンドトリップ', () => {
  it('保存した内容（diagnostics 含む）をそのまま復元できる', async () => {
    const repository = new D1EdinetDocumentSummaryCacheRepository(env.DB);
    const value = summary();

    await repository.save('S100YKG2', value);
    const found = await repository.find('S100YKG2');

    expect(found).toEqual(value);
  });

  it('同じ docId への再 save は上書きする（行数が増えない）', async () => {
    const repository = new D1EdinetDocumentSummaryCacheRepository(env.DB);
    await repository.save('S100YKG2', summary());
    await repository.save('S100YKG2', summary({ epsSenByOffset: [1, 2, 3, 4, 5] }));

    const row = await env.DB.prepare(
      'SELECT COUNT(*) AS count FROM edinet_document_summary',
    ).first<{ count: number }>();
    expect(row?.count).toBe(1);

    const found = await repository.find('S100YKG2');
    expect(found?.epsSenByOffset).toEqual([1, 2, 3, 4, 5]);
  });

  it('別の docId は独立して保存される', async () => {
    const repository = new D1EdinetDocumentSummaryCacheRepository(env.DB);
    await repository.save('S100YKG2', summary({ epsSenByOffset: [1, null, null, null, null] }));
    await repository.save('S100VXGZ', summary({ epsSenByOffset: [2, null, null, null, null] }));

    expect((await repository.find('S100YKG2'))?.epsSenByOffset[0]).toBe(1);
    expect((await repository.find('S100VXGZ'))?.epsSenByOffset[0]).toBe(2);
  });
});

describe('schema_version 不一致 — ミス扱い（取り直し）', () => {
  it('現行版と異なる schema_version の行は null を返す', async () => {
    await env.DB.prepare(
      'INSERT INTO edinet_document_summary (doc_id, schema_version, payload, cached_at) VALUES (?, ?, ?, ?)',
    )
      .bind('S100YKG2', 0, JSON.stringify(summary()), '2026-08-01T00:00:00.000Z')
      .run();

    const repository = new D1EdinetDocumentSummaryCacheRepository(env.DB);
    expect(await repository.find('S100YKG2')).toBeNull();
  });

  it('取り直し後に save すると、現行版で上書き保存される（古い版の行が残らない）', async () => {
    await env.DB.prepare(
      'INSERT INTO edinet_document_summary (doc_id, schema_version, payload, cached_at) VALUES (?, ?, ?, ?)',
    )
      .bind('S100YKG2', 0, JSON.stringify(summary()), '2026-08-01T00:00:00.000Z')
      .run();

    const repository = new D1EdinetDocumentSummaryCacheRepository(env.DB);
    // ミス扱いで取り直した想定の再保存
    await repository.save('S100YKG2', summary({ epsSenByOffset: [9, null, null, null, null] }));

    const row = await env.DB.prepare(
      'SELECT COUNT(*) AS count FROM edinet_document_summary',
    ).first<{ count: number }>();
    expect(row?.count).toBe(1);

    const found = await repository.find('S100YKG2');
    expect(found?.epsSenByOffset[0]).toBe(9);

    const raw = await env.DB.prepare(
      'SELECT schema_version AS schemaVersion FROM edinet_document_summary WHERE doc_id = ?',
    )
      .bind('S100YKG2')
      .first<{ schemaVersion: number }>();
    expect(raw?.schemaVersion).toBe(2);
  });

  it('T-054: schema_version = 1（operatingIncomeSenByOffset を持たない旧形式）の行は null を返す', async () => {
    // T-054適用前の実データを模した行。旧形式の EdinetDocumentSummary から
    // operatingIncomeSenByOffset を除いたペイロードを、schema_version=1（旧版）で保存する
    const legacyPayload = { ...summary() } as Record<string, unknown>;
    delete legacyPayload['operatingIncomeSenByOffset'];
    await env.DB.prepare(
      'INSERT INTO edinet_document_summary (doc_id, schema_version, payload, cached_at) VALUES (?, ?, ?, ?)',
    )
      .bind('S100YKG2', 1, JSON.stringify(legacyPayload), '2026-08-01T00:00:00.000Z')
      .run();

    const repository = new D1EdinetDocumentSummaryCacheRepository(env.DB);
    // schema_version(1) !== CURRENT_SCHEMA_VERSION(2) の分岐で弾かれる
    // （isWellFormed の長さチェックに到達する前段）
    expect(await repository.find('S100YKG2')).toBeNull();
  });
});

describe('壊れたJSON — ミス扱い（例外を投げない）', () => {
  it('payload が JSON として壊れている行は null を返す', async () => {
    await env.DB.prepare(
      'INSERT INTO edinet_document_summary (doc_id, schema_version, payload, cached_at) VALUES (?, ?, ?, ?)',
    )
      .bind('S100YKG2', 2, '{ こわれた', '2026-08-01T00:00:00.000Z')
      .run();

    const repository = new D1EdinetDocumentSummaryCacheRepository(env.DB);
    await expect(repository.find('S100YKG2')).resolves.toBeNull();
  });

  it('epsSenByOffset の長さが5でない行は null を返す', async () => {
    const malformed = { ...summary(), epsSenByOffset: [1, 2, 3] };
    await env.DB.prepare(
      'INSERT INTO edinet_document_summary (doc_id, schema_version, payload, cached_at) VALUES (?, ?, ?, ?)',
    )
      .bind('S100YKG2', 2, JSON.stringify(malformed), '2026-08-01T00:00:00.000Z')
      .run();

    const repository = new D1EdinetDocumentSummaryCacheRepository(env.DB);
    expect(await repository.find('S100YKG2')).toBeNull();
  });

  it('payload が配列でない（オブジェクトそのものが壊れている）行は null を返す', async () => {
    await env.DB.prepare(
      'INSERT INTO edinet_document_summary (doc_id, schema_version, payload, cached_at) VALUES (?, ?, ?, ?)',
    )
      .bind('S100YKG2', 2, JSON.stringify({ foo: 'bar' }), '2026-08-01T00:00:00.000Z')
      .run();

    const repository = new D1EdinetDocumentSummaryCacheRepository(env.DB);
    expect(await repository.find('S100YKG2')).toBeNull();
  });

  it('diagnostics が配列でない壊れた行は null を返す', async () => {
    const malformed = { ...summary(), diagnostics: 'not-an-array' };
    await env.DB.prepare(
      'INSERT INTO edinet_document_summary (doc_id, schema_version, payload, cached_at) VALUES (?, ?, ?, ?)',
    )
      .bind('S100YKG2', 2, JSON.stringify(malformed), '2026-08-01T00:00:00.000Z')
      .run();

    const repository = new D1EdinetDocumentSummaryCacheRepository(env.DB);
    expect(await repository.find('S100YKG2')).toBeNull();
  });

  it('diagnostics が欠損（undefined）している行は null を返す', async () => {
    const withoutDiagnostics: Record<string, unknown> = { ...summary() };
    delete withoutDiagnostics['diagnostics'];
    await env.DB.prepare(
      'INSERT INTO edinet_document_summary (doc_id, schema_version, payload, cached_at) VALUES (?, ?, ?, ?)',
    )
      .bind('S100YKG2', 2, JSON.stringify(withoutDiagnostics), '2026-08-01T00:00:00.000Z')
      .run();

    const repository = new D1EdinetDocumentSummaryCacheRepository(env.DB);
    expect(await repository.find('S100YKG2')).toBeNull();
  });

  it('T-054: operatingIncomeSenByOffset が欠損している行は null を返す', async () => {
    const withoutOperatingIncome: Record<string, unknown> = { ...summary() };
    delete withoutOperatingIncome['operatingIncomeSenByOffset'];
    await env.DB.prepare(
      'INSERT INTO edinet_document_summary (doc_id, schema_version, payload, cached_at) VALUES (?, ?, ?, ?)',
    )
      .bind('S100YKG2', 2, JSON.stringify(withoutOperatingIncome), '2026-08-01T00:00:00.000Z')
      .run();

    const repository = new D1EdinetDocumentSummaryCacheRepository(env.DB);
    expect(await repository.find('S100YKG2')).toBeNull();
  });

  it('T-054: operatingIncomeSenByOffset の長さが2でない（長さ1）行は null を返す', async () => {
    const malformed = { ...summary(), operatingIncomeSenByOffset: [109_912_500_000_000] };
    await env.DB.prepare(
      'INSERT INTO edinet_document_summary (doc_id, schema_version, payload, cached_at) VALUES (?, ?, ?, ?)',
    )
      .bind('S100YKG2', 2, JSON.stringify(malformed), '2026-08-01T00:00:00.000Z')
      .run();

    const repository = new D1EdinetDocumentSummaryCacheRepository(env.DB);
    expect(await repository.find('S100YKG2')).toBeNull();
  });

  it('T-054: operatingIncomeSenByOffset の長さが2でない（長さ3）行は null を返す', async () => {
    const malformed = {
      ...summary(),
      operatingIncomeSenByOffset: [109_912_500_000_000, 108_746_800_000_000, null],
    };
    await env.DB.prepare(
      'INSERT INTO edinet_document_summary (doc_id, schema_version, payload, cached_at) VALUES (?, ?, ?, ?)',
    )
      .bind('S100YKG2', 2, JSON.stringify(malformed), '2026-08-01T00:00:00.000Z')
      .run();

    const repository = new D1EdinetDocumentSummaryCacheRepository(env.DB);
    expect(await repository.find('S100YKG2')).toBeNull();
  });
});

/** D1 への問い合わせそのものが例外を投げる状況を再現する最小限のフェイク（CR-2） */
function createThrowingDatabase(): D1Database {
  return {
    prepare(): never {
      throw new Error('D1 unavailable (test double)');
    },
  } as unknown as D1Database;
}

describe('find/save — D1 由来の例外はリポジトリ単体でも throw しない（CR-2）', () => {
  it('find(): クエリ発行が例外を投げても null を返す', async () => {
    const repository = new D1EdinetDocumentSummaryCacheRepository(createThrowingDatabase());
    await expect(repository.find('S100YKG2')).resolves.toBeNull();
  });

  it('save(): 書き込みが例外を投げても reject せず、console.error にだけ残す', async () => {
    const repository = new D1EdinetDocumentSummaryCacheRepository(createThrowingDatabase());
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(repository.save('S100YKG2', summary())).resolves.toBeUndefined();
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    consoleErrorSpy.mockRestore();
  });
});

describe('clearAll — 全行削除（管理用）', () => {
  it('全行を削除し、削除件数を返す', async () => {
    const repository = new D1EdinetDocumentSummaryCacheRepository(env.DB);
    await repository.save('S100YKG2', summary());
    await repository.save('S100VXGZ', summary());

    const cleared = await repository.clearAll();

    expect(cleared).toBe(2);
    const row = await env.DB.prepare(
      'SELECT COUNT(*) AS count FROM edinet_document_summary',
    ).first<{ count: number }>();
    expect(row?.count).toBe(0);
  });

  it('行が0件でも例外にならず 0 を返す', async () => {
    const repository = new D1EdinetDocumentSummaryCacheRepository(env.DB);
    expect(await repository.clearAll()).toBe(0);
  });
});
