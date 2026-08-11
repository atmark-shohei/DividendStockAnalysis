/**
 * EDINET API v2 を叩く `EdinetHistorySource` / `EdinetDocumentsListSource` 実装。
 *
 * 仕様: `docs/02_design/logic/edinet-history-import.md` §2・§4.4・§4.5・§7.5
 * 決定: `docs/adr/0011-edinet-financial-history-api.md`
 *
 * **ここだけがネットワークを知る。** パースは `parse-summary-csv.ts` /
 * `parse-documents-list.ts`（純粋関数）、ZIP展開は `unzip-edinet-document.ts`。
 * `fy-data-client.ts` / `chart-client.ts` と同じ構成にする（取得層だけを
 * 差し替えられるようにするため）。
 */

import {
  type EdinetDocumentIndexEntry,
  type EdinetDocumentIndexLookup,
  type EdinetDocumentsListError,
  type EdinetDocumentsListSource,
} from '../../domain/company/edinet-document-index';
import { mergeEdinetFilings } from '../../domain/company/edinet-history-merge';
import {
  type EdinetHistoryError,
  type EdinetHistoryResult,
  type EdinetHistorySource,
  type EdinetImportDiagnostic,
} from '../../domain/company/edinet-history-source';
import { type Result, err, ok } from '../../domain/shared/result';
import { parseDocumentsListResponse, toDocumentIndexEntries } from './parse-documents-list';
import {
  type ParsedSummaryCsv,
  type SummaryCsvDiagnostic,
  parseSummaryCsv,
} from './parse-summary-csv';
import { unzipSummaryCsv } from './unzip-edinet-document';

const DEFAULT_BASE_URL = 'https://api.edinet-fsa.go.jp/api/v2';

/** 応答が無いまま待ち続けない。Worker の実行時間を食い潰さない（§7.5） */
const TIMEOUT_MS = 5_000;

/**
 * リトライは**1回だけ**（`.claude/rules/backend.md`「無限リトライしない」）。
 * 1回しか試さないので指数バックオフにする意味は無く、固定待機にしている。
 */
const RETRY_DELAY_MS = 1_000;

/** 銘柄コード。4文字固定（他のクライアントと同じ形式） */
const COMPANY_CODE = /^\d{3}[0-9A-Z]$/;

async function defaultSleep(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function describeCause(cause: unknown): string {
  if (cause instanceof Error) return cause.name;
  return typeof cause;
}

/**
 * **EDINET は認証に失敗しても HTTP 200 を返す。** 本文に
 * `{"StatusCode": 401, "message": "Access denied due to invalid subscription key..."}`
 * が入る（2026-08-09 実測。`documents.json` / `documents/{docId}` の両方で同じ）。
 *
 * HTTP ステータスだけを見ていると 200 = 成功として先へ進み、`results` が無いことで
 * `malformed-response`（応答が壊れている）に化ける。実際の原因（キーが無効）から
 * 遠ざかるので、本文の形で判定する。
 */
function isAuthenticationFailure(body: unknown): boolean {
  if (typeof body !== 'object' || body === null) return false;
  const statusCode = (body as Record<string, unknown>)['StatusCode'];
  return statusCode === 401 || statusCode === '401';
}

/**
 * パース時点の診断に「どの有報の・どの年度の話か」を付ける（純粋関数。設計書 §4.2）。
 *
 * 最新有報と1年前有報の診断が1つの配列に混ざるため、`offset`（その有報の当期を 0 とする
 * 相対値）だけでは年度が特定できない。`currentFiscalYear - offset` で絶対年度にする。
 *
 * 貸借対照表項目（`offset === null`）は `fiscalYear` を埋めない。前期末時点ではあるが、
 * `EdinetBalanceSheetSnapshot` が年度を持たない設計（§5）と矛盾させないため。
 */
export function attributeDiagnostics(
  diagnostics: readonly SummaryCsvDiagnostic[],
  source: { readonly docId: string; readonly currentFiscalYear: number },
): readonly EdinetImportDiagnostic[] {
  return diagnostics.map((diagnostic) => ({
    ...diagnostic,
    fiscalYear: diagnostic.offset === null ? null : source.currentFiscalYear - diagnostic.offset,
    sourceDocId: source.docId,
  }));
}

export interface EdinetClientDependencies {
  /** EDINET API の Subscription-Key。**値をログ・エラーメッセージに出さない** */
  readonly apiKey: string;
  /** テストから差し替える。**テストで実 API を叩かない**（`.claude/rules/backend.md`） */
  readonly fetch?: typeof globalThis.fetch;
  /** リトライ前の待機。テストでは即座に解決させる */
  readonly sleep?: (milliseconds: number) => Promise<void>;
  readonly baseUrl?: string;
}

/** `fetchWithRetry` の結果。リトライを尽くした後の最終形なので `retryable` は現れない */
type FetchOutcome =
  | { readonly kind: 'response'; readonly response: Response }
  | { readonly kind: 'failed'; readonly detail: string };

/** 1回の試行の結果。`retryable` はもう一度だけ試す価値がある失敗 */
type SingleAttempt =
  | { readonly kind: 'response'; readonly response: Response }
  | { readonly kind: 'retryable'; readonly detail: string };

export class EdinetClient implements EdinetHistorySource, EdinetDocumentsListSource {
  private readonly apiKey: string;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly baseUrl: string;

  constructor(dependencies: EdinetClientDependencies) {
    this.apiKey = dependencies.apiKey;
    this.fetchImpl = dependencies.fetch ?? globalThis.fetch.bind(globalThis);
    this.sleep = dependencies.sleep ?? defaultSleep;
    this.baseUrl = dependencies.baseUrl ?? DEFAULT_BASE_URL;
  }

  async fetchByDate(
    date: string,
  ): Promise<Result<readonly EdinetDocumentIndexEntry[], EdinetDocumentsListError>> {
    const url = `${this.baseUrl}/documents.json?date=${encodeURIComponent(date)}&type=2&Subscription-Key=${encodeURIComponent(this.apiKey)}`;

    const attempt = await this.fetchWithRetry(url, { accept: 'application/json' });
    if (attempt.kind === 'failed')
      return err({ kind: 'source-unreachable', detail: attempt.detail });

    const { response } = attempt;
    if (response.status === 401 || response.status === 429) {
      return err({ kind: 'source-unreachable', detail: `HTTP ${String(response.status)}` });
    }
    if (!response.ok) {
      return err({ kind: 'source-unreachable', detail: `HTTP ${String(response.status)}` });
    }

    let raw: unknown;
    try {
      // content-type は検証しない。非JSON応答（HTMLエラーページ等）が来ても
      // JSON.parse の失敗で malformed-response として捕捉できるため、
      // 事前チェックを足しても得られるものが無いと判断した（CR-9・2026-08-08）
      raw = JSON.parse(await response.text());
    } catch (cause) {
      return err({ kind: 'malformed-response', detail: describeCause(cause) });
    }
    if (isAuthenticationFailure(raw)) return err({ kind: 'authentication-failed' });
    const parsed = parseDocumentsListResponse(raw);
    if (!parsed.ok) return parsed;
    return ok(toDocumentIndexEntries(parsed.value));
  }

  async fetchHistory(
    code: string,
    index: EdinetDocumentIndexLookup,
  ): Promise<Result<EdinetHistoryResult, EdinetHistoryError>> {
    const normalized = code.trim().toUpperCase();
    if (!COMPANY_CODE.test(normalized)) return err({ kind: 'invalid-code', code });

    const latest = await index.findLatest(normalized);
    if (latest === null) return err({ kind: 'document-not-found', code: normalized });

    const latestSummary = await this.fetchDocumentSummary(latest.docId);
    if (!latestSummary.ok) return latestSummary;

    const priorEntry = await index.findDocId(normalized, latest.fiscalYear - 1);
    const priorSummary =
      priorEntry === null ? null : await this.fetchDocumentSummary(priorEntry.docId);
    // 1年前有報の取得に失敗しても、既に取得済みの最新有報（5期分・⑥用BSスナップショット）を
    // 無駄にしない。インデックス未整備（priorEntry === null）と同じ「6期目が埋まらない」結果
    // として扱う（CR-5。設計書 §4.5 手順4の決定「無ければ null」を、取得失敗時にも適用する）
    const priorUsable =
      priorEntry !== null && priorSummary !== null && priorSummary.ok
        ? { entry: priorEntry, parsed: priorSummary.value }
        : null;

    const prior =
      priorUsable === null
        ? null
        : {
            fiscalYear: priorUsable.entry.fiscalYear,
            docId: priorUsable.entry.docId,
            epsSenByOffset: priorUsable.parsed.epsSenByOffset,
            revenueSenByOffset: priorUsable.parsed.revenueSenByOffset,
            roePercentByOffset: priorUsable.parsed.roePercentByOffset,
          };

    // 取り込めなかった値は捨てずに応答まで運ぶ（`.claude/rules/backend.md`・設計書 §4.2）。
    // 2本ぶんをフラットに連結し、`sourceDocId` でどちらの有報由来かを区別する。
    // 1年前有報を取得できなかった場合は、その有報の診断はそもそも存在しない（CR-5）
    const diagnostics: readonly EdinetImportDiagnostic[] = [
      ...attributeDiagnostics(latestSummary.value.diagnostics, {
        docId: latest.docId,
        currentFiscalYear: latest.fiscalYear,
      }),
      ...(priorUsable === null
        ? []
        : attributeDiagnostics(priorUsable.parsed.diagnostics, {
            docId: priorUsable.entry.docId,
            currentFiscalYear: priorUsable.entry.fiscalYear,
          })),
    ];

    const merged = mergeEdinetFilings({
      latest: {
        fiscalYear: latest.fiscalYear,
        docId: latest.docId,
        epsSenByOffset: latestSummary.value.epsSenByOffset,
        revenueSenByOffset: latestSummary.value.revenueSenByOffset,
        roePercentByOffset: latestSummary.value.roePercentByOffset,
      },
      prior,
    });

    return ok({
      years: merged.years,
      epsHistoryRestated: merged.epsHistoryRestated,
      revenueHistoryRestated: merged.revenueHistoryRestated,
      balanceSheet: {
        currentAssetsSen: latestSummary.value.balanceSheet.currentAssetsSen,
        investmentSecuritiesSen: latestSummary.value.balanceSheet.investmentSecuritiesSen,
        sourceDocId: latest.docId,
      },
      diagnostics,
    });
  }

  private async fetchDocumentSummary(
    docId: string,
  ): Promise<Result<ParsedSummaryCsv, EdinetHistoryError>> {
    const url = `${this.baseUrl}/documents/${encodeURIComponent(docId)}?type=5&Subscription-Key=${encodeURIComponent(this.apiKey)}`;

    const attempt = await this.fetchWithRetry(url, { accept: 'application/octet-stream' });
    if (attempt.kind === 'failed')
      return err({ kind: 'source-unreachable', detail: attempt.detail });

    const { response } = attempt;
    if (response.status === 401 || response.status === 429) {
      return err({ kind: 'source-unreachable', detail: `HTTP ${String(response.status)}` });
    }
    if (!response.ok) {
      return err({ kind: 'source-unreachable', detail: `HTTP ${String(response.status)}` });
    }

    // ZIP のはずが JSON なら、まず認証失敗を疑う（EDINET は HTTP 200 で返してくる）。
    // ここで見ておかないと ZIP 展開の失敗として `malformed-response` に化ける
    if ((response.headers.get('content-type') ?? '').includes('application/json')) {
      let body: unknown = null;
      try {
        body = JSON.parse(await response.text());
      } catch {
        // JSON ですらない。下の `malformed-response` に落とす
      }
      if (isAuthenticationFailure(body)) return err({ kind: 'authentication-failed' });
      return err({ kind: 'malformed-response', detail: 'ZIPではなくJSONが返った' });
    }

    let zipBytes: Uint8Array;
    try {
      zipBytes = new Uint8Array(await response.arrayBuffer());
    } catch (cause) {
      return err({ kind: 'malformed-response', detail: describeCause(cause) });
    }

    const unzipped = unzipSummaryCsv(zipBytes);
    if (!unzipped.ok) {
      return err({ kind: 'malformed-response', detail: unzipped.error.kind });
    }
    return ok(parseSummaryCsv(unzipped.value));
  }

  /**
   * 1回失敗しても、もう一度だけ試す（`.claude/rules/backend.md`「リトライは指数バックオフ。
   * 無限リトライしない」。1回のみなので固定待機）。
   *
   * ネットワーク例外・5xx は再試行の対象。401/429 を含むそれ以外の応答は
   * 呼び出し側がステータスで判断する（このメソッドは応答そのものを返す）。
   * リトライを尽くしてもネットワーク例外なら `failed` を返す。
   */
  private async fetchWithRetry(
    url: string,
    headers: Record<string, string>,
  ): Promise<FetchOutcome> {
    const first = await this.attemptFetch(url, headers);
    if (first.kind === 'response' && first.response.status < 500) return first;

    await this.sleep(RETRY_DELAY_MS);
    const second = await this.attemptFetch(url, headers);
    if (second.kind === 'retryable') return { kind: 'failed', detail: second.detail };
    return second;
  }

  private async attemptFetch(url: string, headers: Record<string, string>): Promise<SingleAttempt> {
    try {
      const response = await this.fetchImpl(url, {
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers,
      });
      return { kind: 'response', response };
    } catch (cause) {
      return { kind: 'retryable', detail: describeCause(cause) };
    }
  }
}
