import { describe, expect, it } from 'vitest';

import { type UserIndicatorSettings } from '@/domain/scoring/user-indicator-settings';
import { METRIC_KEYS } from '@/domain/shared/metric-key';

/**
 * 値オブジェクト `UserIndicatorSettings`（T-101）。
 *
 * 検証（5〜10件・基準値の範囲・⑨MIX係数の基準値除外）はこの型自体には無く、
 * `save-indicator-settings.ts`（usecase層）が担う（BE計画 §3）。
 * ここでは「検証済みの設定を運ぶだけの読み取りモデル」という型の形だけを確認する。
 */

describe('UserIndicatorSettings（読み取りモデル）', () => {
  it('selectedKeys は MetricKey の配列、basisValues は ⑨MIX係数を除く部分マップを持てる', () => {
    const settings: UserIndicatorSettings = {
      selectedKeys: [...METRIC_KEYS],
      basisValues: {
        dividendGrowthRate: 30,
        // ⑨MIX係数は BasisValueKey に含まれないため、キーとして書くと型エラーになる
        // （コンパイル時に保証される。ここでは省略できることだけを確認する）
      },
    };
    expect(settings.selectedKeys).toHaveLength(10);
    expect(settings.basisValues.dividendGrowthRate).toBe(30);
  });

  it('basisValues は空でもよい（未設定の指標があってよい）', () => {
    const settings: UserIndicatorSettings = {
      selectedKeys: ['dividendGrowthRate', 'consecutiveYears'],
      basisValues: {},
    };
    expect(Object.keys(settings.basisValues)).toHaveLength(0);
  });
});
