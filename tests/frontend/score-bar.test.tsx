import { describe, expect, it } from 'vitest';

import { scoreBarPercent } from '../../frontend/components/ScoreBar';

/**
 * `<ScoreBar>`（`docs/02_design/ui/components.md` §2）の割合計算。
 * 呼び出し側にパーセント計算をさせない設計のため、コンポーネント内の純粋関数として検証する。
 */
describe('scoreBarPercent', () => {
  const cases: readonly (readonly [name: string, value: number, max: number, expected: number])[] =
    [
      ['半分なら50%', 5, 10, 50],
      ['満点なら100%', 10, 10, 100],
      ['0点なら0%', 0, 10, 0],
      ['max が 0 はゼロ除算を避けて0%（判定不能表示との整合）', 0, 0, 0],
      ['max が負でも0%', 5, -1, 0],
      ['value が max を超えても100%にクランプ', 12, 10, 100],
      ['value が負でも0%にクランプ', -1, 10, 0],
    ];

  it.each(cases)('%s', (_name, value, max, expected) => {
    expect(scoreBarPercent(value, max)).toBe(expected);
  });
});
