/**
 * EDINET取り込み（`GET /api/edinet/:code`）の API 応答 DTO とエラー→HTTP変換。
 *
 * GET でボディが無いため zod 検証は対象外（`irbank-import.ts` / `market-data-import.ts` と同型）。
 */

import {
  type EdinetHistoryError,
  type EdinetHistoryResult,
  type EdinetImportDiagnostic,
} from '../../domain/company/edinet-history-source';

/**
 * 取り込めなかった値の記録。ドメインの `EdinetImportDiagnostic` をそのまま公開する
 * （`irbank-import.ts` が `ImportDiagnostic` をそのまま載せているのと同じ）。
 */
export type EdinetImportDiagnosticView = EdinetImportDiagnostic;

export interface EdinetHistoryYearView {
  readonly fiscalYear: number;
  readonly epsSen: number | null;
  readonly revenueSen: number | null;
  readonly sourceDocId: string;
}

export interface EdinetBalanceSheetView {
  readonly currentAssetsSen: number | null;
  readonly investmentSecuritiesSen: number | null;
  readonly sourceDocId: string;
}

export interface EdinetImportResponse {
  /** 年度降順。最大6件 */
  readonly years: readonly EdinetHistoryYearView[];
  /** ④用。重複4期の突き合わせで遡及修正が検出されたか */
  readonly epsHistoryRestated: boolean;
  /** ⑦用。同上 */
  readonly revenueHistoryRestated: boolean;
  /** ⑥用。取得できなければ `null` */
  readonly balanceSheet: EdinetBalanceSheetView | null;
  /**
   * 取り込めなかった値の記録。**丸めない・間引かない・0件でもキーを消さない**
   * （`market-data-import.ts` と同じ扱い）。最新有報と1年前有報のぶんが混ざるので、
   * どの有報由来かは `sourceDocId` で判別する。
   */
  readonly diagnostics: readonly EdinetImportDiagnosticView[];
}

export function toEdinetImportResponse(result: EdinetHistoryResult): EdinetImportResponse {
  return {
    years: result.years.map((year) => ({
      fiscalYear: year.fiscalYear,
      epsSen: year.epsSen,
      revenueSen: year.revenueSen,
      sourceDocId: year.sourceDocId,
    })),
    epsHistoryRestated: result.epsHistoryRestated,
    revenueHistoryRestated: result.revenueHistoryRestated,
    balanceSheet:
      result.balanceSheet === null
        ? null
        : {
            currentAssetsSen: result.balanceSheet.currentAssetsSen,
            investmentSecuritiesSen: result.balanceSheet.investmentSecuritiesSen,
            sourceDocId: result.balanceSheet.sourceDocId,
          },
    // そのまま転記する（診断は原因調査のための記録。ここで削ると調査できなくなる）
    diagnostics: result.diagnostics,
  };
}

interface EdinetErrorResponse {
  readonly body: { readonly error: string };
  readonly status: 400 | 404 | 502;
}

/**
 * ドメインエラーを HTTP へ変換する。**内部情報（`detail` などの例外由来の文字列）は
 * ここで捨てる。** 外部要因の失敗はサーバー側にログを残す（呼び出し側で行う）。
 */
export function toEdinetErrorResponse(error: EdinetHistoryError): EdinetErrorResponse {
  switch (error.kind) {
    case 'invalid-code':
      return { body: { error: '銘柄コードの形式が不正です' }, status: 400 };
    case 'document-not-found':
      return {
        body: { error: 'EDINETに該当する有価証券報告書が見つかりませんでした' },
        status: 404,
      };
    case 'authentication-failed':
      // 時間をおいても直らない。設定を直す以外に次の行動が無いので、そう書く
      return {
        body: {
          error: 'EDINETの認証が通りませんでした。EDINET_API_KEY の設定を確認してください',
        },
        status: 502,
      };
    case 'source-unreachable':
    case 'malformed-response':
      return {
        body: { error: 'EDINETからのデータ取得に失敗しました。時間をおいて再試行してください' },
        status: 502,
      };
  }
}

/** サーバー側のログにだけ残す、原因調査に値する失敗かどうかの判定 */
export function isExternalFactor(error: EdinetHistoryError): boolean {
  return (
    error.kind === 'source-unreachable' ||
    error.kind === 'malformed-response' ||
    error.kind === 'authentication-failed'
  );
}
