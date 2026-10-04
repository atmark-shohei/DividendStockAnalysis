import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

import { type Company } from '@/domain/company/company';
import { type StoredMetric, type StoredScoring } from '@/domain/company/company-repository';
import { type NewUser } from '@/domain/auth/user';
import { type Portfolio } from '@/domain/portfolio/portfolio';
import { type PortfolioHoldingRecord } from '@/domain/portfolio/portfolio-holding';
import { D1CompanyRepository } from '@/infra/d1/company-repository';
import { D1PortfolioRepository } from '@/infra/d1/portfolio-repository';
import { D1UserRepository } from '@/infra/d1/user-repository';

/**
 * `D1PortfolioRepository` の全メソッドを実D1で検証する（T-103）。
 * 仕様: `docs/02_design/database/schema.md` §portfolios/portfolio_holdings。
 *
 * `company-list-search.test.ts` と同じ「実D1セットアップ」に倣い、`D1CompanyRepository.save()`
 * で狙った `score_cards`/`transformed_metrics` の値を仕込む。
 */

beforeEach(async () => {
  await env.DB.exec('DELETE FROM portfolio_holdings');
  await env.DB.exec('DELETE FROM portfolios');
  await env.DB.exec('DELETE FROM transformed_metrics');
  await env.DB.exec('DELETE FROM score_cards');
  await env.DB.exec('DELETE FROM companies');
  await env.DB.exec('DELETE FROM sessions');
  await env.DB.exec('DELETE FROM users');
});

function newUser(overrides: Partial<NewUser> = {}): NewUser {
  return {
    email: 'user@example.com',
    passwordHash: 'hash-value',
    passwordSalt: 'salt-value',
    passwordIterations: 10_000,
    role: 'user',
    createdAt: '2026-08-23T00:00:00.000Z',
    ...overrides,
  };
}

async function insertUser(overrides: Partial<NewUser> = {}) {
  const userRepository = new D1UserRepository(env.DB);
  const inserted = await userRepository.insert(newUser(overrides));
  if (!inserted.ok) throw new Error('setup failed: user insert');
  return inserted.value;
}

function baseCompany(overrides: Partial<Company>): Company {
  return {
    code: '0000',
    name: 'ダミー',
    records: [],
    dividends: [],
    balanceSheet: {
      currentAssetsSen: null,
      investmentSecuritiesSen: null,
      totalLiabilitiesSen: null,
      previousDividendTotalSen: null,
    },
    multiples: { per: null, perSource: null, pbr: null, pbrSource: null },
    priceSen: null,
    fetchedAt: '2026-01-01T00:00:00.000Z',
    epsHistoryRestated: false,
    revenueHistoryRestated: false,
    ...overrides,
  };
}

function metric(metricKey: string, value: number | null, score: number | null = 5): StoredMetric {
  return { metricKey, score, value, unavailableReason: value === null ? 'input-missing' : null };
}

function scoring(totalScore: number, metrics: readonly StoredMetric[]): StoredScoring {
  return {
    totalScore,
    effectiveMetricCount: metrics.filter((m) => m.value !== null).length,
    metrics,
    calcVersion: 'test-v1',
    calculatedAt: '2026-08-23T00:00:00.000Z',
  };
}

/** 7203 トヨタ自動車: priceSen あり、⑩配当利回りあり、score_cards あり */
async function seedToyota() {
  const companyRepository = new D1CompanyRepository(env.DB);
  await companyRepository.save(
    baseCompany({ code: '7203', name: 'トヨタ自動車', priceSen: 314_200 }),
    scoring(62, [metric('dividendYield', 318)]),
  );
}

function samplePortfolio(overrides: Partial<Portfolio> = {}): Portfolio {
  return { id: 'pf_1', userId: 1, name: 'メインNISA', createdAt: '2026-08-23T00:00:00.000Z', ...overrides };
}

function sampleHolding(overrides: Partial<PortfolioHoldingRecord> = {}): PortfolioHoldingRecord {
  return {
    portfolioId: 'pf_1',
    companyCode: '7203',
    quantity: 100,
    acquisitionPriceSen: 280_000,
    createdAt: '2026-08-23T00:00:00.000Z',
    updatedAt: '2026-08-23T00:00:00.000Z',
    ...overrides,
  };
}

describe('countByUserId / insert / findById', () => {
  it('insert したポートフォリオが findById で読み戻せる', async () => {
    const user = await insertUser();
    const repository = new D1PortfolioRepository(env.DB);
    const portfolio = samplePortfolio({ userId: user.id });

    await repository.insert(portfolio);

    expect(await repository.findById(portfolio.id)).toEqual(portfolio);
    expect(await repository.countByUserId(user.id)).toBe(1);
  });

  it('存在しないIDはnull', async () => {
    const repository = new D1PortfolioRepository(env.DB);
    expect(await repository.findById('pf_does_not_exist')).toBeNull();
  });

  it('ユーザーごとに独立してカウントされる', async () => {
    const userA = await insertUser({ email: 'a@example.com' });
    const userB = await insertUser({ email: 'b@example.com' });
    const repository = new D1PortfolioRepository(env.DB);

    await repository.insert(samplePortfolio({ id: 'pf_a', userId: userA.id }));
    await repository.insert(samplePortfolio({ id: 'pf_b1', userId: userB.id }));
    await repository.insert(samplePortfolio({ id: 'pf_b2', userId: userB.id }));

    expect(await repository.countByUserId(userA.id)).toBe(1);
    expect(await repository.countByUserId(userB.id)).toBe(2);
  });

  it('同じIDで2回insertすると2回目は id-conflict を返す（例外を投げない）', async () => {
    const user = await insertUser();
    const repository = new D1PortfolioRepository(env.DB);
    const portfolio = samplePortfolio({ userId: user.id });

    const first = await repository.insert(portfolio);
    expect(first.ok).toBe(true);

    const second = await repository.insert(portfolio);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error.kind).toBe('id-conflict');
  });
});

describe('listSummariesByUserId（1クエリJOIN + GROUP BY + COUNT）', () => {
  it('保有0件のポートフォリオはholdingCount=0', async () => {
    const user = await insertUser();
    const repository = new D1PortfolioRepository(env.DB);
    await repository.insert(samplePortfolio({ userId: user.id }));

    const summaries = await repository.listSummariesByUserId(user.id);
    expect(summaries).toEqual([{ id: 'pf_1', name: 'メインNISA', holdingCount: 0 }]);
  });

  it('保有銘柄数が正しく集計される', async () => {
    await seedToyota();
    const user = await insertUser();
    const repository = new D1PortfolioRepository(env.DB);
    await repository.insert(samplePortfolio({ userId: user.id }));
    await repository.insertHolding(sampleHolding({ companyCode: '7203' }));

    const summaries = await repository.listSummariesByUserId(user.id);
    expect(summaries[0]?.holdingCount).toBe(1);
  });

  it('作成日時昇順（作成順）で並ぶ', async () => {
    const user = await insertUser();
    const repository = new D1PortfolioRepository(env.DB);
    await repository.insert(samplePortfolio({ id: 'pf_2nd', userId: user.id, createdAt: '2026-08-23T01:00:00.000Z' }));
    await repository.insert(samplePortfolio({ id: 'pf_1st', userId: user.id, createdAt: '2026-08-23T00:00:00.000Z' }));

    const summaries = await repository.listSummariesByUserId(user.id);
    expect(summaries.map((s) => s.id)).toEqual(['pf_1st', 'pf_2nd']);
  });

  it('他ユーザーのポートフォリオは含まない', async () => {
    const userA = await insertUser({ email: 'a@example.com' });
    const userB = await insertUser({ email: 'b@example.com' });
    const repository = new D1PortfolioRepository(env.DB);
    await repository.insert(samplePortfolio({ id: 'pf_a', userId: userA.id }));
    await repository.insert(samplePortfolio({ id: 'pf_b', userId: userB.id }));

    const summaries = await repository.listSummariesByUserId(userA.id);
    expect(summaries.map((s) => s.id)).toEqual(['pf_a']);
  });
});

describe('deleteById（holdings→portfoliosの順にカスケード削除）', () => {
  it('ポートフォリオと保有銘柄が両方消える', async () => {
    await seedToyota();
    const user = await insertUser();
    const repository = new D1PortfolioRepository(env.DB);
    await repository.insert(samplePortfolio({ userId: user.id }));
    await repository.insertHolding(sampleHolding());

    await repository.deleteById('pf_1');

    expect(await repository.findById('pf_1')).toBeNull();
    const remaining = await env.DB.prepare(
      'SELECT COUNT(*) AS count FROM portfolio_holdings WHERE portfolio_id = ?',
    )
      .bind('pf_1')
      .first<{ count: number }>();
    expect(remaining?.count).toBe(0);
  });
});

describe('getDetail（portfolio行1件＋保有銘柄のJOIN行）', () => {
  it('存在しないIDはnull', async () => {
    const repository = new D1PortfolioRepository(env.DB);
    expect(await repository.getDetail('pf_does_not_exist')).toBeNull();
  });

  it('保有銘柄の現在株価・配当利回り・スコアをJOINで取得する', async () => {
    await seedToyota();
    const user = await insertUser();
    const repository = new D1PortfolioRepository(env.DB);
    await repository.insert(samplePortfolio({ userId: user.id }));
    await repository.insertHolding(sampleHolding());

    const detail = await repository.getDetail('pf_1');
    expect(detail?.portfolio.id).toBe('pf_1');
    expect(detail?.holdings).toEqual([
      {
        companyCode: '7203',
        companyName: 'トヨタ自動車',
        quantity: 100,
        acquisitionPriceSen: 280_000,
        currentPriceSen: 314_200,
        dividendYieldBp: 318,
        totalScore: 62,
        effectiveMetricCount: 1,
      },
    ]);
  });

  it('score_cardsが無い銘柄はtotalScore/effectiveMetricCountが0になる（防御的デフォルト）', async () => {
    // score_cards・transformed_metricsを経由しない生INSERT（欠損状態を意図的に再現）
    const now = '2026-08-23T00:00:00.000Z';
    await env.DB.prepare(
      'INSERT INTO companies (code, name, fetched_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    )
      .bind('9999', '未採点銘柄', now, now, now)
      .run();

    const user = await insertUser();
    const repository = new D1PortfolioRepository(env.DB);
    await repository.insert(samplePortfolio({ userId: user.id }));
    await repository.insertHolding(sampleHolding({ companyCode: '9999' }));

    const detail = await repository.getDetail('pf_1');
    expect(detail?.holdings[0]?.totalScore).toBe(0);
    expect(detail?.holdings[0]?.effectiveMetricCount).toBe(0);
    expect(detail?.holdings[0]?.currentPriceSen).toBeNull();
    expect(detail?.holdings[0]?.dividendYieldBp).toBeNull();
  });

  it('保有0件はholdingsが空配列', async () => {
    const user = await insertUser();
    const repository = new D1PortfolioRepository(env.DB);
    await repository.insert(samplePortfolio({ userId: user.id }));

    const detail = await repository.getDetail('pf_1');
    expect(detail?.holdings).toEqual([]);
  });
});

describe('countHoldings / findHolding / findHoldingRow', () => {
  it('保有件数を数えられる', async () => {
    await seedToyota();
    const user = await insertUser();
    const repository = new D1PortfolioRepository(env.DB);
    await repository.insert(samplePortfolio({ userId: user.id }));
    expect(await repository.countHoldings('pf_1')).toBe(0);

    await repository.insertHolding(sampleHolding());
    expect(await repository.countHoldings('pf_1')).toBe(1);
  });

  it('findHoldingは保有の有無をbooleanで返す', async () => {
    await seedToyota();
    const user = await insertUser();
    const repository = new D1PortfolioRepository(env.DB);
    await repository.insert(samplePortfolio({ userId: user.id }));
    await repository.insertHolding(sampleHolding());

    expect(await repository.findHolding('pf_1', '7203')).toBe(true);
    expect(await repository.findHolding('pf_1', '9999')).toBe(false);
  });

  it('findHoldingRowは対象1件のJOIN結果を返す', async () => {
    await seedToyota();
    const user = await insertUser();
    const repository = new D1PortfolioRepository(env.DB);
    await repository.insert(samplePortfolio({ userId: user.id }));
    await repository.insertHolding(sampleHolding());

    const row = await repository.findHoldingRow('pf_1', '7203');
    expect(row?.companyName).toBe('トヨタ自動車');
    expect(row?.currentPriceSen).toBe(314_200);

    expect(await repository.findHoldingRow('pf_1', '9999')).toBeNull();
  });
});

describe('insertHolding（複合PK重複INSERTの拒否）', () => {
  it('同じ(portfolioId, companyCode)を2回INSERTすると失敗する', async () => {
    await seedToyota();
    const user = await insertUser();
    const repository = new D1PortfolioRepository(env.DB);
    await repository.insert(samplePortfolio({ userId: user.id }));
    await repository.insertHolding(sampleHolding());

    await expect(repository.insertHolding(sampleHolding())).rejects.toThrow();
  });
});

describe('updateHolding（部分更新）', () => {
  it('quantityのみ更新するとacquisitionPriceSenは変わらない', async () => {
    await seedToyota();
    const user = await insertUser();
    const repository = new D1PortfolioRepository(env.DB);
    await repository.insert(samplePortfolio({ userId: user.id }));
    await repository.insertHolding(sampleHolding());

    await repository.updateHolding('pf_1', '7203', { quantity: 150, updatedAt: '2026-08-24T00:00:00.000Z' });

    const row = await repository.findHoldingRow('pf_1', '7203');
    expect(row?.quantity).toBe(150);
    expect(row?.acquisitionPriceSen).toBe(280_000);
  });

  it('acquisitionPriceSenのみ更新するとquantityは変わらない', async () => {
    await seedToyota();
    const user = await insertUser();
    const repository = new D1PortfolioRepository(env.DB);
    await repository.insert(samplePortfolio({ userId: user.id }));
    await repository.insertHolding(sampleHolding());

    await repository.updateHolding('pf_1', '7203', {
      acquisitionPriceSen: 275_000,
      updatedAt: '2026-08-24T00:00:00.000Z',
    });

    const row = await repository.findHoldingRow('pf_1', '7203');
    expect(row?.quantity).toBe(100);
    expect(row?.acquisitionPriceSen).toBe(275_000);
  });
});

describe('deleteHolding（冪等）', () => {
  it('保有中の銘柄を削除できる', async () => {
    await seedToyota();
    const user = await insertUser();
    const repository = new D1PortfolioRepository(env.DB);
    await repository.insert(samplePortfolio({ userId: user.id }));
    await repository.insertHolding(sampleHolding());

    await repository.deleteHolding('pf_1', '7203');
    expect(await repository.findHolding('pf_1', '7203')).toBe(false);
  });

  it('未保有の銘柄を削除しても例外にならない（冪等）', async () => {
    const user = await insertUser();
    const repository = new D1PortfolioRepository(env.DB);
    await repository.insert(samplePortfolio({ userId: user.id }));

    await expect(repository.deleteHolding('pf_1', '9999')).resolves.toBeUndefined();
  });
});

describe('countHoldingsByCompanyCode（DELETE /api/companies/:code の409判定用）', () => {
  it('複数ポートフォリオにまたがる保有件数を合算する', async () => {
    await seedToyota();
    const user = await insertUser();
    const repository = new D1PortfolioRepository(env.DB);
    await repository.insert(samplePortfolio({ id: 'pf_1', userId: user.id }));
    await repository.insert(samplePortfolio({ id: 'pf_2', userId: user.id }));
    await repository.insertHolding(sampleHolding({ portfolioId: 'pf_1' }));
    await repository.insertHolding(sampleHolding({ portfolioId: 'pf_2' }));

    expect(await repository.countHoldingsByCompanyCode('7203')).toBe(2);
  });

  it('保有されていない銘柄コードは0', async () => {
    const repository = new D1PortfolioRepository(env.DB);
    expect(await repository.countHoldingsByCompanyCode('9999')).toBe(0);
  });
});

describe('portfolios.user_id の ON DELETE CASCADE', () => {
  it('ユーザーを削除すると、そのユーザーのポートフォリオも消える', async () => {
    const user = await insertUser();
    const repository = new D1PortfolioRepository(env.DB);
    await repository.insert(samplePortfolio({ userId: user.id }));

    await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(user.id).run();

    expect(await repository.findById('pf_1')).toBeNull();
  });
});
