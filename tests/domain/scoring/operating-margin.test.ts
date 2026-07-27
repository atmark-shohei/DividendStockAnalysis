import { describe, expect, it } from 'vitest';

import { calculateOperatingMargin } from '@/domain/scoring/operating-margin';

/**
 * 指標⑧ 営業利益率の5年平均。
 * 仕様: docs/02_design/logic/operating-margin-scoring.md
 */

function flat(percent: number, years = 5): (number | null)[] {
  return Array.from({ length: years }, () => percent);
}

const scoreOf = (history: (number | null)[]) =>
  calculateOperatingMargin({ operatingMarginHistory: history }).score;

describe('⑧ 営業利益率 5年平均 — 6.1 境界値ちょうど', () => {
  it.each([
    { percent: 20, points: 10 },
    { percent: 16, points: 9 },
    { percent: 14, points: 8 },
    { percent: 12, points: 7 },
    { percent: 10, points: 6 },
    { percent: 8, points: 5 },
    { percent: 6, points: 4 },
    { percent: 4, points: 3 },
    { percent: 2, points: 2 },
    { percent: 0.001, points: 1 },
  ])('平均 $percent% は $points 点', ({ percent, points }) => {
    expect(scoreOf(flat(percent))).toBe(points);
  });

  it('19.999% は 9点（20% ちょうどでないと 10点にならない）', () => {
    expect(scoreOf(flat(19.999))).toBe(9);
  });

  it('0.0% は 0点。1点ではない', () => {
    // 区分表の最下段は [0%, 2%) → 1点。0 ちょうどを表に渡すと 1点になってしまうので、
    // 「0%以下 → 0点」を表を引く前のガードで落としている
    expect(scoreOf(flat(0))).toBe(0);
  });
});

describe('⑧ 営業利益率 5年平均 — 6.2 負の値', () => {
  it('平均が負（営業赤字）なら 0点。判定不能ではない', () => {
    const result = calculateOperatingMargin({ operatingMarginHistory: flat(-3) });
    expect(result.score).toBe(0);
    expect(result.unavailableReason).toBeNull();
  });
});

describe('⑧ 営業利益率 5年平均 — 6.3 無配・0', () => {
  it('無配の分岐は無い。0% は 0点になるだけ', () => {
    expect(scoreOf(flat(0))).toBe(0);
  });
});

describe('⑧ 営業利益率 5年平均 — 6.4 データ欠損', () => {
  it('5年に満たなければ判定不能', () => {
    expect(scoreOf(flat(20, 4))).toBeNull();
  });

  it('null を含めば判定不能。0 を返さない', () => {
    const result = calculateOperatingMargin({
      operatingMarginHistory: [20, 20, null, 20, 20],
    });
    expect(result.score).toBeNull();
    expect(result.unavailableReason).toBe('insufficient-history');
  });

  it('金融業（営業利益の項目が無い）は履歴が空になり判定不能', () => {
    // 🟡 §7 で保留中。§0.5 により総合点では 0点として合算され、
    // 金融株は自動的に 10点分不利になる
    expect(scoreOf([])).toBeNull();
  });
});
