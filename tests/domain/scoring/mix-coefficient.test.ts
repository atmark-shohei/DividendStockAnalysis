import { describe, expect, it } from 'vitest';

import { calculateMixCoefficient } from '@/domain/scoring/mix-coefficient';

/**
 * 指標⑨ MIX係数（PER × PBR）。
 * 仕様: docs/02_design/logic/mix-coefficient-scoring.md
 * **旧実装には無い新規指標。** 前例が無いので設計書だけが根拠。
 */

/** PBR を 1.0 に固定して PER で MIX係数を作る。境界を狙いやすい */
const scoreAtMix = (mix: number) => calculateMixCoefficient({ per: mix, pbr: 1 }).score;

describe('⑨ MIX係数 — 6.1 境界値ちょうど', () => {
  it.each([
    { mix: 0, points: 10 },
    { mix: 10, points: 9 },
    { mix: 12, points: 8 },
    { mix: 15, points: 7 },
    { mix: 18, points: 6 },
    { mix: 22.5, points: 5 },
    { mix: 25, points: 4 },
    { mix: 27, points: 3 },
    { mix: 30, points: 2 },
    { mix: 33, points: 1 },
    { mix: 40, points: 0 },
  ])('MIX $mix 倍ちょうどは $points 点', ({ mix, points }) => {
    expect(scoreAtMix(mix)).toBe(points);
  });

  it('10.0倍は 9点。9.999倍は 10点（低いほど高得点）', () => {
    expect(scoreAtMix(10)).toBe(9);
    expect(scoreAtMix(9.999)).toBe(10);
  });

  it('40.0倍は 0点。39.999倍は 1点', () => {
    expect(scoreAtMix(40)).toBe(0);
    expect(scoreAtMix(39.999)).toBe(1);
  });

  it('PER と PBR の積で判定する', () => {
    // 12.5 × 1.8 = 22.5 → 5点
    expect(calculateMixCoefficient({ per: 12.5, pbr: 1.8 }).score).toBe(5);
  });
});

describe('⑨ MIX係数 — 6.2 負の値', () => {
  it('PER が負（赤字）なら 0点。§0.3。原典のままだと満点を取った', () => {
    const result = calculateMixCoefficient({ per: -10, pbr: 1 });
    expect(result.score).toBe(0);
    expect(result.unavailableReason).toBeNull();
  });

  it('PBR が負（債務超過）なら 0点', () => {
    expect(calculateMixCoefficient({ per: 10, pbr: -1 }).score).toBe(0);
  });

  it('負×負で積が正に戻っても 0点。ここが ③ と同じ構造の欠陥だった', () => {
    // -5 × -1 = 5 → 表では「0倍〜10倍 → 10点」に該当してしまう
    const result = calculateMixCoefficient({ per: -5, pbr: -1 });
    expect(result.value).toBe(5);
    expect(result.score).toBe(0);
  });
});

describe('⑨ MIX係数 — 6.3 無配・0', () => {
  it('MIX係数 0（PER か PBR が 0）は最上位区分で 10点', () => {
    expect(calculateMixCoefficient({ per: 0, pbr: 1.5 }).score).toBe(10);
    expect(calculateMixCoefficient({ per: 15, pbr: 0 }).score).toBe(10);
  });
});

describe('⑨ MIX係数 — 6.4 データ欠損', () => {
  it.each([
    { label: 'PER が null', per: null, pbr: 1 },
    { label: 'PBR が null', per: 10, pbr: null },
    { label: '両方 null', per: null, pbr: null },
  ])('$label なら判定不能。0 を返さない', ({ per, pbr }) => {
    const result = calculateMixCoefficient({ per, pbr });
    expect(result.score).toBeNull();
    expect(result.value).toBeNull();
    expect(result.unavailableReason).toBe('input-missing');
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY])('%s は判定不能。最高点に落ちない', (value) => {
    const result = calculateMixCoefficient({ per: value, pbr: 1 });
    expect(result.score).toBeNull();
    expect(result.unavailableReason).toBe('input-invalid');
  });
});
