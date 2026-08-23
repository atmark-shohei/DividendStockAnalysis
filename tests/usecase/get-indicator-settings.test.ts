import { describe, expect, it } from 'vitest';

import { type UserIndicatorSettings } from '@/domain/scoring/user-indicator-settings';
import { type UserIndicatorSettingsRepository } from '@/domain/scoring/user-indicator-settings-repository';
import { METRIC_KEYS } from '@/domain/shared/metric-key';
import { getIndicatorSettings } from '@/usecase/get-indicator-settings';

/**
 * `getIndicatorSettings`（GET /api/indicator-settings。T-101）。
 *
 * 仕様: `docs/02_design/api/portfolio-api.md` §指標カスタマイズ
 * 「未設定（初回アクセス）なら全10指標選択・デフォルト基準値相当を返す」（404にしない）。
 */

function unimplemented(name: string): never {
  throw new Error(`このテストで ${name} が呼ばれるのは想定外`);
}

function fakeRepository(settings: UserIndicatorSettings | null): UserIndicatorSettingsRepository {
  return {
    findByUserId: () => Promise.resolve(settings),
    replaceAll: (): Promise<void> => unimplemented('UserIndicatorSettingsRepository.replaceAll'),
  };
}

describe('getIndicatorSettings', () => {
  it('未設定（行が0件）なら全10指標選択・デフォルト基準値相当を返す（404にしない）', async () => {
    const result = await getIndicatorSettings(fakeRepository(null), 1);

    expect(result.selectedKeys).toEqual(METRIC_KEYS);
    // デフォルト満点境界（bands.ts。①は30%）
    expect(result.basisValues.dividendGrowthRate).toBe(30);
    // ⑩配当利回りは `%` 小数（DBと同じ単位系。BE計画 §4）
    expect(result.basisValues.dividendYield).toBe(5.5);
    // ⑨MIX係数は含まれない（設定不可）
    expect((result.basisValues as Record<string, number | undefined>)['mixCoefficient']).toBeUndefined();
  });

  it('保存済みの設定があればそのまま返す（再計算しない）', async () => {
    const saved: UserIndicatorSettings = {
      selectedKeys: ['dividendGrowthRate', 'consecutiveYears', 'roeAverage', 'operatingMargin', 'dividendYield'],
      basisValues: { dividendGrowthRate: 20 },
    };
    const result = await getIndicatorSettings(fakeRepository(saved), 1);

    expect(result).toEqual(saved);
  });
});
