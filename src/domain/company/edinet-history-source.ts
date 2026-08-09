/**
 * 金融庁 EDINET の有価証券報告書から、④⑦が要求する「6期以上前」の EPS・売上高と、
 * ⑥が要求する流動資産・投資有価証券（前期末）を取り込むためのポート。
 * **定義はドメイン側に置く**（`.claude/CLAUDE.md`）。実装は `src/infra/edinet/`。
 *
 * `FinancialSource`（IRバンク）・`MarketDataSource`（Yahoo）と同じ理由で別ポートにする。
 * 扱う関心事が違う（仕様 §1.3）。
 *
 * 仕様: `docs/02_design/logic/edinet-history-import.md`
 * 決定: `docs/adr/0011-edinet-financial-history-api.md`
 */

import { type Result } from '../shared/result';
import { type EdinetDocumentIndexLookup } from './edinet-document-index';

/** 1年度ぶんの EDINET 由来の値 */
export interface EdinetHistoryYear {
  /** 決算年度。IRバンクの `fiscalYear` と同じ意味（例: 2024年3月期なら 2024） */
  readonly fiscalYear: number;
  /** 銭。取れなければ `null` */
  readonly epsSen: number | null;
  /** 銭。取れなければ `null` */
  readonly revenueSen: number | null;
  /** どの有報（docID）由来か。§2.6 の食い違いを後から追跡できるようにする */
  readonly sourceDocId: string;
}

/** ⑥用。前期末時点の貸借対照表項目 */
export interface EdinetBalanceSheetSnapshot {
  readonly currentAssetsSen: number | null;
  readonly investmentSecuritiesSen: number | null;
  readonly sourceDocId: string;
}

/** 診断の対象になった項目。EDINET の有報から読む4項目に対応する（§4.1・§2.7） */
export type EdinetImportDiagnosticField =
  'eps' | 'revenue' | 'currentAssets' | 'investmentSecurities';

/**
 * 値を採用できなかった理由。
 *
 * IRバンク・Yahoo が共有する `ImportDiagnostic['reason']`（`financial-source.ts`）とは
 * **別の語彙**にしている。`unit-mismatch`（XBRL のユニットID／単位が期待と違う）は
 * EDINET でしか起きず、共有型に混ぜると IRバンク側の `keepsValue()` の網羅 switch と
 * `import-review.md` §3.2 の表まで巻き添えになるため。
 */
export type EdinetImportDiagnosticReason = 'unit-mismatch' | 'unsafe-integer' | 'unparsable-value';

/**
 * 有報の値を採用できなかった記録。**捨てずに記録する**（`.claude/rules/backend.md`）。
 *
 * 設計書 §4.2。パース時点（`parse-summary-csv.ts`）で作られ、`EdinetHistoryResult` を
 * 経て `GET /api/edinet/:code` の応答 DTO まで届く。EDINET の原因調査は XBRL のタグ単位
 * でないと成立しないので、`elementId` を落とさない。
 */
export interface EdinetImportDiagnostic {
  readonly field: EdinetImportDiagnosticField;
  /** 添字0=当期〜4=四期前。貸借対照表項目（前期末時点のみ）は `null` */
  readonly offset: number | null;
  /**
   * 絶対年度（`有報の当期年度 - offset`）。2本の有報の診断が1配列に混ざるため、
   * `offset` だけでは年度が特定できないことへの対処。
   *
   * 貸借対照表項目は `null`。`Prior1YearInstant`（前期末時点）ではあるが、
   * `EdinetBalanceSheetSnapshot` が年度を持たない設計（§5）と矛盾させないため埋めない。
   */
  readonly fiscalYear: number | null;
  /** XBRL 要素ID。どのタグで落ちたか */
  readonly elementId: string;
  readonly reason: EdinetImportDiagnosticReason;
  /** 採用できなかった生の値（または `unitId=...` / `unit=...`） */
  readonly raw: string;
  /** どの有報（docID）由来か。`EdinetHistoryYear.sourceDocId` と同じ語彙 */
  readonly sourceDocId: string;
}

export interface EdinetHistoryResult {
  /** 年度降順。最大6件（§2.4） */
  readonly years: readonly EdinetHistoryYear[];
  /** ④用。重複4期の突き合わせで遡及修正が検出されたか（§4.3）。比較できなければ `false` */
  readonly epsHistoryRestated: boolean;
  /** ⑦用。同上 */
  readonly revenueHistoryRestated: boolean;
  /** ⑥用。取得できなければ `null`（IFRS企業は投資有価証券タグが無く項目単位でも `null` になりうる。§2.7） */
  readonly balanceSheet: EdinetBalanceSheetSnapshot | null;
  /**
   * 取り込めなかった値の記録（§4.2）。最新有報・1年前有報の両方ぶんがフラットに入り、
   * `sourceDocId` でどちらの有報由来かを区別する。**0件でも空配列**（`undefined` にしない）。
   */
  readonly diagnostics: readonly EdinetImportDiagnostic[];
}

export type EdinetHistoryError =
  | { readonly kind: 'invalid-code'; readonly code: string }
  /** docIDインデックスに該当エントリが無い（未上場・上場廃止・インデックス未整備等） */
  | { readonly kind: 'document-not-found'; readonly code: string }
  | { readonly kind: 'source-unreachable'; readonly detail: string }
  /**
   * EDINET が購読キーを受け付けなかった。**外部要因ではなく、こちらの設定の問題**。
   *
   * EDINET は認証失敗を HTTP 401 ではなく **HTTP 200 + 本文 `{"StatusCode": 401, ...}`**
   * で返す（2026-08-09 実測）。`malformed-response` と混ぜると「応答が壊れている」に
   * 化けて原因に辿り着けないため、別の種別として扱う。
   */
  | { readonly kind: 'authentication-failed' }
  | { readonly kind: 'malformed-response'; readonly detail: string };

export interface EdinetHistorySource {
  /**
   * 保存はしない。取得だけ（設計書 §4.6。IRバンク・Yahoo と同じ「取り込みは保存しない」原則）。
   * `index` は呼び出し側が注入する（案B・§4.4）。ポート自身はインデックスを構築しない。
   */
  fetchHistory(
    code: string,
    index: EdinetDocumentIndexLookup,
  ): Promise<Result<EdinetHistoryResult, EdinetHistoryError>>;
}
