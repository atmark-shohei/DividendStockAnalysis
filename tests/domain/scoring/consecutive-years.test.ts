import { describe, expect, it } from 'vitest';

import {
  CONSECUTIVE_LOOKBACK_YEARS,
  calculateConsecutiveYears,
} from '@/domain/scoring/consecutive-years';
import { senOrNull } from '../../helpers/sen';

/**
 * 指標② 連続非減配年数。
 * 仕様: docs/02_design/logic/consecutive-years-scoring.md
 *
 * **「増配」ではなく「非減配」。** 横ばいを継続に含める（設計書 §7 の決定）。
 */

/**
 * 「n年連続で非減配」の履歴を作る。年度降順。
 *
 * n 年ぶんの比較が成立するには n+1 個の値が要る。n 年目の1つ前で減配させて
 * 連続を打ち切る。
 */
function streak(years: number): (number | null)[] {
  const history: number[] = [];
  for (let i = 0; i <= years; i++) history.push(1_000 - i); // 降順＝過去ほど小さい＝非減配
  history.push(10_000); // ここで減配（過去のほうが大きい）→ 連続はここで止まる
  return history;
}

const scoreOf = (history: (number | null)[]) =>
  calculateConsecutiveYears({ dividendHistory: history.map(senOrNull) });

describe('② 連続非減配年数 — 6.1 境界値ちょうど', () => {
  it.each([
    { years: 18, points: 10 },
    { years: 17, points: 10 },
    { years: 16, points: 5 },
    { years: 10, points: 5 },
    { years: 9, points: 3 },
    { years: 5, points: 3 },
    { years: 4, points: 0 },
    { years: 0, points: 0 },
  ])('$years 年は $points 点', ({ years, points }) => {
    const result = scoreOf(streak(years));
    expect(result.value).toBe(years);
    expect(result.score).toBe(points);
  });
});

describe('② 連続非減配年数 — 数え方', () => {
  it('横ばいは継続とみなす（増配でなくてよい）', () => {
    const flat = Array.from({ length: 19 }, () => 1_000);
    expect(scoreOf(flat).value).toBe(18);
  });

  it('直近が減配なら 0年。0点であって判定不能ではない', () => {
    const result = scoreOf([500, 1_000, 1_000, 1_000]);
    expect(result.value).toBe(0);
    expect(result.score).toBe(0);
    expect(result.unavailableReason).toBeNull();
  });

  it('18年より前は見ない（遡及上限）', () => {
    // 19年分すべて非減配なら 18年で頭打ち
    const long = Array.from({ length: 40 }, (_, i) => 1_000 - i);
    expect(scoreOf(long).value).toBe(CONSECUTIVE_LOOKBACK_YEARS);
  });
});

describe('② 連続非減配年数 — 6.2 負の値', () => {
  it('年数は 0 以上なので負にならない。該当なし', () => {
    expect(scoreOf(streak(0)).value).toBe(0);
  });
});

describe('② 連続非減配年数 — 6.3 無配・0', () => {
  it('配当 0 が続いても「減配していない」ので継続扱い', () => {
    const zeros = Array.from({ length: 19 }, () => 0);
    expect(scoreOf(zeros).value).toBe(18);
  });

  it('無配へ転落した年で打ち切られる', () => {
    expect(scoreOf([0, 1_000, 1_000]).value).toBe(0);
  });
});

describe('② 連続非減配年数 — 6.4 データ欠損', () => {
  it('履歴が空なら判定不能。0 を返さない', () => {
    const result = scoreOf([]);
    expect(result.score).toBeNull();
    expect(result.value).toBeNull();
    expect(result.unavailableReason).toBe('input-missing');
  });

  it('直近が null なら判定不能', () => {
    expect(scoreOf([null, 1_000, 1_000]).score).toBeNull();
  });

  it('判定範囲内に null があれば判定不能。欠損を 0 とみなして「減配」にしない', () => {
    const result = scoreOf([1_000, 900, null, 800]);
    expect(result.score).toBeNull();
    expect(result.unavailableReason).toBe('input-missing');
  });

  it('減配で打ち切られた後ろの null は結果に影響しない（§6.4「判定範囲内」）', () => {
    // 直近で減配して 0年確定。その先の欠損は判定に使わない
    const result = scoreOf([500, 1_000, null, null]);
    expect(result.value).toBe(0);
    expect(result.score).toBe(0);
  });
});
