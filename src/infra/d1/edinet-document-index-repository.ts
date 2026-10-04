/**
 * `EdinetDocumentIndexRepository` の D1 実装。
 *
 * ここだけが Drizzle と `D1Database` を知る。ドメインへは
 * ドメインの型（`EdinetDocumentIndexEntry`）に詰め替えて返す（`.claude/CLAUDE.md`）。
 */

import { type DrizzleD1Database, drizzle } from 'drizzle-orm/d1';
import { type BatchItem } from 'drizzle-orm/batch';
import { and, desc, eq, sql } from 'drizzle-orm';

import {
  type EdinetDocumentIndexEntry,
  type EdinetDocumentIndexRepository,
} from '../../domain/company/edinet-document-index';
import { maxRowsPerInsert } from './company-repository';
import { edinetDocumentIndex, edinetRefreshLog } from './schema';

/** `edinet_document_index`の列数（companyCode, fiscalYear, docId, submittedAt） */
const EDINET_DOCUMENT_INDEX_COLUMN_COUNT = 4;

/** 1文あたりのバインド変数上限を超えないように行を分割する（`company-repository.ts`と同じ考え方） */
function chunkRowsForInsert<T>(rows: readonly T[], columnCount: number): T[][] {
  if (rows.length === 0) return [];
  const rowsPerStatement = maxRowsPerInsert(columnCount);
  const chunks: T[][] = [];
  for (let index = 0; index < rows.length; index += rowsPerStatement) {
    chunks.push(rows.slice(index, index + rowsPerStatement));
  }
  return chunks;
}

export class D1EdinetDocumentIndexRepository implements EdinetDocumentIndexRepository {
  private readonly db: DrizzleD1Database;

  constructor(database: D1Database) {
    this.db = drizzle(database);
  }

  async findDocId(
    companyCode: string,
    fiscalYear: number,
  ): Promise<EdinetDocumentIndexEntry | null> {
    const rows = await this.db
      .select()
      .from(edinetDocumentIndex)
      .where(
        and(
          eq(edinetDocumentIndex.companyCode, companyCode),
          eq(edinetDocumentIndex.fiscalYear, fiscalYear),
        ),
      )
      .limit(1);
    const row = rows[0];
    return row === undefined ? null : row;
  }

  async findLatest(companyCode: string): Promise<EdinetDocumentIndexEntry | null> {
    const rows = await this.db
      .select()
      .from(edinetDocumentIndex)
      .where(eq(edinetDocumentIndex.companyCode, companyCode))
      .orderBy(desc(edinetDocumentIndex.fiscalYear))
      .limit(1);
    const row = rows[0];
    return row === undefined ? null : row;
  }

  /**
   * 主キー `(company_code, fiscal_year)` で upsert する。同じキーへの再実行は上書きする。
   *
   * 複数行を1文にまとめてINSERTする（`company-repository.ts`と同じチャンク分割方式。
   * 提出集中日には数百件規模になりうるため、1行1文だと文数が増えすぎる。CR-7で修正）。
   * **`set`には`sql`excluded.<column>``を使う。** 固定値を書くと、1文に複数行が
   * まとまったとき衝突した全行が同じ値に上書きされてしまう（CR-7で発見・修正）。
   */
  async upsertMany(entries: readonly EdinetDocumentIndexEntry[]): Promise<void> {
    if (entries.length === 0) return;

    const statements: BatchItem<'sqlite'>[] = chunkRowsForInsert(
      entries,
      EDINET_DOCUMENT_INDEX_COLUMN_COUNT,
    ).map((chunk) =>
      this.db
        .insert(edinetDocumentIndex)
        .values(chunk)
        .onConflictDoUpdate({
          target: [edinetDocumentIndex.companyCode, edinetDocumentIndex.fiscalYear],
          set: {
            docId: sql`excluded.doc_id`,
            submittedAt: sql`excluded.submitted_at`,
          },
        }),
    );
    const [first, ...rest] = statements;
    if (first === undefined) return;
    await this.db.batch([first, ...rest]);
  }

  async lastRefreshedAt(): Promise<string | null> {
    const rows = await this.db
      .select()
      .from(edinetRefreshLog)
      .orderBy(desc(edinetRefreshLog.id))
      .limit(1);
    const row = rows[0];
    return row === undefined ? null : row.refreshedAt;
  }

  async recordRefresh(refreshedAt: string, entryCount: number): Promise<void> {
    await this.db.insert(edinetRefreshLog).values({ refreshedAt, entryCount });
  }
}
