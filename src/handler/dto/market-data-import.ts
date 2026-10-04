/**
 * 市場データ取り込み（Yahoo）の API 応答 DTO とクエリ検証。
 *
 * レスポンスの整形は zod 検証の対象外（`.claude/CLAUDE.md`「zod は handler の
 * 入出力検証のみ」＝出力側の整形はここが担う）。`irbank-import.ts` と同型。
 * **クエリパラメータ（`fiscalYearEndMonth`）は入力なので zod で検証する。**
 */

import { z } from 'zod';

import { type ImportDiagnostic } from '../../domain/company/financial-source';
import {
  type ImportMarketDataError,
  type MarketDataImportResult,
} from '../../usecase/import-market-data';

/**
 * `?fiscalYearEndMonth=3` の検証。1〜12 の整数。
 *
 * `toFiscalYearDividends` 自身も同じ範囲を検証するが（ドメインは自身の不変条件を
 * 自分で守る）、ここで先に弾いておけば `invalid-fiscal-year-end-month` の
 * 502/400 分岐を通常のリクエストで踏むことがない。
 */
export const fiscalYearEndMonthQuery = z.coerce.number().int().min(1).max(12);

export interface MarketDataSplitView {
  readonly date: string;
  readonly numerator: number;
  readonly denominator: number;
}

export interface MarketDataDividendRecordView {
  readonly fiscalYear: number;
  readonly annualAmountSen: number | null;
}

export interface MarketDataImportResponse {
  readonly code: string;
  /** **英語名のみ。** 取れなければ `null`（画面側の表示制御は FE の責務） */
  readonly name: string | null;
  readonly priceSen: number | null;
  /** 株価の観測時刻。UTC の ISO 8601。表示用の JST 変換は表示層で行う */
  readonly priceAsOf: string | null;
  /**
   * 株式分割・併合イベント。**スコアリング・自動反映には使わない。**
   * 参考情報として画面に表示するためだけに返す（設計書 §8-17 ユーザー確定事項:
   * 参考表示のみ許可する）。
   */
  readonly splits: readonly MarketDataSplitView[];
  /** 決算年度に集計した配当。`dividendAggregated` が `false` なら常に空配列 */
  readonly dividendRecords: readonly MarketDataDividendRecordView[];
  /**
   * 配当の年度集計を実行したかどうか。`fiscalYearEndMonth` クエリが未指定
   * （IRバンク未実施のまま Yahoo だけを実行した）ときは `false`。
   *
   * FE 側はこの値で「決算月が未取得のため、配当の年度集計は行われませんでした」を
   * 通知する（設計書 §7.4 決定事項）。
   */
  readonly dividendAggregated: boolean;
  /** 取得時のパース診断（`MarketData.diagnostics`）。**捨てない** */
  readonly diagnostics: readonly ImportDiagnostic[];
  /** 配当の年度集計時の診断（丸め・安全整数超過）。**捨てない** */
  readonly dividendDiagnostics: readonly ImportDiagnostic[];
}

export function toMarketDataImportResponse(
  result: MarketDataImportResult,
): MarketDataImportResponse {
  const { marketData } = result;
  return {
    code: marketData.code,
    name: marketData.name,
    priceSen: marketData.priceSen,
    priceAsOf: marketData.priceAsOf,
    splits: marketData.splits.map((split) => ({
      date: split.date,
      numerator: split.numerator,
      denominator: split.denominator,
    })),
    dividendRecords: result.dividendRecords.map((record) => ({
      fiscalYear: record.fiscalYear,
      annualAmountSen: record.annualAmountSen,
    })),
    dividendAggregated: result.dividendAggregated,
    diagnostics: marketData.diagnostics,
    dividendDiagnostics: result.dividendDiagnostics,
  };
}

interface MarketDataErrorResponse {
  readonly body: { readonly error: string };
  readonly status: 400 | 404 | 502;
}

/**
 * ドメインエラーを HTTP へ変換する（`.claude/CLAUDE.md`）。
 *
 * **内部情報（`detail` などの例外由来の文字列）はここで捨てる。**
 * 外部要因の失敗はサーバー側にログを残す（呼び出し側で行う）。
 *
 * `invalid-fiscal-year-end-month` は `toFiscalYearDividends` の防御的なエラー。
 * handler は zod でクエリを 1〜12 に絞る想定なので通常は届かないが、
 * ドメインの不変条件を handler が信用しきらないため 400 として扱う。
 */
export function toMarketDataErrorResponse(error: ImportMarketDataError): MarketDataErrorResponse {
  switch (error.kind) {
    case 'invalid-code':
      return { body: { error: '銘柄コードの形式が不正です' }, status: 400 };
    case 'invalid-fiscal-year-end-month':
      return { body: { error: '決算月の指定が不正です' }, status: 400 };
    case 'source-not-found':
      return { body: { error: '指定された銘柄のデータが見つかりませんでした' }, status: 404 };
    case 'source-unreachable':
    case 'malformed-response':
    case 'unexpected-shape':
      return {
        body: { error: '市場データの取得に失敗しました。時間をおいて再試行してください' },
        status: 502,
      };
  }
}

/** サーバー側のログにだけ残す、外部要因かどうかの判定 */
export function isExternalFactor(error: ImportMarketDataError): boolean {
  return (
    error.kind === 'source-unreachable' ||
    error.kind === 'malformed-response' ||
    error.kind === 'unexpected-shape'
  );
}
