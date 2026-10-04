import { describe, expect, it } from 'vitest';

import { DIVIDEND_YIELD_BANDS, calculateDividendYield } from '@/domain/scoring/dividend-yield';
import { type ScoreBand } from '@/domain/scoring/score-band';

/**
 * 指標⑩ 配当利回り — `bands` 引数（T-101 指標カスタマイズ）に絞ったテスト。
 *
 * 判定ロジックそのもの（境界値・0円・株価欠損など）の網羅は
 * `tests/lib/scoring/dividend-yield.test.ts`（移行ブリッジ経由）が既に尽くしている。
 * ここで見たいのは「`bands` を渡すと省略時と異なる判定になる」ことだけ。
 */

const YEN = 100; // 1 円 = 100 銭
const PRICE_10K_YEN_SEN = 1_000_000; // 10,000円

function input(dividendYen: number) {
  return {
    priceSen: PRICE_10K_YEN_SEN,
    dividend: { amountSen: Math.round(dividendYen * YEN), source: 'forecast' as const },
  };
}

describe('⑩ 配当利回り — カスタム bands（T-101 指標カスタマイズ）', () => {
  const ALWAYS_SEVEN: readonly ScoreBand[] = [{ minInclusive: null, maxExclusive: null, points: 7 }];

  it('省略時はデフォルト定数で判定する（利回り5.50%ちょうどは10点）', () => {
    // 10,000円に対し配当550円 → 利回り 5.50%
    expect(calculateDividendYield(input(550)).score).toBe(10);
  });

  it('bands を明示的に渡すとデフォルト定数と同じ結果になる（後方互換）', () => {
    const result = calculateDividendYield(input(550), DIVIDEND_YIELD_BANDS);
    expect(result.score).toBe(10);
  });

  it('カスタム bands を渡すと、デフォルトなら10点になる入力でも渡した bands の点数になる', () => {
    const result = calculateDividendYield(input(550), ALWAYS_SEVEN);
    expect(result.score).toBe(7);
  });
});
