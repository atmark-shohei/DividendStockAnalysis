/**
 * ユースケース: EDINET の有価証券報告書から④⑦用の履歴・⑥用の貸借対照表項目を取り込む。
 *
 * `importFromIrBank`（1行 delegation）と同型。**保存はしない**（設計書 §4.6。
 * IRバンク・Yahoo と同じ「取得するだけで保存しない」原則。`Company.records` への実際の
 * 反映は本仕様のスコープ外〈§1.2〉。GET エンドポイントは取得のみ）。
 */

import { type EdinetDocumentIndexLookup } from '../domain/company/edinet-document-index';
import {
  type EdinetHistoryError,
  type EdinetHistoryResult,
  type EdinetHistorySource,
} from '../domain/company/edinet-history-source';
import { type Result } from '../domain/shared/result';

export async function importEdinetHistory(
  source: EdinetHistorySource,
  code: string,
  index: EdinetDocumentIndexLookup,
): Promise<Result<EdinetHistoryResult, EdinetHistoryError>> {
  return source.fetchHistory(code, index);
}
