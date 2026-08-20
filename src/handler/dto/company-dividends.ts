/**
 * `GET /api/companies/:code/dividends` の応答 DTO。
 *
 * クエリパラメータを持たない設計（設計書 `company-api.md` 545-586行目）なので
 * zod スキーマは無い。`company-input.ts` の `ScoringResponse`/`toScoringResponse`
 * と同じ「型 + 変換関数」ペアの分割方針で新規ファイルに切る。
 */

import { type DividendHistoryYear } from '../../domain/company/dividend-record';

export interface DividendHistoryItemResponse {
  readonly fiscalYear: number;
  /** 銭。null=データなし。0=無配（別物） */
  readonly amountSen: number | null;
  readonly isForecast: boolean;
}

export interface DividendHistoryResponse {
  readonly dividends: readonly DividendHistoryItemResponse[];
}

/**
 * 年度別に集約した配当履歴を画面向けの形にする。
 *
 * **丸めない。null をそのまま返す。**（`.claude/rules/frontend.md`「0を表示しない」）
 */
export function toDividendHistoryResponse(
  history: readonly DividendHistoryYear[],
): DividendHistoryResponse {
  return {
    dividends: history.map((year) => ({
      fiscalYear: year.fiscalYear,
      amountSen: year.amountSen,
      isForecast: year.isForecast,
    })),
  };
}
