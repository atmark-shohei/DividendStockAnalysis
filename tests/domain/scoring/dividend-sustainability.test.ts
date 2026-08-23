import { describe, expect, it } from 'vitest';

import {
  INVESTMENT_SECURITIES_RATE,
  calculateDividendSustainability,
  netCashSen,
} from '@/domain/scoring/dividend-sustainability';
import { type ScoreBand } from '@/domain/scoring/score-band';
import { sen } from '../../helpers/sen';

/**
 * 指標⑥ 配当維持可能年数。
 * 仕様: docs/02_design/logic/dividend-sustainability-scoring.md
 * **旧実装には無い新規指標。**
 *
 * ⚠️ この指標の 0点は「債務超過」だけを意味する（設計書 §7 の決定）。
 */

/** 前期末配当総額 100 銭に対し、ネットキャッシュを直接指定して年数を作る */
const DIVIDEND_TOTAL = 100;

function scoreAtYears(years: number) {
  const netCash = Math.round(years * DIVIDEND_TOTAL);
  return calculateDividendSustainability({
    currentAssets: sen(netCash),
    investmentSecurities: sen(0),
    totalLiabilities: sen(0),
    previousDividendTotal: sen(DIVIDEND_TOTAL),
  });
}

describe('⑥ 配当維持可能年数 — ネットキャッシュの定義', () => {
  it('流動資産 + 投資有価証券 × 0.7 − 負債総額', () => {
    expect(INVESTMENT_SECURITIES_RATE).toBe(0.7);
    expect(netCashSen(1_000, 1_000, 500)).toBe(1_200);
  });

  it('0.7 を掛けた時点で丸めない（銭のまま小数で持つ）', () => {
    // 1 銭 × 0.7 = 0.7 銭。ここで整数へ丸めると 1 銭ぶん誤差が出る
    expect(netCashSen(0, 1, 0)).toBeCloseTo(0.7, 10);
  });
});

describe('⑥ 配当維持可能年数 — 6.1 境界値ちょうど', () => {
  it.each([
    { years: 30, points: 10 },
    { years: 20, points: 9 },
    { years: 10, points: 8 },
    { years: 8, points: 7 },
    { years: 6, points: 6 },
    { years: 5, points: 5 },
    { years: 4, points: 4 },
    { years: 3, points: 3 },
    { years: 2, points: 2 },
    { years: 0, points: 1 },
  ])('$years 年ちょうどは $points 点', ({ years, points }) => {
    expect(scoreAtYears(years).score).toBe(points);
  });

  it('29.99年は 9点。30年ちょうどで 10点', () => {
    expect(scoreAtYears(29.99).score).toBe(9);
    expect(scoreAtYears(30).score).toBe(10);
  });

  it('1.99年は 1点。2年ちょうどで 2点', () => {
    expect(scoreAtYears(1.99).score).toBe(1);
    expect(scoreAtYears(2).score).toBe(2);
  });

  it('0年ちょうどは 1点。0点ではない（0点は債務超過だけ）', () => {
    const result = scoreAtYears(0);
    expect(result.score).toBe(1);
    expect(result.value).toBe(0);
  });
});

describe('⑥ 配当維持可能年数 — 6.2 負の値', () => {
  it('ネットキャッシュが負（債務超過）なら 0点', () => {
    const result = calculateDividendSustainability({
      currentAssets: sen(0),
      investmentSecurities: sen(0),
      totalLiabilities: sen(1),
      previousDividendTotal: sen(DIVIDEND_TOTAL),
    });
    expect(result.score).toBe(0);
    expect(result.value).toBeLessThan(0);
    expect(result.unavailableReason).toBeNull();
  });

  it('0点と 1点の境目は債務超過かどうか。1 銭で切り替わる', () => {
    const solvent = calculateDividendSustainability({
      currentAssets: sen(0),
      investmentSecurities: sen(0),
      totalLiabilities: sen(0),
      previousDividendTotal: sen(DIVIDEND_TOTAL),
    });
    const insolvent = calculateDividendSustainability({
      currentAssets: sen(0),
      investmentSecurities: sen(0),
      totalLiabilities: sen(1),
      previousDividendTotal: sen(DIVIDEND_TOTAL),
    });
    expect(solvent.score).toBe(1);
    expect(insolvent.score).toBe(0);
  });
});

describe('⑥ 配当維持可能年数 — 6.3 無配・0', () => {
  it('前期末配当総額が 0（無配）はゼロ除算で判定不能。0点ではない', () => {
    const result = calculateDividendSustainability({
      currentAssets: sen(10_000),
      investmentSecurities: sen(0),
      totalLiabilities: sen(0),
      previousDividendTotal: sen(0),
    });
    expect(result.score).toBeNull();
    expect(result.unavailableReason).toBe('division-by-zero');
  });

  /**
   * 負債総額 0（無借金）は実在する。取り込み側（`deriveTotalLiabilities`）が
   * 0 を `null` に丸めないことの受け皿（balance-sheet-derivation.md §5.4 / §6.3）。
   */
  it('負債総額 0（無借金）ならネットキャッシュは流動資産＋有価証券0.7掛けのまま', () => {
    const result = calculateDividendSustainability({
      currentAssets: sen(10_000),
      investmentSecurities: sen(10_000),
      totalLiabilities: sen(0),
      previousDividendTotal: sen(DIVIDEND_TOTAL),
    });
    // (10000 + 10000 * 0.7) - 0 = 17000 銭 → 170年
    expect(result.value).toBe(17_000 / DIVIDEND_TOTAL);
    expect(result.score).toBe(10);
    expect(result.unavailableReason).toBeNull();
  });
});

describe('⑥ 配当維持可能年数 — 6.4 データ欠損', () => {
  it.each(['currentAssets', 'investmentSecurities', 'totalLiabilities', 'previousDividendTotal'])(
    '%s が null なら判定不能。0 を返さない',
    (field) => {
      const input = {
        currentAssets: sen(10_000),
        investmentSecurities: sen(0),
        totalLiabilities: sen(0),
        previousDividendTotal: sen(DIVIDEND_TOTAL),
      };
      const result = calculateDividendSustainability({ ...input, [field]: null });
      expect(result.score).toBeNull();
      expect(result.value).toBeNull();
      expect(result.unavailableReason).toBe('input-missing');
    },
  );
});

describe('⑥ 配当維持可能年数 — カスタム bands（T-101 指標カスタマイズ）', () => {
  const ALWAYS_SEVEN: readonly ScoreBand[] = [{ minInclusive: null, maxExclusive: null, points: 7 }];

  it('省略時はデフォルト定数で判定する（30年ちょうどは10点）', () => {
    expect(scoreAtYears(30).score).toBe(10);
  });

  it('カスタム bands を渡すと、デフォルトなら10点になる入力でも渡した bands の点数になる', () => {
    const netCash = Math.round(30 * DIVIDEND_TOTAL);
    const result = calculateDividendSustainability(
      {
        currentAssets: sen(netCash),
        investmentSecurities: sen(0),
        totalLiabilities: sen(0),
        previousDividendTotal: sen(DIVIDEND_TOTAL),
      },
      ALWAYS_SEVEN,
    );
    expect(result.score).toBe(7);
  });
});
