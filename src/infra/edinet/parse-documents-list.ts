/**
 * EDINET `documents.json`（書類一覧）応答を正規化し、docIDインデックスのエントリへ変換する。
 *
 * 仕様: `docs/02_design/logic/edinet-history-import.md` §4.4・§7.3
 *
 * **純粋関数。ネットワークにも触らない。** 取得は `edinet-client.ts` の責務。
 */

import {
  type EdinetDocumentIndexEntry,
  type EdinetDocumentsListError,
} from '../../domain/company/edinet-document-index';
import { type Result, err, ok } from '../../domain/shared/result';

/** 有価証券報告書の書類種別コード（§2.2） */
const FORM_CODE_SECURITIES_REPORT = '030000';
/** 取下げ済み書類のステータス */
const WITHDRAWN = '1';

/** `secCode` は証券コード＋チェックディジット（5桁）。実測どおり末尾 `0` の形のみ扱う（§0 の発見） */
const SEC_CODE_PATTERN = /^(\d{4})0$/;

/** `submitDateTime` の形式（`"2026-06-25 15:30"`。JST想定。§7.3） */
const SUBMIT_DATE_TIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/;

/** `periodEnd` から決算年度を導く（`YYYY-MM-DD` の先頭4桁。IRバンクと同じ「年の先頭4桁」規則） */
const PERIOD_END_PATTERN = /^(\d{4})-\d{2}-\d{2}$/;

/** `documents.json` の1件（フィルタ・変換前）。取得層が JSON から詰め替えたもの */
export interface EdinetDocumentsListEntry {
  readonly docId: string;
  /** 証券コード＋チェックディジット（例: `"94330"`）。読めなければ `null` */
  readonly secCode: string | null;
  /** 書類種別コード。有価証券報告書は `"030000"` */
  readonly formCode: string | null;
  /** `YYYY-MM-DD`。読めなければ `null` */
  readonly periodEnd: string | null;
  /** `YYYY-MM-DD HH:mm`（JST）。読めなければ `null` */
  readonly submitDateTime: string | null;
  /** `"1"` が取下げ */
  readonly withdrawalStatus: string | null;
}

function isRecordObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/**
 * `documents.json` の応答本体（`JSON.parse` 済み）を `EdinetDocumentsListEntry[]` へ正規化する。
 *
 * 実測レスポンスは `{ metadata: {...}, results: [...] }`。`results` が配列でなければ
 * `malformed-response`（応答そのものが期待した形ではない）。個々のエントリのフィールド欠損は
 * 例外にせず `null` として保持し、後段（`toDocumentIndexEntries`）でフィルタする。
 */
export function parseDocumentsListResponse(
  raw: unknown,
): Result<readonly EdinetDocumentsListEntry[], EdinetDocumentsListError> {
  if (!isRecordObject(raw)) {
    return err({ kind: 'malformed-response', detail: 'ルートがオブジェクトでない' });
  }
  const results = raw['results'];
  if (!Array.isArray(results)) {
    return err({ kind: 'malformed-response', detail: 'results が配列でない' });
  }

  const entries: EdinetDocumentsListEntry[] = [];
  for (const item of results) {
    if (!isRecordObject(item)) continue;
    const docId = stringOrNull(item['docID']);
    if (docId === null) continue; // docID が無いエントリは扱いようが無いので飛ばす
    entries.push({
      docId,
      secCode: stringOrNull(item['secCode']),
      formCode: stringOrNull(item['formCode']),
      periodEnd: stringOrNull(item['periodEnd']),
      submitDateTime: stringOrNull(item['submitDateTime']),
      withdrawalStatus: stringOrNull(item['withdrawalStatus']),
    });
  }
  return ok(entries);
}

/** `secCode`（5桁・末尾チェックディジット）を当アプリの `companyCode`（4文字）へ変換する */
function toCompanyCode(secCode: string | null): string | null {
  if (secCode === null) return null;
  const matched = SEC_CODE_PATTERN.exec(secCode);
  return matched?.[1] ?? null;
}

function toFiscalYear(periodEnd: string | null): number | null {
  if (periodEnd === null) return null;
  const matched = PERIOD_END_PATTERN.exec(periodEnd);
  if (matched?.[1] === undefined) return null;
  return Number(matched[1]);
}

/**
 * `submitDateTime`（JSTのローカル日時文字列）をUTCのISO8601へ変換する。
 * JSTはUTC+9固定（夏時間なし）なので、単純に9時間引けばよい。
 */
function toUtcIso(submitDateTime: string | null): string | null {
  if (submitDateTime === null) return null;
  const matched = SUBMIT_DATE_TIME_PATTERN.exec(submitDateTime);
  if (matched === null) return null;
  const [, year, month, day, hour, minute] = matched;
  if (
    year === undefined ||
    month === undefined ||
    day === undefined ||
    hour === undefined ||
    minute === undefined
  ) {
    return null;
  }
  const utcMs = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
  );
  // JST(UTC+9) → UTC は 9時間引く
  return new Date(utcMs - 9 * 60 * 60 * 1000).toISOString();
}

/**
 * `documents.json` のエントリを docIDインデックスへ変換する（§4.4・§7.3）。
 *
 * - `formCode === "030000"`（有価証券報告書）のみ候補にする
 * - `withdrawalStatus === "1"`（取下げ）は除外する
 * - `secCode` が変換できない（末尾チェックディジットが `0` でない等）エントリは飛ばす
 *   （例外にしない。§0 の発見どおり低頻度と想定）
 * - 同一 `(companyCode, fiscalYear)` に複数の候補があれば `submitDateTime` が
 *   最も新しいものを採用する（訂正報告書等。`docInfoEditStatus` の値の意味には踏み込まない。§8-7）
 */
export function toDocumentIndexEntries(
  entries: readonly EdinetDocumentsListEntry[],
): readonly EdinetDocumentIndexEntry[] {
  const byKey = new Map<string, EdinetDocumentIndexEntry>();

  for (const entry of entries) {
    if (entry.formCode !== FORM_CODE_SECURITIES_REPORT) continue;
    if (entry.withdrawalStatus === WITHDRAWN) continue;

    const companyCode = toCompanyCode(entry.secCode);
    if (companyCode === null) continue;
    const fiscalYear = toFiscalYear(entry.periodEnd);
    if (fiscalYear === null) continue;
    const submittedAt = toUtcIso(entry.submitDateTime);
    if (submittedAt === null) continue;

    const key = `${companyCode} ${String(fiscalYear)}`;
    const existing = byKey.get(key);
    if (existing === undefined || submittedAt > existing.submittedAt) {
      byKey.set(key, { companyCode, fiscalYear, docId: entry.docId, submittedAt });
    }
  }

  return [...byKey.values()];
}
