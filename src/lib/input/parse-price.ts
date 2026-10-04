/**
 * @deprecated 移行ブリッジ。実体は `src/handler/dto/price-input.ts`。
 *
 * 入力文字列の検証は handler 層の責務になった。
 * **ここに新しいロジックを足さない。** 移行台帳は `docs/migration-plan.md` §4.3。
 */

export { parsePriceInput } from '@/handler/dto/price-input';
export type { PriceInputResult } from '@/handler/dto/price-input';
