/**
 * ユースケース: Yahoo Finance の chart エンドポイントから市場データ
 * （株価・配当履歴・株式分割）を取り込む。
 *
 * `importFromIrBank`（1行 delegation）と違い、「決算月が分かっているときだけ
 * 配当を決算年度へ集計する」分岐を持つ。**保存はしない。** 取り込んだ結果は
 * 入力フォームの初期値として返すだけ（`docs/02_design/logic/market-data-source.md` §1.2）。
 */

import {
  type DividendFiscalYearError,
  toFiscalYearDividends,
} from '../domain/company/dividend-fiscal-year';
import { type DividendRecord } from '../domain/company/dividend-record';
import { type ImportDiagnostic } from '../domain/company/financial-source';
import {
  type MarketData,
  type MarketDataError,
  type MarketDataSource,
} from '../domain/company/market-data-source';
import { type Result, ok } from '../domain/shared/result';

export interface MarketDataImportResult {
  readonly marketData: MarketData;
  /** 決算年度に集計した配当。`fiscalYearEndMonth` が `null` なら常に空配列 */
  readonly dividendRecords: readonly DividendRecord[];
  /** 集計時に出た診断（丸め・安全整数超過）。`dividendAggregated` が `false` なら空配列 */
  readonly dividendDiagnostics: readonly ImportDiagnostic[];
  /**
   * 配当の年度集計を実行したかどうか。`fiscalYearEndMonth` が `null`
   * （IRバンク未実施のまま Yahoo だけを実行した）ときは `false`。
   *
   * FE 側がこの値で「決算月が未取得のため、配当の年度集計は行われませんでした」
   * を通知できるようにする（設計書 §7.4 決定事項）。
   */
  readonly dividendAggregated: boolean;
}

export type ImportMarketDataError = MarketDataError | DividendFiscalYearError;

/**
 * @param fiscalYearEndMonth IRバンクの取り込みから取れた決算月。`null` なら
 *   配当の集計をせず、株価・分割イベントだけを返す（設計書 §7.4）
 * @param now 現在時刻。テストから固定できるように注入する（`toFiscalYearDividends`
 *   の「進行中の年度は集計しない」判定に使う。§7.1「取得時点は引数で渡す」）
 */
export async function importMarketData(
  source: MarketDataSource,
  code: string,
  fiscalYearEndMonth: number | null,
  now: () => Date = () => new Date(),
): Promise<Result<MarketDataImportResult, ImportMarketDataError>> {
  const fetched = await source.fetchByCode(code);
  if (!fetched.ok) return fetched;

  if (fiscalYearEndMonth === null) {
    return ok({
      marketData: fetched.value,
      dividendRecords: [],
      dividendDiagnostics: [],
      dividendAggregated: false,
    });
  }

  const aggregated = toFiscalYearDividends(
    fetched.value.dividendPayments,
    fiscalYearEndMonth,
    now(),
  );
  if (!aggregated.ok) return aggregated;

  return ok({
    marketData: fetched.value,
    dividendRecords: aggregated.value.records,
    dividendDiagnostics: aggregated.value.diagnostics,
    dividendAggregated: true,
  });
}
