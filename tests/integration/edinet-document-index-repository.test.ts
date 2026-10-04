import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

import { type EdinetDocumentIndexEntry } from '@/domain/company/edinet-document-index';
import { D1EdinetDocumentIndexRepository } from '@/infra/d1/edinet-document-index-repository';

/**
 * `D1EdinetDocumentIndexRepository` — `upsertMany` の冪等性・チャンク分割INSERT・
 * `findDocId`/`findLatest` の未登録時 `null`・`lastRefreshedAt`。
 * 仕様: `docs/02_design/logic/edinet-history-import.md` §7.3
 */

beforeEach(async () => {
  await env.DB.exec('DELETE FROM edinet_document_index');
  await env.DB.exec('DELETE FROM edinet_refresh_log');
});

function entry(overrides: Partial<EdinetDocumentIndexEntry> = {}): EdinetDocumentIndexEntry {
  return {
    companyCode: '9433',
    fiscalYear: 2026,
    docId: 'S100YKG2',
    submittedAt: '2026-06-25T06:30:00.000Z',
    ...overrides,
  };
}

describe('findDocId / findLatest — 未登録時は null（例外にしない）', () => {
  it('findDocId', async () => {
    const repository = new D1EdinetDocumentIndexRepository(env.DB);
    expect(await repository.findDocId('9433', 2026)).toBeNull();
  });

  it('findLatest', async () => {
    const repository = new D1EdinetDocumentIndexRepository(env.DB);
    expect(await repository.findLatest('9433')).toBeNull();
  });
});

describe('upsertMany — 冪等性', () => {
  it('同じキーへの再 upsertMany は上書きする（行数が増えない）', async () => {
    const repository = new D1EdinetDocumentIndexRepository(env.DB);
    await repository.upsertMany([entry({ docId: 'FIRST' })]);
    await repository.upsertMany([
      entry({ docId: 'SECOND', submittedAt: '2026-06-26T00:00:00.000Z' }),
    ]);

    const row = await env.DB.prepare('SELECT COUNT(*) AS count FROM edinet_document_index').first<{
      count: number;
    }>();
    expect(row?.count).toBe(1);

    const found = await repository.findDocId('9433', 2026);
    expect(found?.docId).toBe('SECOND');
  });

  it('findLatest は決算年度が最大のエントリを返す', async () => {
    const repository = new D1EdinetDocumentIndexRepository(env.DB);
    await repository.upsertMany([
      entry({ fiscalYear: 2025, docId: 'OLD' }),
      entry({ fiscalYear: 2026, docId: 'NEW' }),
    ]);

    const latest = await repository.findLatest('9433');
    expect(latest?.docId).toBe('NEW');
    expect(latest?.fiscalYear).toBe(2026);
  });

  it('別銘柄の同じ決算年度は独立して保存される', async () => {
    const repository = new D1EdinetDocumentIndexRepository(env.DB);
    await repository.upsertMany([
      entry({ companyCode: '9433', docId: 'A' }),
      entry({ companyCode: '1301', docId: 'B' }),
    ]);

    expect((await repository.findDocId('9433', 2026))?.docId).toBe('A');
    expect((await repository.findDocId('1301', 2026))?.docId).toBe('B');
  });

  it('空配列を渡しても例外にならない', async () => {
    const repository = new D1EdinetDocumentIndexRepository(env.DB);
    await expect(repository.upsertMany([])).resolves.toBeUndefined();
  });

  it('150件規模（D1のバインド変数上限に触れる件数）でも冪等に保存できる', async () => {
    const repository = new D1EdinetDocumentIndexRepository(env.DB);
    // TODO(be-developer, 2026-08-08): 1,000社規模の実測はしていない（設計書
    // `docs/02_design/logic/edinet-history-import.md` §6・§9着手順2）。ここでは
    // D1_MAX_BOUND_PARAMETERS=100 に対し
    // edinet_document_index が4列（Math.floor(100/4)=25件/文が境界）となることを踏まえ、
    // 150件（6文相当）の構成データで upsertMany のチャンク分割・冪等性を検証する。
    // レート制限・所要時間の実測はデプロイ後の手動運用検証に委ねる（自動テストの範囲外）。
    const entries = Array.from({ length: 150 }, (_unused, index) => {
      const companyCode = String(1000 + index).padStart(4, '0');
      return entry({ companyCode, docId: `DOC${String(index)}` });
    });

    await repository.upsertMany(entries);
    const row = await env.DB.prepare('SELECT COUNT(*) AS count FROM edinet_document_index').first<{
      count: number;
    }>();
    expect(row?.count).toBe(150);

    // 再度同じ150件を upsert しても行数は増えない（冪等性）
    await repository.upsertMany(entries);
    const rowAfter = await env.DB.prepare(
      'SELECT COUNT(*) AS count FROM edinet_document_index',
    ).first<{ count: number }>();
    expect(rowAfter?.count).toBe(150);
  });

  // CR-7回帰テスト: 複数行を1文にまとめた `onConflictDoUpdate` で固定値を `set` に書くと、
  // 衝突した全行が同じ値に上書きされてしまうバグが実装前調査で判明した
  // （設計書 §7.3・be-plan.md §2「CR-7」）。`sql`excluded.<column>`` を使っていれば
  // 各行は自分自身の値で更新される。
  it('同一チャンク内の複数行がそれぞれ自分自身の値で更新される（固定値で全行が同じ値に潰れない）', async () => {
    const repository = new D1EdinetDocumentIndexRepository(env.DB);
    // 事前に2件登録
    await repository.upsertMany([
      entry({ companyCode: '1000', docId: 'OLD-A' }),
      entry({ companyCode: '2000', docId: 'OLD-B' }),
    ]);
    // 同じ1文（25行以下）に収まる複数行を、異なる docId で再 upsert
    await repository.upsertMany([
      entry({ companyCode: '1000', docId: 'NEW-A' }),
      entry({ companyCode: '2000', docId: 'NEW-B' }),
    ]);

    expect((await repository.findDocId('1000', 2026))?.docId).toBe('NEW-A');
    expect((await repository.findDocId('2000', 2026))?.docId).toBe('NEW-B');
  });
});

/**
 * 冗長インデックス削除（`db/migrations/0004_zippy_zaran.sql`）の回帰テスト。
 * マイグレーションを再生成し直したときに `idx_edinet_document_index_company` が
 * 誤って復活したら、ここで落ちる。
 */
describe('インデックス構成', () => {
  interface IndexListRow {
    readonly name: string;
  }

  async function indexNames(): Promise<readonly string[]> {
    const listed = await env.DB.prepare("PRAGMA index_list('edinet_document_index')").all();
    return (listed.results as unknown as readonly IndexListRow[]).map((row) => row.name);
  }

  it('company_code 単独のインデックスは存在しない（複合PKの前方一致で足りる）', async () => {
    expect(await indexNames()).not.toContain('idx_edinet_document_index_company');
  });

  it('複合主キー (company_code, fiscal_year) の autoindex は残っている', async () => {
    expect(await indexNames()).toContain('sqlite_autoindex_edinet_document_index_1');
  });
});

describe('lastRefreshedAt / recordRefresh', () => {
  it('recordRefresh 前は null（バッチ未実行）', async () => {
    const repository = new D1EdinetDocumentIndexRepository(env.DB);
    expect(await repository.lastRefreshedAt()).toBeNull();
  });

  it('recordRefresh 後は最新の実行時刻を返す', async () => {
    const repository = new D1EdinetDocumentIndexRepository(env.DB);
    await repository.recordRefresh('2026-08-07T21:00:00.000Z', 3);
    await repository.recordRefresh('2026-08-08T21:00:00.000Z', 0);

    expect(await repository.lastRefreshedAt()).toBe('2026-08-08T21:00:00.000Z');
  });

  it('対象書類が0件の日でも「正常終了した」ことを記録できる', async () => {
    const repository = new D1EdinetDocumentIndexRepository(env.DB);
    await repository.recordRefresh('2026-08-07T21:00:00.000Z', 0);

    expect(await repository.lastRefreshedAt()).toBe('2026-08-07T21:00:00.000Z');
  });
});
