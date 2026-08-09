/**
 * EDINET書類（`documents/{docID}?type=5`）の応答ZIPから、有価証券報告書本体のCSVを
 * 取り出してUTF-16デコードする。
 *
 * 仕様: `docs/02_design/logic/edinet-history-import.md` §0（実装時の発見）・§2.3・§7.5
 *
 * ZIPには複数のCSVが入っている（監査報告書系 `jpaud-*` 等）。**読むべきは
 * `jpcrp030000-asr-` で始まるファイルだけ。**
 *
 * `fflate` を使う（ADR-0011「結果・影響」・依存追加は `be-plan.md` §4 で検討済み）。
 */

import { unzipSync } from 'fflate';

import { type Result, err, ok } from '../../domain/shared/result';

export type UnzipEdinetDocumentError =
  | { readonly kind: 'malformed-response'; readonly detail: string }
  /** ZIP自体は開けたが、有報本体のCSVが見つからない */
  | { readonly kind: 'csv-not-found' };

const SUMMARY_CSV_PREFIX = 'jpcrp030000-asr-';
const CSV_SUFFIX = '.csv';

function describeCause(cause: unknown): string {
  if (cause instanceof Error) return cause.name;
  return typeof cause;
}

/** ZIP のパス区切りは `/`（`XBRL_TO_CSV/jpcrp030000-asr-...csv`） */
function baseName(path: string): string {
  const parts = path.split('/');
  return parts[parts.length - 1] ?? path;
}

/**
 * ZIPバイト列から有報本体CSVを選び、UTF-16(LE, BOM付き)としてデコードした文字列を返す。
 *
 * **純粋関数。** ネットワークは `edinet-client.ts` の責務。
 */
export function unzipSummaryCsv(zipBytes: Uint8Array): Result<string, UnzipEdinetDocumentError> {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(zipBytes);
  } catch (cause) {
    return err({ kind: 'malformed-response', detail: describeCause(cause) });
  }

  const entry = Object.entries(files).find(([path]) => {
    const name = baseName(path);
    return name.startsWith(SUMMARY_CSV_PREFIX) && name.endsWith(CSV_SUFFIX);
  });
  if (entry === undefined) return err({ kind: 'csv-not-found' });

  const [, bytes] = entry;
  try {
    // EDINETのCSVは UTF-16（BOM付き）。TextDecoder('utf-16le') は既定で BOM を検出・除去する
    const text = new TextDecoder('utf-16le').decode(bytes);
    return ok(text);
  } catch (cause) {
    return err({ kind: 'malformed-response', detail: describeCause(cause) });
  }
}
