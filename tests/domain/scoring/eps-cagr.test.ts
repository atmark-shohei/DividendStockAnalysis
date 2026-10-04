import { describe, expect, it } from 'vitest';

import { calculateEpsCagr } from '@/domain/scoring/eps-cagr';
import { type ScoreBand } from '@/domain/scoring/score-band';
import { CAGR_BASE_SEN, atLeastGrowth, justUnderGrowth } from '../../helpers/cagr';
import { sen, senOrNull } from '../../helpers/sen';

/**
 * 指標④ EPS の5年 CAGR（中央値ベース）。
 * 仕様: docs/02_design/logic/eps-cagr-scoring.md
 *
 * 履歴は年度降順。直近3年（添字0〜2）の中央値と、5年前から遡る3年（添字3〜5）の
 * 中央値で成長率を出す。旧実装は端点同士で比較していた（§8）。
 *
 * `historyRestated` は EDINET 取り込み専用の追加入力（`edinet-history-import.md` §4.3）。
 * 既存ケースはすべて `historyRestated: false`（EDINET未実施）を明示する。
 */

/** 直近3年と基準3年をそれぞれ一定値にした6年分の履歴 */
function history(recent: number, base: number): (number | null)[] {
  return [recent, recent, recent, base, base, base];
}

const scoreAt = (recent: number, base = CAGR_BASE_SEN) =>
  calculateEpsCagr({
    epsHistory: history(recent, base).map(senOrNull),
    historyRestated: false,
  }).score;

describe('④ EPS CAGR — 6.1 境界値ちょうど', () => {
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
  ])('成長率 $percent% ちょうどは $points 点', ({ percent, points }) => {
    const result = calculateEpsCagr({
      epsHistory: history(atLeastGrowth(percent), CAGR_BASE_SEN).map(senOrNull),
      historyRestated: false,
    });
    expect(result.value).toBeGreaterThanOrEqual(percent);
    expect(result.score).toBe(points);
  });

  it.each([
    { percent: 20, points: 9 },
    { percent: 16, points: 8 },
  ])('$percent% を下回ると $points 点', ({ percent, points }) => {
    expect(scoreAt(justUnderGrowth(percent))).toBe(points);
  });

  it('0.0% は 0点。1点ではない', () => {
    expect(scoreAt(CAGR_BASE_SEN)).toBe(0);
  });

  it('1 銭でも増えていれば 1点', () => {
    expect(scoreAt(CAGR_BASE_SEN + 1)).toBe(1);
  });
});

describe('④ EPS CAGR — 中央値で異常値をならす', () => {
  it('直近3年に特別損益の年があっても中央値が効く', () => {
    // 直近3年 [999e9, 1.2e9, 1.2e9] の中央値は 1.2e9。単年比較なら跳ね上がる
    const spike = 999 * CAGR_BASE_SEN;
    const recentNormal = atLeastGrowth(20);
    const withSpike = calculateEpsCagr({
      epsHistory: [
        spike,
        recentNormal,
        recentNormal,
        CAGR_BASE_SEN,
        CAGR_BASE_SEN,
        CAGR_BASE_SEN,
      ].map(senOrNull),
      historyRestated: false,
    });
    const withoutSpike = calculateEpsCagr({
      epsHistory: history(recentNormal, CAGR_BASE_SEN).map(senOrNull),
      historyRestated: false,
    });
    expect(withSpike.score).toBe(withoutSpike.score);
  });

  it('7年目以降は見ない（必要なのは6年分）', () => {
    const base = history(atLeastGrowth(20), CAGR_BASE_SEN).map(senOrNull);
    expect(
      calculateEpsCagr({ epsHistory: [...base, null, null], historyRestated: false }).score,
    ).toBe(10);
  });
});

describe('④ EPS CAGR — 6.2 負の値', () => {
  it('成長率が負なら 0点', () => {
    const result = calculateEpsCagr({
      epsHistory: history(CAGR_BASE_SEN / 2, CAGR_BASE_SEN).map(senOrNull),
      historyRestated: false,
    });
    expect(result.score).toBe(0);
    expect(result.unavailableReason).toBeNull();
  });

  it('基準年側の中央値が負なら判定不能。0点ではない（§6.2 で混同を禁じている）', () => {
    const result = calculateEpsCagr({
      epsHistory: history(CAGR_BASE_SEN, -CAGR_BASE_SEN).map(senOrNull),
      historyRestated: false,
    });
    expect(result.score).toBeNull();
    expect(result.unavailableReason).toBe('undefined-growth');
  });

  it('直近側の中央値が負（赤字転落）は 0点。表示値は下限の -100%', () => {
    const result = calculateEpsCagr({
      epsHistory: history(-CAGR_BASE_SEN, CAGR_BASE_SEN).map(senOrNull),
      historyRestated: false,
    });
    expect(result.score).toBe(0);
    expect(result.value).toBe(-100);
  });
});

describe('④ EPS CAGR — 6.3 無配・0', () => {
  it('基準年側の中央値が 0 ならゼロ除算で判定不能', () => {
    const result = calculateEpsCagr({
      epsHistory: history(CAGR_BASE_SEN, 0).map(senOrNull),
      historyRestated: false,
    });
    expect(result.score).toBeNull();
    expect(result.unavailableReason).toBe('division-by-zero');
  });

  it('直近側の中央値が 0 は -100% で 0点', () => {
    const result = calculateEpsCagr({
      epsHistory: history(0, CAGR_BASE_SEN).map(senOrNull),
      historyRestated: false,
    });
    expect(result.score).toBe(0);
    expect(result.value).toBe(-100);
  });

  it('EPS 0 の年があっても中央値には算入する', () => {
    // 直近3年 [0, X, X] の中央値は X。0 を除外しない
    const recent = atLeastGrowth(20);
    const result = calculateEpsCagr({
      epsHistory: [0, recent, recent, CAGR_BASE_SEN, CAGR_BASE_SEN, CAGR_BASE_SEN].map(senOrNull),
      historyRestated: false,
    });
    expect(result.score).toBe(10);
  });
});

describe('④ EPS CAGR — 6.4 データ欠損', () => {
  it('6年に満たなければ判定不能。0 を返さない', () => {
    const result = calculateEpsCagr({
      epsHistory: [sen(1), sen(1), sen(1), sen(1), sen(1)],
      historyRestated: false,
    });
    expect(result.score).toBeNull();
    expect(result.value).toBeNull();
    expect(result.unavailableReason).toBe('insufficient-history');
  });

  it.each([0, 1, 2, 3, 4, 5])('添字 %i に null があれば判定不能', (index) => {
    const values = history(atLeastGrowth(20), CAGR_BASE_SEN);
    values[index] = null;
    expect(
      calculateEpsCagr({ epsHistory: values.map(senOrNull), historyRestated: false }).score,
    ).toBeNull();
  });
});

/**
 * EDINET取り込みの遡及修正検出（`docs/02_design/logic/edinet-history-import.md` §4.3・§7.2）。
 */
describe('④ EPS CAGR — EDINET遡及修正（historyRestated）', () => {
  it('historyRestated: true なら判定不能（restated-history）。0点ではない', () => {
    const result = calculateEpsCagr({
      epsHistory: history(atLeastGrowth(20), CAGR_BASE_SEN).map(senOrNull),
      historyRestated: true,
    });
    expect(result.score).toBeNull();
    expect(result.value).toBeNull();
    expect(result.unavailableReason).toBe('restated-history');
  });

  it('6期そろわない場合は insufficient-history が restated-history より先に返る', () => {
    const result = calculateEpsCagr({
      epsHistory: [sen(1), sen(1), sen(1), sen(1), sen(1)],
      historyRestated: true,
    });
    expect(result.unavailableReason).toBe('insufficient-history');
  });

  it('historyRestated: false なら通常どおり採点する（回帰確認）', () => {
    const result = calculateEpsCagr({
      epsHistory: history(atLeastGrowth(20), CAGR_BASE_SEN).map(senOrNull),
      historyRestated: false,
    });
    expect(result.score).toBe(10);
    expect(result.unavailableReason).toBeNull();
  });
});

describe('④ EPS CAGR — カスタム bands（T-101 指標カスタマイズ）', () => {
  const ALWAYS_SEVEN: readonly ScoreBand[] = [{ minInclusive: null, maxExclusive: null, points: 7 }];

  it('省略時はデフォルト定数で判定する（20%ちょうどは10点）', () => {
    expect(scoreAt(atLeastGrowth(20))).toBe(10);
  });

  it('カスタム bands を渡すと、デフォルトなら10点になる入力でも渡した bands の点数になる', () => {
    const result = calculateEpsCagr(
      { epsHistory: history(atLeastGrowth(20), CAGR_BASE_SEN).map(senOrNull), historyRestated: false },
      ALWAYS_SEVEN,
    );
    expect(result.score).toBe(7);
  });
});
