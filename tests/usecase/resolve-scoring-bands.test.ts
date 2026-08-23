import { describe, expect, it } from 'vitest';

import { type ScoreBand } from '@/domain/scoring/score-band';
import {
  type UserIndicatorSettings,
} from '@/domain/scoring/user-indicator-settings';
import { type UserIndicatorSettingsRepository } from '@/domain/scoring/user-indicator-settings-repository';
import { METRIC_KEYS } from '@/domain/shared/metric-key';
import { BANDS_BY_METRIC } from '@/usecase/get-scoring-bands';
import { resolveScoringBands } from '@/usecase/resolve-scoring-bands';

/**
 * `resolveScoringBands`（T-101）。
 *
 * 「ユーザーの選択・基準値 → 有効な区分表」という変換を1箇所に集約したユースケース。
 * `scaleBands`/`deriveDefaultBaseline` そのものの計算は
 * `tests/domain/scoring/band-scaling.test.ts` で尽くしてある。ここで見たいのは
 * ゲスト/未設定/カスタム設定の3系統の振り分けと、⑩の単位変換だけ。
 */

function unimplemented(name: string): never {
  throw new Error(`このテストで ${name} が呼ばれるのは想定外`);
}

function fakeRepository(settingsByUserId: Readonly<Record<number, UserIndicatorSettings>>) {
  const calls: number[] = [];
  const repository: UserIndicatorSettingsRepository = {
    findByUserId: (userId: number) => {
      calls.push(userId);
      return Promise.resolve(settingsByUserId[userId] ?? null);
    },
    replaceAll: (): Promise<void> => unimplemented('UserIndicatorSettingsRepository.replaceAll'),
  };
  return { repository, calls };
}

describe('resolveScoringBands', () => {
  it('userId が null（ゲスト）はリポジトリへ問い合わせず、全10指標・デフォルト区分表を返す', async () => {
    const { repository, calls } = fakeRepository({});
    const result = await resolveScoringBands({ userIndicatorSettingsRepository: repository }, null);

    expect(calls).toHaveLength(0);
    expect(result.selectedKeys).toEqual(METRIC_KEYS);
    expect(result.bandsByMetric.dividendGrowthRate).toEqual(BANDS_BY_METRIC.dividendGrowthRate);
  });

  it('保存済みの行が0件（未設定ユーザー）は、ゲストと同じ既定応答になる', async () => {
    const { repository } = fakeRepository({});
    const result = await resolveScoringBands({ userIndicatorSettingsRepository: repository }, 1);

    expect(result.selectedKeys).toEqual(METRIC_KEYS);
    expect(result.bandsByMetric.roeAverage).toEqual(BANDS_BY_METRIC.roeAverage);
  });

  it('カスタム設定ユーザーは選択キー・スケーリング後の区分表を返す', async () => {
    const { repository } = fakeRepository({
      1: {
        selectedKeys: ['dividendGrowthRate', 'consecutiveYears', 'roeAverage', 'operatingMargin', 'dividendYield'],
        basisValues: { dividendGrowthRate: 15 }, // デフォルト満点境界30の半分 → 区分がすべて半分にスケールする
      },
    });
    const result = await resolveScoringBands({ userIndicatorSettingsRepository: repository }, 1);

    expect(result.selectedKeys).toEqual([
      'dividendGrowthRate',
      'consecutiveYears',
      'roeAverage',
      'operatingMargin',
      'dividendYield',
    ]);
    const scaled = result.bandsByMetric.dividendGrowthRate;
    const topBand = scaled.find((band: ScoreBand) => band.points === 10);
    expect(topBand?.minInclusive).toBe(15);
    // 基準値を指定していない指標はデフォルトのまま
    expect(result.bandsByMetric.roeAverage).toEqual(BANDS_BY_METRIC.roeAverage);
  });

  it('⑩配当利回りの基準値は `%` 小数で受け取り、1/100%整数へ変換してからスケーリングする', async () => {
    const { repository } = fakeRepository({
      1: {
        selectedKeys: [...METRIC_KEYS],
        basisValues: { dividendYield: 4 }, // 4% → 400（1/100%整数）。デフォルト満点境界550の 400/550 倍
      },
    });
    const result = await resolveScoringBands({ userIndicatorSettingsRepository: repository }, 1);

    const scaled = result.bandsByMetric.dividendYield;
    const topBand = scaled.find((band: ScoreBand) => band.points === 10);
    expect(topBand?.minInclusive).toBe(400);
  });

  it('⑨MIX係数はユーザーが基準値を持っていても常にデフォルト定数（設定不可。ADR-0012 D-2）', async () => {
    const { repository } = fakeRepository({
      1: { selectedKeys: [...METRIC_KEYS], basisValues: {} },
    });
    const result = await resolveScoringBands({ userIndicatorSettingsRepository: repository }, 1);

    expect(result.bandsByMetric.mixCoefficient).toEqual(BANDS_BY_METRIC.mixCoefficient);
  });
});
