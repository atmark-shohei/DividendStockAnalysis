/**
 * @deprecated 移行ブリッジ。実体は `src/domain/scoring/dividend-yield.ts` と
 * `src/domain/company/dividend-record.ts` にある。
 *
 * 軽量DDD への移行中、呼び出し側を一度に書き換えないための再エクスポート。
 * **ここに新しいロジックを足さない。** 移行台帳は `docs/migration-plan.md` §4.3。
 */

export {
  DIVIDEND_YIELD_BANDS,
  MAX_DIVIDEND_SEN,
  MAX_PRICE_SEN,
  calculateDividendYield,
  dividendYieldToMetricScore,
} from '@/domain/scoring/dividend-yield';
export type {
  DividendYieldInput,
  DividendYieldResult,
  YieldUnavailableReason,
} from '@/domain/scoring/dividend-yield';

export { selectAnnualDividend } from '@/domain/company/dividend-record';
export type {
  DividendRecord,
  DividendRecordKind,
  DividendSource,
  SelectedDividend,
} from '@/domain/company/dividend-record';

/** @deprecated `Sen` は `@/domain/shared/sen` にある branded type を使う */
export type Sen = number;
