/**
 * 外部データ源から財務データを取り込むためのポート。**定義はドメイン側に置く**
 * （`.claude/CLAUDE.md`）。実装は `src/infra/irbank/`。
 *
 * ここに HTTP・JSON・IRバンクは現れない。取り込み元が変わっても
 * ドメインとユースケースは動かないようにする（[ADR-0007](../../../docs/adr/0007-irbank-json-direct-fetch.md)
 * の「見直しのトリガー」で、取得経路の差し替えが起こりうる）。
 *
 * 仕様: `docs/02_design/logic/irbank-json-import.md`
 */

import { type Result } from '../shared/result';
import { type FinancialRecord } from './company';
import { type DividendRecord } from './dividend-record';

/**
 * 取り込みで落ちた値・行の記録。**捨てずに残す**（`.claude/rules/backend.md`
 * 「検証に落ちたデータは捨てずに記録する」）。原因調査に必要。
 */
export interface ImportDiagnostic {
  /** 取り込み元の区画名。IRバンクなら `業績` / `財務` / `配当` */
  readonly block: string;
  /** 元のキー（`2026/03`）。決算年度に潰す前の値で報告する */
  readonly fiscalYearKey: string;
  readonly column: string;
  readonly reason:
    /** 数値として読めない値だった */
    | 'unparsable-value'
    /** 銭にすると安全整数の範囲を超える金額だった */
    | 'unsafe-integer'
    /** 小数第3位以下を丸めた */
    | 'rounded'
    /** 決算年度が形式違い、または範囲外 */
    | 'year-out-of-range'
    /** 同じ決算年度が複数あった。どちらが正か決められないので両方落とす */
    | 'duplicate-year'
    /**
     * 前年からの変化が大きすぎる。株式分割の反映漏れが疑われる。
     * **値は採用したまま**記録だけ残す（正しい急変と機械的に区別できないため）
     */
    | 'suspicious-jump'
    /** 予想・実績のどちらとも判断できない注記が付いていた */
    | 'unknown-note';
  /** 元の値。原因調査のためそのまま残す */
  readonly raw: string;
}

/**
 * 取り込んだ財務データ。
 *
 * ⚠️ **銘柄名は含まれない。** 外部データ源が返さないため、名前はユーザーが入力する。
 * ⚠️ **株価も含まれない。** ⑨ の PER / PBR は株価が要るので、ここでは
 * 最新実績の EPS / BPS を渡すところまでにする。
 */
export interface ImportedFinancials {
  readonly code: string;
  /** 年度昇順。降順への並べ替えは取り込みの外側（`toCompany()`）の責務 */
  readonly records: readonly FinancialRecord[];
  readonly dividends: readonly DividendRecord[];
  /**
   * ⑨ PER 用。最新**予想**年度の 1株利益（銭）。予想行が無い銘柄では `null`
   * （2026-07-29 追加。「会社予想PER」を名乗るなら予想EPSを優先する）
   */
  readonly latestForecastEpsSen: number | null;
  /** ⑨ PER 用（予想が無い銘柄の代用）。最新**実績**年度の 1株利益（銭） */
  readonly latestActualEpsSen: number | null;
  /** ⑨ PBR 用。最新**実績**年度の 1株純資産（銭） */
  readonly latestActualBpsSen: number | null;
  readonly diagnostics: readonly ImportDiagnostic[];
}

/**
 * 取り込みが成立しなかった理由。`kind` で判別する（`.claude/CLAUDE.md`）。
 * handler がこれを HTTP ステータスへ変換する。
 */
export type FinancialSourceError =
  /** 銘柄コードの形式が違う。外部へ問い合わせるまでもない */
  | { readonly kind: 'invalid-code'; readonly code: string }
  /** その銘柄のデータが無い */
  | { readonly kind: 'source-not-found'; readonly code: string }
  /** 通信できなかった。リトライ後も失敗した場合を含む */
  | { readonly kind: 'source-unreachable'; readonly detail: string }
  /** 応答は返ったが、形式として読めなかった */
  | { readonly kind: 'malformed-response'; readonly detail: string }
  /** 形式は読めたが、期待した構造になっていない */
  | { readonly kind: 'unexpected-shape'; readonly detail: string }
  /** 要求した銘柄と、返ってきたデータの銘柄が違う */
  | { readonly kind: 'code-mismatch'; readonly expected: string; readonly actual: string }
  /** 検証を通った決算年度が1件も無かった */
  | { readonly kind: 'no-usable-year' };

/** ログ・テスト向けの短い説明。**画面には出さない**（`domain-error.ts` と同じ方針） */
export function describeFinancialSourceError(error: FinancialSourceError): string {
  switch (error.kind) {
    case 'invalid-code':
      return `invalid company code: ${error.code}`;
    case 'source-not-found':
      return `no data for company code: ${error.code}`;
    case 'source-unreachable':
      return `source unreachable: ${error.detail}`;
    case 'malformed-response':
      return `malformed response: ${error.detail}`;
    case 'unexpected-shape':
      return `unexpected shape: ${error.detail}`;
    case 'code-mismatch':
      return `expected ${error.expected} but got ${error.actual}`;
    case 'no-usable-year':
      return 'no usable fiscal year';
  }
}

export interface FinancialSource {
  /**
   * 銘柄コードで財務データを取り込む。**保存はしない。**
   *
   * 失敗は `Result` で返す。呼び出し側が必ず扱う必要があるため throw にしない。
   */
  fetchByCode(code: string): Promise<Result<ImportedFinancials, FinancialSourceError>>;
}
