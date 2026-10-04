/**
 * @deprecated 移行ブリッジ。実体は `src/domain/scoring/score-band.ts`。
 *
 * **ここに新しいロジックを足さない。** 移行台帳は `docs/migration-plan.md` §4.3。
 */

export {
  assertContiguous,
  lookupPoints,
  lookupPointsByValue,
  validateBands,
} from '@/domain/scoring/score-band';
export type { ScoreBand } from '@/domain/scoring/score-band';
