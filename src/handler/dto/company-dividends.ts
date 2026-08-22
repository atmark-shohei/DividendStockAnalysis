/**
 * `GET /api/companies/:code/dividends` の応答 DTO。
 *
 * クエリパラメータを持たない設計（設計書 `company-api.md` 545-586行目）なので
 * zod スキーマは無い。`company-input.ts` の `ScoringResponse`/`toScoringResponse`
 * と同じ「型 + 変換関数」ペアの分割方針で新規ファイルに切る。
 */

import { type ConsecutiveYearState } from '../../domain/scoring/consecutive-years';
import { type CompanyDividendHistoryResult } from '../../usecase/read-companies';

export interface DividendHistoryItemResponse {
  readonly fiscalYear: number;
  /** 銭。null=データなし。0=無配（別物） */
  readonly amountSen: number | null;
  readonly isForecast: boolean;
}

/** ②連続非減配年数の年次リスト1行分（`consecutive-years.ts` の `ConsecutiveYearRow` の画面向け型） */
export interface ConsecutiveYearRowResponse {
  readonly fiscalYear: number;
  /** 銭。null=データなし。0=無配（別物） */
  readonly amountSen: number | null;
  /** 前年からの差分（銭）。判定不能なら null */
  readonly diffSen: number | null;
  readonly state: ConsecutiveYearState;
}

export interface DividendHistoryResponse {
  readonly dividends: readonly DividendHistoryItemResponse[];
  /** ②連続非減配年数の年次リスト。年度昇順。予想年度は含まない（実績限定） */
  readonly consecutiveYearRows: readonly ConsecutiveYearRowResponse[];
}

/**
 * 年度別に集約した配当履歴・連続非減配年数の年次リストを画面向けの形にする。
 *
 * **丸めない。null をそのまま返す。**（`.claude/rules/frontend.md`「0を表示しない」）
 */
export function toDividendHistoryResponse(
  result: CompanyDividendHistoryResult,
): DividendHistoryResponse {
  return {
    dividends: result.dividends.map((year) => ({
      fiscalYear: year.fiscalYear,
      amountSen: year.amountSen,
      isForecast: year.isForecast,
    })),
    consecutiveYearRows: result.consecutiveYearRows.map((row) => ({
      fiscalYear: row.fiscalYear,
      amountSen: row.amountSen,
      diffSen: row.diffSen,
      state: row.state,
    })),
  };
}
