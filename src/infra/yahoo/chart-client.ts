/**
 * Yahoo Finance の chart エンドポイントを取得する `MarketDataSource` 実装。
 *
 * 仕様: `docs/02_design/logic/market-data-source.md` §5
 * 決定: `docs/adr/0010-yahoo-chart-endpoint.md`
 *
 * **ここだけがネットワークを知る。** パースは `parse-chart.ts`（純粋関数）。
 * `fy-data-client.ts` と同じ構成にする（ADR-0007 と同じ理由。取得層だけを
 * 差し替えられるようにする）。
 */

import {
  type MarketData,
  type MarketDataError,
  type MarketDataSource,
} from '../../domain/company/market-data-source';
import { type Result, err } from '../../domain/shared/result';
import { parseChart } from './parse-chart';

const DEFAULT_BASE_URL = 'https://query1.finance.yahoo.com/v8/finance/chart';

/** 応答が無いまま待ち続けない。Worker の実行時間を食い潰さない */
const TIMEOUT_MS = 5_000;

/**
 * リトライは**1回だけ**（`.claude/rules/backend.md`「無限リトライしない」）。
 * 1回しか試さないので指数バックオフにする意味は無く、固定待機にしている。
 */
const RETRY_DELAY_MS = 1_000;

/** 銘柄コード。4文字固定（`fy-data-client.ts` と同じ形式） */
const COMPANY_CODE = /^\d{3}[0-9A-Z]$/;

/**
 * 送信する User-Agent。
 *
 * workerd の fetch は既定で UA を一切送らず、Yahoo の WAF は UA 無しのリクエストを
 * 429 で拒否する（2026-08-04 実測。workerd 上で UA 無し → 429、`node` → 200）。
 * **ブラウザを騙る文字列は使わない**（ADR-0010 決定#2）。Node の undici が既定で
 * 送っているのと同じ、素っ気ない値をそのまま使う。
 */
const USER_AGENT = 'node';

async function defaultSleep(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export interface YahooChartMarketDataSourceDependencies {
  /** テストから差し替える。**テストで実 API を叩かない**（`.claude/rules/backend.md`） */
  readonly fetch?: typeof globalThis.fetch;
  /** リトライ前の待機。テストでは即座に解決させる */
  readonly sleep?: (milliseconds: number) => Promise<void>;
  readonly baseUrl?: string;
}

/** 1回の試行の結果。`retryable` はもう一度だけ試す価値がある失敗 */
type Attempt =
  | { readonly kind: 'done'; readonly result: Result<MarketData, MarketDataError> }
  | { readonly kind: 'retryable'; readonly detail: string };

function done(result: Result<MarketData, MarketDataError>): Attempt {
  return { kind: 'done', result };
}

export class YahooChartMarketDataSource implements MarketDataSource {
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly baseUrl: string;

  constructor(dependencies: YahooChartMarketDataSourceDependencies = {}) {
    this.fetchImpl = dependencies.fetch ?? globalThis.fetch.bind(globalThis);
    this.sleep = dependencies.sleep ?? defaultSleep;
    this.baseUrl = dependencies.baseUrl ?? DEFAULT_BASE_URL;
  }

  async fetchByCode(code: string): Promise<Result<MarketData, MarketDataError>> {
    const normalized = code.trim().toUpperCase();
    if (!COMPANY_CODE.test(normalized)) {
      // 形式が違うなら外部へ問い合わせるまでもない
      return err({ kind: 'invalid-code', code });
    }

    const url = `${this.baseUrl}/${normalized}.T?range=max&interval=1mo&events=div%7Csplit`;

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
        signal: AbortSignal.timeout(TIMEOUT_MS),
        // workerd の fetch は User-Agent を送らない。UA 無しのリクエストを Yahoo の
        // WAF が 429 で拒否するため、明示的に付ける必要がある（2026-08-04 実測。
        // 設計書 §2.1 / §5、ADR-0010 の「2026-08-04 追記」）。
        // **ブラウザを騙る文字列は使わない**（規約回避の意図と解釈されうる）。
        headers: { accept: 'application/json', 'user-agent': USER_AGENT },
      });
    } catch (cause) {
      // タイムアウトも通信失敗もここに来る。どちらももう一度だけ試す
      return { kind: 'retryable', detail: describeCause(cause) };
    }

    if (response.status === 404) {
      return done(err({ kind: 'source-not-found', code }));
    }
    if (response.status === 429) {
      // yfinance 利用者から Too Many Requests の報告がある。**リトライを増やさない**
      // （§5.1。`fy-data-client.ts` の 302 と同じ「即座に諦める」扱い）
      return done(err({ kind: 'source-unreachable', detail: 'HTTP 429' }));
    }
    if (response.status >= 500) {
      return { kind: 'retryable', detail: `HTTP ${String(response.status)}` };
    }
    if (!response.ok) {
      return done(err({ kind: 'source-unreachable', detail: `HTTP ${String(response.status)}` }));
    }

    const text = await response.text();
    return done(parseChart(text, code));
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
