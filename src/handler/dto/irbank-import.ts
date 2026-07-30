/**
 * IRバンク取り込みの API 応答 DTO。
 *
 * GET でボディが無いため zod 検証は対象外（`.claude/CLAUDE.md`「zod は handler の
 * 入出力検証のみ」＝出力側の整形はここが担う）。
 */

import {
  type FinancialSourceError,
  type ImportDiagnostic,
  type ImportedFinancials,
} from '../../domain/company/financial-source';
import { type CellWarning, resolveCellWarnings } from '../../domain/company/import-review';

export interface IrBankRecordView {
  readonly fiscalYear: number;
  readonly isForecast: boolean;
  readonly epsSen: number | null;
  readonly roePercent: number | null;
  readonly revenueSen: number | null;
  readonly operatingMarginPercent: number | null;
}

export interface IrBankDividendView {
  readonly fiscalYear: number;
  readonly annualAmountSen: number | null;
}

export interface IrBankImportResponse {
  readonly code: string;
  /** 年度昇順（`ImportedFinancials` と同じ並び） */
  readonly records: readonly IrBankRecordView[];
  /** ⑨ PER 用（会社予想を優先）。株価が無いと倍率は出せないので、画面側で株価と掛け合わせる */
  readonly latestForecastEpsSen: number | null;
  /** ⑨ PER 用（予想が無い銘柄の代用） */
  readonly latestActualEpsSen: number | null;
  /** ⑨ PBR 用 */
  readonly latestActualBpsSen: number | null;
  /** 年度別データの「1株配当」欄はここから埋める。`records` は保有しない（ADR-0009） */
  readonly dividends: readonly IrBankDividendView[];
  /** 読み取れなかった値。**捨てない**（`.claude/rules/backend.md`） */
  readonly diagnostics: readonly ImportDiagnostic[];
  /**
   * 診断を画面のセルに解決したもの（`docs/02_design/logic/import-review.md` §3.2）。
   * 取り込んだ時点で確定するので、画面ではなくここで計算して同梱する（同 §3.1）。
   */
  readonly cellWarnings: readonly CellWarning[];
}

export function toIrBankImportResponse(imported: ImportedFinancials): IrBankImportResponse {
  return {
    code: imported.code,
    records: imported.records.map((record) => ({
      fiscalYear: record.fiscalYear,
      isForecast: record.isForecast,
      epsSen: record.epsSen,
      roePercent: record.roePercent,
      revenueSen: record.revenueSen,
      operatingMarginPercent: record.operatingMarginPercent,
    })),
    latestForecastEpsSen: imported.latestForecastEpsSen,
    latestActualEpsSen: imported.latestActualEpsSen,
    latestActualBpsSen: imported.latestActualBpsSen,
    dividends: imported.dividends.map((entry) => ({
      fiscalYear: entry.fiscalYear,
      annualAmountSen: entry.annualAmountSen,
    })),
    diagnostics: imported.diagnostics,
    cellWarnings: resolveCellWarnings(imported.diagnostics),
  };
}

interface IrBankErrorResponse {
  readonly body: { readonly error: string };
  readonly status: 400 | 404 | 422 | 502;
}

/**
 * ドメインエラーを HTTP へ変換する（`.claude/CLAUDE.md`）。
 *
 * **内部情報（HTTP ステータス・例外名などの `detail`）はここで捨てる。**
 * 外部要因の失敗はサーバー側にログを残す（呼び出し側で行う）。
 */
export function toIrBankErrorResponse(error: FinancialSourceError): IrBankErrorResponse {
  switch (error.kind) {
    case 'invalid-code':
      return { body: { error: '銘柄コードの形式が不正です' }, status: 400 };
    case 'source-not-found':
      return { body: { error: '指定された銘柄のデータが見つかりませんでした' }, status: 404 };
    case 'no-usable-year':
      return { body: { error: '取り込めるデータがありませんでした' }, status: 422 };
    case 'source-unreachable':
    case 'malformed-response':
    case 'unexpected-shape':
    case 'code-mismatch':
      return {
        body: { error: 'IRバンクからのデータ取得に失敗しました。時間をおいて再試行してください' },
        status: 502,
      };
  }
}

/** サーバー側のログにだけ残す、外部要因かどうかの判定 */
export function isExternalFactor(error: FinancialSourceError): boolean {
  return (
    error.kind === 'source-unreachable' ||
    error.kind === 'malformed-response' ||
    error.kind === 'unexpected-shape' ||
    error.kind === 'code-mismatch'
  );
}
