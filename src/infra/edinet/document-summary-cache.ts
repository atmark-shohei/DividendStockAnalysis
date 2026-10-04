/**
 * EDINET有価証券報告書のパース結果キャッシュのポート（`docs/02_design/logic/edinet-history-import.md` §4.8）。
 *
 * **ポートも実装も infra に閉じる（domain には置かない）。** `EdinetDocumentIndexLookup` とは
 * 非対称になるが正当な理由がある。あちらは usecase/handler が組み立てて `fetchHistory` の
 * 引数として渡す必要があるため domain のポートでなければならない。一方このキャッシュは
 * `EdinetClient` の内側だけで完結し、domain も usecase も一度も触れないため、domain に
 * 置く必然性が無い（§4.8.2）。
 *
 * `EdinetClient` はコンストラクタでこれを受け取る（`fetchHistory` の引数にしない。
 * ポートの契約に「キャッシュが在ること」を漏らさないため。§4.8.2）。
 */

import { type ParsedSummaryCsv, type SummaryCsvDiagnostic } from './parse-summary-csv';

/**
 * `CURRENT_SCHEMA_VERSION` を上げる基準（§4.8.3・設計書2026-08-12明確化）。
 * 次のいずれかを変更したときは**必ず**上げる:
 * - `EdinetDocumentSummary` の形（フィールド構成）
 * - `parse-summary-csv.ts` の候補要素IDリストの変更（フォールバック順の追加・削除・並び替え）
 * - `parse-summary-csv.ts` の単位検証ロジックの変更（§4.2 の許容単位の変更）
 * - `parse-summary-csv.ts` の数値パースロジックの変更（銭化・丸め・安全整数チェックの変更）
 *
 * T-054 で `EdinetDocumentSummary` に `operatingIncomeSenByOffset`（⑧用）を追加したため
 * 1→2 に上げた。旧版（`operatingIncomeSenByOffset` を持たない payload）はスキーマ版不一致で
 * キャッシュミス扱いになり、再取得時に現行版で上書きされる（§4.8.3）。
 */
export const CURRENT_SCHEMA_VERSION = 2;

/**
 * 有報1本ぶんのパース結果。**`docId` 単位で完結する事実だけを持つ。**
 * 銘柄コードも年度も持たない（それを知っているのは `edinet_document_index`）。
 *
 * `src/infra/edinet/parse-summary-csv.ts` の `ParsedSummaryCsv` と同じ形。
 * **`ParsedSummaryCsv` はドメインへ移設しない**（2026-08-12 決定。§4.8.2）。
 * このキャッシュは `EdinetClient` の内部実装の都合であり、domain も usecase も
 * 一切触れないため、型もドメインへは移さず本ファイル（infra側）に置く。
 * `parseSummaryCsv()` は引き続き `ParsedSummaryCsv` を返し、`EdinetClient` の内側で
 * 本キャッシュの `EdinetDocumentSummary` へ詰め替える。詰め替えは本ファイルの
 * `toCacheEntry`/`fromCacheEntry`（フィールドを1つずつ列挙する明示的な変換関数）で行い、
 * 構造的部分型に暗黙依存しない（CR-3・2026-08-15 修正）。
 */
export interface EdinetDocumentSummary {
  /** 添字0=当期 〜 4=四期前。銭 */
  readonly epsSenByOffset: readonly (number | null)[];
  /** 同上 */
  readonly revenueSenByOffset: readonly (number | null)[];
  /** ⑤用。同上。**%**（§4.1.1） */
  readonly roePercentByOffset: readonly (number | null)[];
  /** ⑧用。添字0=当期・1=前期のみ（長さ2固定。§4.8.3.1）。銭 */
  readonly operatingIncomeSenByOffset: readonly (number | null)[];
  readonly balanceSheet: {
    readonly currentAssetsSen: number | null;
    readonly investmentSecuritiesSen: number | null;
  };
  /**
   * **キャッシュにも一緒に保存して復元する**（§4.8.5）。
   * 診断は「その書類のどのタグが読めなかったか」という書類の性質であって、
   * 取得の都合ではない。ヒット時に消えると応答が取得経路によって変わる
   */
  readonly diagnostics: readonly SummaryCsvDiagnostic[];
}

/**
 * `ParsedSummaryCsv` → `EdinetDocumentSummary` への明示的な変換（CR-3）。
 *
 * フィールドを1つずつ列挙してコピーする。以前は `EdinetClient` 側で構造的部分型に
 * 暗黙依存していたが、これだとどちらかの型にフィールドが増えても
 * コンパイルエラーにならず同期忘れを検出できなかった（余剰プロパティは代入時に
 * チェックされないため）。ここで明示的に列挙することで、フィールド追加時に
 * この関数がコンパイルエラーになり、機械的に検出できるようにする。
 */
export function toCacheEntry(parsed: ParsedSummaryCsv): EdinetDocumentSummary {
  return {
    epsSenByOffset: parsed.epsSenByOffset,
    revenueSenByOffset: parsed.revenueSenByOffset,
    roePercentByOffset: parsed.roePercentByOffset,
    operatingIncomeSenByOffset: parsed.operatingIncomeSenByOffset,
    balanceSheet: {
      currentAssetsSen: parsed.balanceSheet.currentAssetsSen,
      investmentSecuritiesSen: parsed.balanceSheet.investmentSecuritiesSen,
    },
    diagnostics: parsed.diagnostics,
  };
}

/** `EdinetDocumentSummary` → `ParsedSummaryCsv` への明示的な変換（CR-3。上記の逆方向） */
export function fromCacheEntry(summary: EdinetDocumentSummary): ParsedSummaryCsv {
  return {
    epsSenByOffset: summary.epsSenByOffset,
    revenueSenByOffset: summary.revenueSenByOffset,
    roePercentByOffset: summary.roePercentByOffset,
    operatingIncomeSenByOffset: summary.operatingIncomeSenByOffset,
    balanceSheet: {
      currentAssetsSen: summary.balanceSheet.currentAssetsSen,
      investmentSecuritiesSen: summary.balanceSheet.investmentSecuritiesSen,
    },
    diagnostics: summary.diagnostics,
  };
}

/**
 * パース結果のキャッシュ（§4.8）。**`docId` は不変なので無効化を持たない。**
 */
export interface EdinetDocumentSummaryCache {
  /**
   * 無ければ `null`。**保存時とスキーマ版が違う行も `null` を返す**（§4.8.3）。
   * **読み取りに失敗しても throw しない。** ミスとして扱う（§4.8.5）
   */
  find(docId: string): Promise<EdinetDocumentSummary | null>;
  /**
   * 上書き保存（`doc_id` 主キーの upsert）。
   * **書き込みに失敗しても throw しない。** 取り込みを巻き込まない（§4.8.5）
   */
  save(docId: string, summary: EdinetDocumentSummary): Promise<void>;
}
