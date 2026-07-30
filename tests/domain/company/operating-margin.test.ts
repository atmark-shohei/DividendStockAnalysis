import { describe, expect, it } from 'vitest';

import { deriveOperatingMarginPercent } from '@/domain/company/operating-margin';

/**
 * 営業利益率の導出（営業利益 ÷ 売上高 × 100）。
 * 仕様: docs/02_design/logic/irbank-json-import.md §3.5・§8-9
 *
 * `src/infra/irbank/parse-fy-data.ts` から domain へ移した関数
 * （挙動は変えていない。従来の挙動は `tests/infra/irbank/parse-fy-data.test.ts`
 * の §3.5 で引き続き取り込み経路ごと検証している）。
 */

describe('通常の算出', () => {
  it('9433 の実データに一致する', () => {
    // 営業利益 1,099,125,000,000 / 売上高 6,071,915,000,000 * 100 = 18.10…%
    expect(deriveOperatingMarginPercent(1_099_125_000_000, 6_071_915_000_000)).toBeCloseTo(18.1, 1);
  });

  it('黒字と赤字を正しく区別する', () => {
    expect(deriveOperatingMarginPercent(2_000, 10_000)).toBe(20);
    expect(deriveOperatingMarginPercent(-2_000, 10_000)).toBe(-20);
  });
});

describe('欠損・ゼロ除算', () => {
  it('営業利益が null なら null', () => {
    expect(deriveOperatingMarginPercent(null, 10_000)).toBeNull();
  });

  it('売上高が null なら null', () => {
    expect(deriveOperatingMarginPercent(1_000, null)).toBeNull();
  });

  it('売上高が 0 ならゼロ除算を避けて null', () => {
    expect(deriveOperatingMarginPercent(1_000, 0)).toBeNull();
  });

  it('売上高が負でも null（0 以下はまとめてゼロ除算扱い）', () => {
    expect(deriveOperatingMarginPercent(1_000, -5_000)).toBeNull();
  });

  it('両方 null なら null', () => {
    expect(deriveOperatingMarginPercent(null, null)).toBeNull();
  });
});
