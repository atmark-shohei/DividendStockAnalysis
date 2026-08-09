/**
 * EDINET 有価証券報告書の docID インデックス（案B・決定4）。**定義はドメイン側に置く**
 * （`.claude/CLAUDE.md`）。実装は `src/infra/d1/edinet-document-index-repository.ts`
 * （永続化）・`src/infra/edinet/edinet-client.ts`（`documents.json` の取得）。
 *
 * 仕様: `docs/02_design/logic/edinet-history-import.md` §4.4
 *
 * **銘柄ごとに日付を走査するのは非現実的。** 日付側から1回だけ走査して
 * `companyCode → docID` のインデックスを作り、全銘柄がそれを引く。
 *
 * ⚠️ 実装時の発見（`edinet-history-import.md` §0 相当）: `documents.json` の各書類は
 * `secCode`（証券コード＋チェックディジット）を含む。設計書ドラフトの `edinetCode` 主キーを
 * **当アプリの `companyCode`** に変更した（`secCode` から変換すれば、EDINETコードリスト
 * （Shift_JIS ZIP）の取得・デコードが丸ごと不要になるため）。
 */

import { type Result } from '../shared/result';

/** docIDインデックスの1エントリ */
export interface EdinetDocumentIndexEntry {
  /** 当アプリの銘柄コード（4文字）。`documents.json` の `secCode` から変換して保存する */
  readonly companyCode: string;
  readonly fiscalYear: number;
  readonly docId: string;
  /** UTC の ISO 8601。`documents.json` の `submitDateTime`（JST）から変換する */
  readonly submittedAt: string;
}

/**
 * `fetchHistory` が読むだけの窓口（案B）。書き込みは
 * `refresh-edinet-document-index` 専用ユースケースに限る。
 */
export interface EdinetDocumentIndexLookup {
  /** 特定の決算年度のエントリ。無ければ `null`（1年前の有報を探すのに使う） */
  findDocId(companyCode: string, fiscalYear: number): Promise<EdinetDocumentIndexEntry | null>;
  /** 対象銘柄の最新（決算年度が最大の）エントリ。無ければ `null` */
  findLatest(companyCode: string): Promise<EdinetDocumentIndexEntry | null>;
}

/**
 * 日次バッチが書き込む窓口。定義は domain に置くが、実装（D1）は
 * `src/infra/d1/` に限る（`.claude/rules/path-conventions.md`）。
 */
export interface EdinetDocumentIndexRepository extends EdinetDocumentIndexLookup {
  /** 主キー `(companyCode, fiscalYear)` で upsert する。同じキーへの再実行は上書きする */
  upsertMany(entries: readonly EdinetDocumentIndexEntry[]): Promise<void>;
  /** 鮮度判定用。最後にバッチが正常終了した日時（UTC ISO 8601）。未実行なら `null` */
  lastRefreshedAt(): Promise<string | null>;
  /** バッチが1回正常終了したことを記録する（`entryCount` は障害調査用） */
  recordRefresh(refreshedAt: string, entryCount: number): Promise<void>;
}

export type EdinetDocumentsListError =
  | { readonly kind: 'source-unreachable'; readonly detail: string }
  /** 購読キーが受け付けられなかった。詳細は `EdinetHistoryError` の同名の種別を参照 */
  | { readonly kind: 'authentication-failed' }
  | { readonly kind: 'malformed-response'; readonly detail: string };

/**
 * 日次バッチ（`refresh-edinet-document-index`）が使う、書類一覧の取得ポート。
 *
 * `IrBankFinancialSource.fetchByCode` と同じ思想で、フィルタ・変換済みの
 * `EdinetDocumentIndexEntry[]` を返す（`formCode` フィルタ・`secCode`→`companyCode` 変換・
 * JST→UTC変換は取得層の実装〈`src/infra/edinet/parse-documents-list.ts`〉に閉じる。
 * usecase は infra を import できないため、domain 型で受け渡す）。
 */
export interface EdinetDocumentsListSource {
  /** 指定した暦日（`YYYY-MM-DD`）にEDINETへ提出された、有価証券報告書の候補一覧を取得する */
  fetchByDate(
    date: string,
  ): Promise<Result<readonly EdinetDocumentIndexEntry[], EdinetDocumentsListError>>;
}
