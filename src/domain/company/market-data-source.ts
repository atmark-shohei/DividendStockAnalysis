/**
 * 外部データ源（Yahoo Finance の chart エンドポイント）から株価・配当履歴・株式分割を
 * 取り込むためのポート。**定義はドメイン側に置く**（`.claude/CLAUDE.md`）。
 * 実装は `src/infra/yahoo/`。
 *
 * `FinancialSource`（IRバンク）とは別ポートにする。扱う関心事が違うため
 * （仕様 §1.1）。株価が取れなくても財務は使える、逆もまた然り。
 *
 * 仕様: `docs/02_design/logic/market-data-source.md`
 * 決定: `docs/adr/0010-yahoo-chart-endpoint.md`
 */

import { type Result } from '../shared/result';
import { type ImportDiagnostic } from './financial-source';

/**
 * 1回ぶんの配当。決算年度への集計前の生データ。
 *
 * ⚠️ **`amountYenText` は数値ではなく文字列。** 設計書 §4.1 の型は
 * `amountYen: number`（円・小数）だが、`.claude/rules/backend.md`
 * 「浮動小数点で金額計算をしない」に反するため、ユーザー確定事項（案B。
 * 設計書 §3.4 の囲み・§8-9）でこの文字列表現に置き換えた。
 *
 * Yahoo の JSON は配当額を常に `number`（double）で返すため、`JSON.parse` を
 * 経由すると値が丸め誤差を持つ double になってしまう。infra 側
 * （`src/infra/yahoo/parse-chart.ts`）がレスポンス本文（テキスト）から
 * 数値リテラルを**文字列のまま**抽出して、この型に詰める。
 *
 * 数値への変換・銭への丸めは決算年度への集計時（`dividend-fiscal-year.ts`）に
 * 行う。個々の支払いではなく年度合計を丸める（§3.4「合算してから丸める」）ため、
 * 変換そのものもその時点まで遅延させる。
 */
export interface DividendPayment {
  /** 権利落ち日。`YYYY-MM-DD`（UTC の日付成分。§3.1） */
  readonly exDividendDate: string;
  /** 円の金額を表す数値リテラルの文字列（例: `"0.745833"`）。分割調整済み */
  readonly amountYenText: string;
}

export interface SplitEvent {
  /** `YYYY-MM-DD` */
  readonly date: string;
  /** 分割後 / 分割前。`> 1` が分割、`< 1` が併合（§3.5） */
  readonly numerator: number;
  readonly denominator: number;
}

export interface MarketData {
  readonly code: string;
  /** **英語名のみ。** 日本語名は取れない（§2.2）。取れなければ `null` */
  readonly name: string | null;
  /** 銭。取れなければ `null` */
  readonly priceSen: number | null;
  /** 株価の観測時刻。UTC の ISO 8601。**株価があるなら必ず非 `null`**（§3.3） */
  readonly priceAsOf: string | null;
  /** 権利落ち日の昇順。**決算年度への集計はここではしない**（§4.2） */
  readonly dividendPayments: readonly DividendPayment[];
  /**
   * スコアリング・自動反映には使わない。参考情報として画面へ表示するために保持する
   * （§8-17 ユーザー確定事項: 参考表示のみ許可）。
   */
  readonly splits: readonly SplitEvent[];
  readonly diagnostics: readonly ImportDiagnostic[];
}

/**
 * 取り込みが成立しなかった理由。IRバンク版（`FinancialSourceError`）と違い
 * `code-mismatch` / `no-usable-year` は無い（設計書 §4.1・§8-13）。
 */
export type MarketDataError =
  /** 銘柄コードの形式が違う。外部へ問い合わせるまでもない */
  | { readonly kind: 'invalid-code'; readonly code: string }
  /** その銘柄のデータが無い（`chart.error` が非 `null`） */
  | { readonly kind: 'source-not-found'; readonly code: string }
  /** 通信できなかった。リトライ後も失敗した場合、または 429 を含む */
  | { readonly kind: 'source-unreachable'; readonly detail: string }
  /** 応答は返ったが、JSON として読めなかった */
  | { readonly kind: 'malformed-response'; readonly detail: string }
  /** JSON としては読めたが、期待した構造になっていない */
  | { readonly kind: 'unexpected-shape'; readonly detail: string };

export interface MarketDataSource {
  /**
   * 銘柄コードで株価・配当履歴・株式分割を取り込む。**保存はしない。**
   *
   * **決算月は受け取らない。** 決算年度への集計は取得と分離する（§4.2）。
   * 集計は別のデータ源（IRバンク）由来の決算月が要り、ポートに渡すと
   * Yahoo の実装が IRバンクの都合を知ることになってしまう。
   *
   * 一銘柄しか受け付けない。一覧の一括更新のような機能をここに追加しない
   * （個人利用限定のレート制限。設計書 §1.2・§5.1）。
   */
  fetchByCode(code: string): Promise<Result<MarketData, MarketDataError>>;
}
