import { describe, expect, it } from 'vitest';

import { type ScoreBand } from '@/domain/scoring/score-band';
import { calculateDividendGrowthRate } from '@/domain/scoring/dividend-growth-rate';
import { CAGR_BASE_SEN, atLeastGrowth, justUnderGrowth } from '../../helpers/cagr';
import { sen } from '../../helpers/sen';

/**
 * 指標① 直近5年間の増配率（配当の5年 CAGR）。
 * 仕様: docs/02_design/logic/dividend-growth-rate-scoring.md
 *
 * この指標の表は §0.2 の訂正（0%〜2% → 1点）を含む。原典には穴があった。
 */

const scoreAt = (lastYear: number, fiveYearsAgo = CAGR_BASE_SEN) =>
  calculateDividendGrowthRate({
    dividendLastYear: sen(lastYear),
    dividendFiveYearsAgo: sen(fiveYearsAgo),
  }).score;

describe('① 増配率 — 6.1 境界値ちょうど', () => {
  it.each([
    { percent: 30, points: 10 },
    { percent: 20, points: 9 },
    { percent: 15, points: 8 },
    { percent: 12, points: 7 },
    { percent: 10, points: 6 },
    { percent: 8, points: 5 },
    { percent: 5, points: 4 },
    { percent: 3, points: 3 },
    { percent: 2, points: 2 },
  ])('増配率 $percent% ちょうどは $points 点', ({ percent, points }) => {
    const result = calculateDividendGrowthRate({
      dividendLastYear: sen(atLeastGrowth(percent)),
      dividendFiveYearsAgo: sen(CAGR_BASE_SEN),
    });
    expect(result.value).toBeGreaterThanOrEqual(percent);
    expect(result.score).toBe(points);
  });

  it('20% ちょうどは 9点。10点ではない（§6.1 が名指しで指定している）', () => {
    expect(scoreAt(atLeastGrowth(20))).toBe(9);
    expect(scoreAt(justUnderGrowth(20))).toBe(8);
  });

  it('0.0% は 0点。1点ではない', () => {
    expect(scoreAt(CAGR_BASE_SEN)).toBe(0);
  });

  it('1 銭でも増配していれば 1点（§0.2 の訂正が効いている）', () => {
    expect(scoreAt(CAGR_BASE_SEN + 1)).toBe(1);
  });
});

describe('① 増配率 — 6.2 負の値', () => {
  it('減配（CAGR が負）は 0点。表に明示があるので §0.3 の対象外', () => {
    const result = calculateDividendGrowthRate({
      dividendLastYear: sen(CAGR_BASE_SEN / 2),
      dividendFiveYearsAgo: sen(CAGR_BASE_SEN),
    });
    expect(result.score).toBe(0);
    expect(result.unavailableReason).toBeNull();
  });

  it.each([
    { label: '昨年が負', last: -1_000, ago: 1_000 },
    { label: '5年前が負', last: 1_000, ago: -1_000 },
  ])('$label は制度上ありえないのでデータ不良として判定不能', ({ last, ago }) => {
    const result = calculateDividendGrowthRate({
      dividendLastYear: sen(last),
      dividendFiveYearsAgo: sen(ago),
    });
    expect(result.score).toBeNull();
    expect(result.unavailableReason).toBe('input-invalid');
  });
});

describe('① 増配率 — 6.3 無配・0', () => {
  it('5年前が 0（当時無配）はゼロ除算で判定不能。0点ではない', () => {
    const result = calculateDividendGrowthRate({
      dividendLastYear: sen(1_000),
      dividendFiveYearsAgo: sen(0),
    });
    expect(result.score).toBeNull();
    expect(result.unavailableReason).toBe('division-by-zero');
  });

  it('昨年が 0（減配して無配）は -100% で 0点。判定不能ではない', () => {
    const result = calculateDividendGrowthRate({
      dividendLastYear: sen(0),
      dividendFiveYearsAgo: sen(CAGR_BASE_SEN),
    });
    expect(result.score).toBe(0);
    expect(result.value).toBe(-100);
    expect(result.unavailableReason).toBeNull();
  });

  it('「5年前が 0」と「昨年が 0」は結果が違う。混同しない', () => {
    const zeroBase = calculateDividendGrowthRate({
      dividendLastYear: sen(1_000),
      dividendFiveYearsAgo: sen(0),
    });
    const zeroNow = calculateDividendGrowthRate({
      dividendLastYear: sen(0),
      dividendFiveYearsAgo: sen(1_000),
    });
    expect(zeroBase.score).toBeNull();
    expect(zeroNow.score).toBe(0);
  });
});

describe('① 増配率 — カスタム bands（T-101 指標カスタマイズ）', () => {
  /** 下限・上限とも null（=常に該当）の単一区分。「bands を渡すと判定が切り替わる」ことだけを見る */
  const ALWAYS_SEVEN: readonly ScoreBand[] = [{ minInclusive: null, maxExclusive: null, points: 7 }];

  it('省略時はデフォルト定数で判定する（20%ちょうどは9点）', () => {
    expect(scoreAt(atLeastGrowth(20))).toBe(9);
  });

  it('カスタム bands を渡すと、デフォルトなら9点になる入力でも渡した bands の点数になる', () => {
    const result = calculateDividendGrowthRate(
      { dividendLastYear: sen(atLeastGrowth(20)), dividendFiveYearsAgo: sen(CAGR_BASE_SEN) },
      ALWAYS_SEVEN,
    );
    expect(result.score).toBe(7);
  });
});

describe('① 増配率 — 6.4 データ欠損', () => {
  it.each([
    { label: '昨年が null', last: null, ago: 1_000 },
    { label: '5年前が null', last: 1_000, ago: null },
  ])('$label なら判定不能。0 を返さない', ({ last, ago }) => {
    const result = calculateDividendGrowthRate({
      dividendLastYear: last === null ? null : sen(last),
      dividendFiveYearsAgo: ago === null ? null : sen(ago),
    });
    expect(result.score).toBeNull();
    expect(result.value).toBeNull();
    expect(result.unavailableReason).toBe('input-missing');
  });
});
