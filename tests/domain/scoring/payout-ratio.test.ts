import { describe, expect, it } from 'vitest';

import { calculatePayoutRatio } from '@/domain/scoring/payout-ratio';
import { sen } from '../../helpers/sen';

/**
 * 指標③ 予想配当性向。
 * 仕様: docs/02_design/logic/payout-ratio-scoring.md
 *
 * この指標だけ 10段（1点を返す経路が無い）。原典の欠陥（赤字企業が満点）を
 * §0.3 / §0.4 で塞いである。
 */

/** EPS 10,000 銭（100円）に対する配当から性向を作る。1% = 100 銭 */
const EPS_SEN = 10_000;
const scoreAt = (dividendSen: number, epsSen = EPS_SEN) =>
  calculatePayoutRatio({ forecastDividend: sen(dividendSen), forecastEps: sen(epsSen) }).score;

describe('③ 予想配当性向 — 6.1 境界値ちょうど', () => {
  it.each([
    { percent: 0.01, points: 10 },
    { percent: 25, points: 9 },
    { percent: 30, points: 8 },
    { percent: 35, points: 7 },
    { percent: 40, points: 6 },
    { percent: 45, points: 5 },
    { percent: 50, points: 4 },
    { percent: 55, points: 3 },
    { percent: 60, points: 2 },
    { percent: 70, points: 0 },
  ])('配当性向 $percent% ちょうどは $points 点', ({ percent, points }) => {
    expect(scoreAt(Math.round((EPS_SEN * percent) / 100))).toBe(points);
  });

  it('25% ちょうどは 9点。24.99% は 10点', () => {
    expect(scoreAt(2_500)).toBe(9);
    expect(scoreAt(2_499)).toBe(10);
  });

  it('69.99% は 2点。この指標に 1点の行は無い（意図的 / 設計書 §7）', () => {
    expect(scoreAt(6_999)).toBe(2);
    expect(scoreAt(7_000)).toBe(0);
  });

  it('どの入力でも 1点は返らない', () => {
    for (let dividendSen = 0; dividendSen <= 12_000; dividendSen += 7) {
      expect(scoreAt(dividendSen)).not.toBe(1);
    }
  });
});

describe('③ 予想配当性向 — 6.2 負の値', () => {
  it('EPS が負（赤字）なら 0点。原典のままだと満点を取った（§0.3）', () => {
    const result = calculatePayoutRatio({
      forecastDividend: sen(2_000),
      forecastEps: sen(-10_000),
    });
    expect(result.score).toBe(0);
    expect(result.unavailableReason).toBeNull();
  });

  it('赤字でも判定不能にはしない。0点であることに意味がある', () => {
    const result = calculatePayoutRatio({
      forecastDividend: sen(2_000),
      forecastEps: sen(-1),
    });
    expect(result.score).toBe(0);
  });

  it('配当が負は制度上ありえないのでデータ不良として判定不能', () => {
    const result = calculatePayoutRatio({
      forecastDividend: sen(-100),
      forecastEps: sen(EPS_SEN),
    });
    expect(result.score).toBeNull();
    expect(result.unavailableReason).toBe('input-invalid');
  });
});

describe('③ 予想配当性向 — 6.3 無配・0', () => {
  it('無配（配当 0）は 0点（§0.4）。性向 0% は数値上は最上位区分だが採らない', () => {
    const result = calculatePayoutRatio({ forecastDividend: sen(0), forecastEps: sen(EPS_SEN) });
    expect(result.score).toBe(0);
    expect(result.value).toBe(0);
    expect(result.unavailableReason).toBeNull();
  });

  it('配当が正で性向がほぼ 0% なら 10点。無配とは区別する', () => {
    // EPS が極端に大きい会社。性向 0.00001% でも「無配」ではない
    const result = calculatePayoutRatio({
      forecastDividend: sen(1),
      forecastEps: sen(1_000_000_000),
    });
    expect(result.score).toBe(10);
  });

  it('EPS が 0 はゼロ除算で判定不能。0点ではない', () => {
    const result = calculatePayoutRatio({ forecastDividend: sen(2_000), forecastEps: sen(0) });
    expect(result.score).toBeNull();
    expect(result.unavailableReason).toBe('division-by-zero');
  });
});

describe('③ 予想配当性向 — 6.4 データ欠損', () => {
  it.each([
    { label: '配当が null', dividend: null, eps: EPS_SEN },
    { label: 'EPS が null', dividend: 2_000, eps: null },
  ])('$label なら判定不能。0 を返さない', ({ dividend, eps }) => {
    const result = calculatePayoutRatio({
      forecastDividend: dividend === null ? null : sen(dividend),
      forecastEps: eps === null ? null : sen(eps),
    });
    expect(result.score).toBeNull();
    expect(result.value).toBeNull();
    expect(result.unavailableReason).toBe('input-missing');
  });
});
