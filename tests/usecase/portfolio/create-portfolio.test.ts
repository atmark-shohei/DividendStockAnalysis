import { describe, expect, it } from 'vitest';

import { MAX_PORTFOLIOS_PER_USER, type Portfolio } from '@/domain/portfolio/portfolio';
import { type PortfolioIdGenerator } from '@/domain/portfolio/portfolio-id-generator';
import { createPortfolio } from '@/usecase/create-portfolio';
import { createFakePortfolioRepository } from './support/fake-portfolio-repository';

function fakeIdGenerator(id: string): PortfolioIdGenerator {
  return { generate: () => id };
}

/** 呼び出しごとに `ids` を順に返す。尽きたら最後の値を返し続ける（CR-2のリトライテスト用） */
function fakeIdGeneratorSequence(ids: readonly string[]): PortfolioIdGenerator {
  let index = 0;
  return {
    generate: () => {
      const id = ids[Math.min(index, ids.length - 1)];
      index += 1;
      return id as string;
    },
  };
}

function existingPortfolios(userId: number, count: number): Portfolio[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `pf_existing_${i}`,
    userId,
    name: `既存${i}`,
    createdAt: '2026-01-01T00:00:00.000Z',
  }));
}

/**
 * `createPortfolio`（POST /api/portfolios。T-103）。
 * 上限（`MAX_PORTFOLIOS_PER_USER=10`）の境界値ちょうどを検証する。
 */
describe('createPortfolio', () => {
  it('境界値: 既存9件(上限未到達) → 10件目の作成に成功する', async () => {
    const { repository, state } = createFakePortfolioRepository({
      portfolios: existingPortfolios(1, MAX_PORTFOLIOS_PER_USER - 1),
    });

    const result = await createPortfolio(
      { repository, idGenerator: fakeIdGenerator('pf_new') },
      1,
      '新規ポートフォリオ',
      () => new Date('2026-08-23T00:00:00.000Z'),
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({
        id: 'pf_new',
        userId: 1,
        name: '新規ポートフォリオ',
        createdAt: '2026-08-23T00:00:00.000Z',
      });
    }
    expect(state.portfolios).toHaveLength(MAX_PORTFOLIOS_PER_USER);
  });

  it('境界値: 既存10件(上限到達) → 作成は拒否される（portfolio-limit-reached）', async () => {
    const { repository, state } = createFakePortfolioRepository({
      portfolios: existingPortfolios(1, MAX_PORTFOLIOS_PER_USER),
    });

    const result = await createPortfolio(
      { repository, idGenerator: fakeIdGenerator('pf_new') },
      1,
      '新規ポートフォリオ',
      () => new Date('2026-08-23T00:00:00.000Z'),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('portfolio-limit-reached');
    // 拒否されたので insert は呼ばれていない
    expect(state.portfolios).toHaveLength(MAX_PORTFOLIOS_PER_USER);
  });

  it('他ユーザーの件数は上限判定に影響しない', async () => {
    const { repository } = createFakePortfolioRepository({
      portfolios: existingPortfolios(2, MAX_PORTFOLIOS_PER_USER),
    });

    const result = await createPortfolio(
      { repository, idGenerator: fakeIdGenerator('pf_new') },
      1,
      '新規ポートフォリオ',
      () => new Date('2026-08-23T00:00:00.000Z'),
    );

    expect(result.ok).toBe(true);
  });

  it('idGenerator.generate() の戻り値とnow()の時刻がそのまま反映される', async () => {
    const { repository } = createFakePortfolioRepository();

    const result = await createPortfolio(
      { repository, idGenerator: fakeIdGenerator('pf_custom_id') },
      42,
      'カスタム名',
      () => new Date('2026-08-23T12:34:56.000Z'),
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.id).toBe('pf_custom_id');
      expect(result.value.createdAt).toBe('2026-08-23T12:34:56.000Z');
      expect(result.value.userId).toBe(42);
    }
  });

  it('IDが1回衝突しても再試行して成功する', async () => {
    const { repository, state } = createFakePortfolioRepository({
      portfolios: [{ id: 'pf_dup', userId: 1, name: '既存', createdAt: '2026-01-01T00:00:00.000Z' }],
    });

    const result = await createPortfolio(
      { repository, idGenerator: fakeIdGeneratorSequence(['pf_dup', 'pf_new']) },
      1,
      '新規ポートフォリオ',
      () => new Date('2026-08-23T00:00:00.000Z'),
    );

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.id).toBe('pf_new');
    expect(state.portfolios.map((p) => p.id)).toEqual(['pf_dup', 'pf_new']);
  });

  it('最大試行回数まで衝突し続けると id-generation-failed になる', async () => {
    const { repository, state } = createFakePortfolioRepository({
      portfolios: [{ id: 'pf_dup', userId: 1, name: '既存', createdAt: '2026-01-01T00:00:00.000Z' }],
    });

    const result = await createPortfolio(
      { repository, idGenerator: fakeIdGeneratorSequence(['pf_dup', 'pf_dup', 'pf_dup']) },
      1,
      '新規ポートフォリオ',
      () => new Date('2026-08-23T00:00:00.000Z'),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('id-generation-failed');
    // 実質的な insert は成功していない（既存の1件のまま）
    expect(state.portfolios).toHaveLength(1);
  });
});
