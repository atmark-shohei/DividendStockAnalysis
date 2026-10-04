/**
 * IRバンクの静的 JSON を取得する `FinancialSource` 実装。
 *
 * 仕様: `docs/02_design/logic/irbank-json-import.md` §4
 * 決定: `docs/adr/0007-irbank-json-direct-fetch.md`
 *
 * **ここだけがネットワークを知る。** パースは `parse-fy-data.ts`（純粋関数）。
 * 分けているのは、規約面で自動取得ができなくなったときに前段だけ差し替えられる
 * ようにするため（ADR-0007「見直しのトリガー」）。
 */

import {
  type FinancialSource,
  type FinancialSourceError,
  type ImportedFinancials,
} from '../../domain/company/financial-source';
import { type Result, err } from '../../domain/shared/result';
import { parseFyData } from './parse-fy-data';

const DEFAULT_BASE_URL = 'https://f.irbank.net/files';

/** 応答が無いまま待ち続けない。Worker の実行時間を食い潰さない */
const TIMEOUT_MS = 5_000;

/**
 * リトライは**1回だけ**（`.claude/rules/backend.md`「無限リトライしない」）。
 * 1回しか試さないので指数バックオフにする意味は無く、固定待機にしている。
 */
const RETRY_DELAY_MS = 1_000;

/** 銘柄コード。4文字固定（`handler/dto/company-input.ts` と同じ形式） */
const COMPANY_CODE = /^\d{3}[0-9A-Z]$/;

async function defaultSleep(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export interface IrBankFinancialSourceDependencies {
  /** テストから差し替える。**テストで実 API を叩かない**（`.claude/rules/backend.md`） */
  readonly fetch?: typeof globalThis.fetch;
  /** リトライ前の待機。テストでは即座に解決させる */
  readonly sleep?: (milliseconds: number) => Promise<void>;
  readonly baseUrl?: string;
}

/** 1回の試行の結果。`retryable` はもう一度だけ試す価値がある失敗 */
type Attempt =
  | { readonly kind: 'done'; readonly result: Result<ImportedFinancials, FinancialSourceError> }
  | { readonly kind: 'retryable'; readonly detail: string };

function done(result: Result<ImportedFinancials, FinancialSourceError>): Attempt {
  return { kind: 'done', result };
}

export class IrBankFinancialSource implements FinancialSource {
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly baseUrl: string;

  constructor(dependencies: IrBankFinancialSourceDependencies = {}) {
    this.fetchImpl = dependencies.fetch ?? globalThis.fetch.bind(globalThis);
    this.sleep = dependencies.sleep ?? defaultSleep;
    this.baseUrl = dependencies.baseUrl ?? DEFAULT_BASE_URL;
  }

  async fetchByCode(code: string): Promise<Result<ImportedFinancials, FinancialSourceError>> {
    const normalized = code.trim().toUpperCase();
    if (!COMPANY_CODE.test(normalized)) {
      // 形式が違うなら外部へ問い合わせるまでもない
      return err({ kind: 'invalid-code', code });
    }

    const url = `${this.baseUrl}/${normalized}/fy-data-all.json`;

    const first = await this.attempt(url, normalized);
    if (first.kind === 'done') return first.result;

    await this.sleep(RETRY_DELAY_MS);

    const second = await this.attempt(url, normalized);
    if (second.kind === 'done') return second.result;

    return err({ kind: 'source-unreachable', detail: second.detail });
  }

  private async attempt(url: string, code: string): Promise<Attempt> {
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        // 302 は「その銘柄のデータが無い」。追いかけると HTML を掴まされる
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { accept: 'application/json' },
      });
    } catch (cause) {
      // タイムアウトも通信失敗もここに来る。どちらももう一度だけ試す
      return { kind: 'retryable', detail: describeCause(cause) };
    }

    if (response.status >= 300 && response.status < 400) {
      return done(err({ kind: 'source-not-found', code }));
    }
    if (response.status === 404) {
      return done(err({ kind: 'source-not-found', code }));
    }
    if (response.status >= 500) {
      return { kind: 'retryable', detail: `HTTP ${String(response.status)}` };
    }
    if (!response.ok) {
      return done(err({ kind: 'source-unreachable', detail: `HTTP ${String(response.status)}` }));
    }

    // 存在しない銘柄が HTML を 200 で返す経路への保険
    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.includes('application/json')) {
      return done(err({ kind: 'source-not-found', code }));
    }

    let raw: unknown;
    try {
      raw = JSON.parse(await response.text());
    } catch (cause) {
      return done(err({ kind: 'malformed-response', detail: describeCause(cause) }));
    }

    return done(parseFyData(raw, code));
  }
}

/**
 * ログ用の短い説明にする。
 *
 * **例外オブジェクトをそのまま持ち回らない。** スタックトレースや URL が
 * API のエラー本文に混ざると内部情報の漏洩になる（`.claude/rules/backend.md`）。
 */
function describeCause(cause: unknown): string {
  if (cause instanceof Error) return cause.name;
  return typeof cause;
}
