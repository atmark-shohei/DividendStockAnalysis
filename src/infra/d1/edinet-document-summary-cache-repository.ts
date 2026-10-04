/**
 * `EdinetDocumentSummaryCache` の D1 実装（`docs/02_design/logic/edinet-history-import.md` §4.8）。
 *
 * ここだけが Drizzle と `D1Database` を知る。ドメインの型ではなく、
 * `src/infra/edinet/document-summary-cache.ts` のポート型（`EdinetDocumentSummary`）に
 * 詰め替えて返す。infra→infra の依存だが、本キャッシュ自体が「domain を経由しない
 * infra 内完結」という設計方針（§4.8.2）のため、この非対称は意図的。
 */

import { eq } from 'drizzle-orm';
import { type DrizzleD1Database, drizzle } from 'drizzle-orm/d1';

import {
  CURRENT_SCHEMA_VERSION,
  type EdinetDocumentSummary,
  type EdinetDocumentSummaryCache,
} from '../edinet/document-summary-cache';
import { edinetDocumentSummary } from './schema';

function describeCause(cause: unknown): string {
  if (cause instanceof Error) return cause.name;
  return typeof cause;
}

/**
 * `payload`（JSON）が `EdinetDocumentSummary` の形をしているか、最小限だけ確認する。
 *
 * 全フィールドの型を完全に検証するわけではない（JSON スキーマ検証を持ち込まない）。
 * 壊れた行を確実に弾ければ十分という方針（§4.8.3）。配列であること・長さ5であることを
 * 崩れやすい3フィールド（`epsSenByOffset` / `revenueSenByOffset` / `roePercentByOffset`）で
 * チェックし、`diagnostics`（可変長）は配列であることだけチェックする（CR-1・§4.8.3）。
 *
 * `operatingIncomeSenByOffset`（⑧用。T-054 で追加）は他の3配列と期数が異なる
 * （長さ2固定。§4.8.3.1）ため、別枠の専用チェックにする。
 */
function isWellFormed(payload: unknown): payload is EdinetDocumentSummary {
  if (typeof payload !== 'object' || payload === null) return false;
  const candidate = payload as Record<string, unknown>;
  // 固定長5（当期〜四期前）の3配列。長さも崩れやすいのでチェック対象（CR-1 現状維持分）
  const fixedLengthArrays = [
    candidate['epsSenByOffset'],
    candidate['revenueSenByOffset'],
    candidate['roePercentByOffset'],
  ];
  const fixedLengthOk = fixedLengthArrays.every(
    (value) => Array.isArray(value) && value.length === 5,
  );
  // ⑧営業利益は当期・前期の2期のみ（§4.8.3.1）。他の3配列とは期数が異なるため別枠でチェックする
  const operatingIncomeSenByOffset = candidate['operatingIncomeSenByOffset'];
  const operatingIncomeOk =
    Array.isArray(operatingIncomeSenByOffset) && operatingIncomeSenByOffset.length === 2;
  // diagnostics は可変長（0件〜）なので長さは見ず、配列であることだけ確認する（CR-1・§4.8.3）
  return fixedLengthOk && operatingIncomeOk && Array.isArray(candidate['diagnostics']);
}

export class D1EdinetDocumentSummaryCacheRepository implements EdinetDocumentSummaryCache {
  private readonly db: DrizzleD1Database;
  private readonly database: D1Database;

  constructor(database: D1Database) {
    this.database = database;
    this.db = drizzle(database);
  }

  async find(docId: string): Promise<EdinetDocumentSummary | null> {
    let rows: (typeof edinetDocumentSummary.$inferSelect)[];
    try {
      // ポートの契約（`document-summary-cache.ts` JSDoc）「読み取りに失敗しても throw しない」を
      // リポジトリ単体でも満たす。呼び出し元 `edinet-client.ts` の readFromCache でも
      // try/catch しているが、D1EdinetDocumentSummaryCacheRepository を将来
      // EdinetClient を介さず直接使うコード（別の管理スクリプト等）が増えたときに
      // 未処理例外が漏れないための二重防御（CR-2）
      rows = await this.db
        .select()
        .from(edinetDocumentSummary)
        .where(eq(edinetDocumentSummary.docId, docId))
        .limit(1);
    } catch (cause) {
      console.error('edinet document summary cache query failed', docId, describeCause(cause));
      return null;
    }
    const row = rows[0];
    if (row === undefined) return null;
    // 保存時とスキーマ版が違う行はキャッシュミス扱い（§4.8.3）
    if (row.schemaVersion !== CURRENT_SCHEMA_VERSION) return null;

    let payload: unknown;
    try {
      payload = JSON.parse(row.payload);
    } catch {
      // 壊れたJSON。ミス扱いにして再取得へ倒す（§4.8.5）
      return null;
    }
    if (!isWellFormed(payload)) return null;
    return payload;
  }

  /**
   * `doc_id` 主キーで upsert する。同じキーへの再実行は上書きする。
   *
   * ポートの契約「書き込みに失敗しても throw しない」（`document-summary-cache.ts` JSDoc）を
   * リポジトリ単体でも満たすため、関数全体を try/catch する。呼び出し元 `edinet-client.ts` の
   * writeToCache でも try/catch しているが、CR-2 と同じ理由で二重防御する
   */
  async save(docId: string, summary: EdinetDocumentSummary): Promise<void> {
    try {
      const cachedAt = new Date().toISOString();
      await this.db
        .insert(edinetDocumentSummary)
        .values({
          docId,
          schemaVersion: CURRENT_SCHEMA_VERSION,
          payload: JSON.stringify(summary),
          cachedAt,
        })
        .onConflictDoUpdate({
          target: edinetDocumentSummary.docId,
          set: {
            schemaVersion: CURRENT_SCHEMA_VERSION,
            payload: JSON.stringify(summary),
            cachedAt,
          },
        });
    } catch (cause) {
      console.error('edinet document summary cache save failed', docId, describeCause(cause));
    }
  }

  /**
   * 全行削除（管理用。`schema_version` の上げ忘れに対する保険。§4.8.3）。
   *
   * 影響行数（削除件数）を返す必要があるため、Drizzle の `delete()` ではなく
   * 生の `D1Database.prepare().run()` を使う（`meta.changes` で行数を取れる。
   * 他リポジトリに前例が無い操作のための例外）。
   */
  async clearAll(): Promise<number> {
    const result = await this.database
      .prepare('DELETE FROM edinet_document_summary')
      .run();
    return result.meta.changes;
  }
}
