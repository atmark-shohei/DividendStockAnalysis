import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

import { type Company } from '@/domain/company/company';
import { type CompanyListQuery } from '@/domain/company/company-list-query';
import { type StoredMetric, type StoredScoring } from '@/domain/company/company-repository';
import { D1CompanyRepository } from '@/infra/d1/company-repository';

/**
 * `listSummaries()`（JOIN + WHERE + ORDER BY + LIMIT/OFFSET + 件数取得）の実D1確認。
 *
 * `POST /api/companies`（実際の採点ロジック）を経由すると、⑩⑬の値を狙って作るのが難しい
 * （閾値・CAGR等の計算を経由する必要がある）。ここでは `D1CompanyRepository.save()` を直接
 * 呼び、`StoredScoring.metrics` に狙った `dividendYieldValue`/`payoutRatioValue` を仕込む
 * （`company-repository-bulk-save.test.ts` と同じ「実D1セットアップ」に倣う）。
 */

const FETCHED_AT_9433 = '2026-08-01T00:00:00.000Z';
const FETCHED_AT_1301 = '2026-08-03T00:00:00.000Z';
const FETCHED_AT_7203 = '2026-08-05T00:00:00.000Z';

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

function metric(
  metricKey: string,
  value: number | null,
  score: number | null = value === null ? null : 5,
): StoredMetric {
  return { metricKey, score, value, unavailableReason: value === null ? 'input-missing' : null };
}

function scoring(totalScore: number, metrics: readonly StoredMetric[]): StoredScoring {
  return {
    totalScore,
    effectiveMetricCount: metrics.filter((m) => m.value !== null).length,
    metrics,
    calcVersion: 'test-v1',
    calculatedAt: '2026-08-01T00:00:00.000Z',
  };
}

/** 既定値で埋めた `CompanyListQuery` を組み立てる（handler の丸め込み後を模す） */
function query(overrides: Partial<CompanyListQuery> = {}): CompanyListQuery {
  return { q: '', sort: 'created_desc', page: 1, perPage: 15, ...overrides };
}

beforeEach(async () => {
  await env.DB.exec('DELETE FROM transformed_metrics');
  await env.DB.exec('DELETE FROM score_cards');
  await env.DB.exec('DELETE FROM dividend_records');
  await env.DB.exec('DELETE FROM financial_records');
  await env.DB.exec('DELETE FROM companies');
});

/**
 * 3社を仕込む:
 * - 9433 KDDI CORP: priceSen あり・⑩⑬とも値あり
 * - 1301 サンプル水産: priceSen が null（未入力）・⑩は値あり、⑬は行自体が無い（未判定）
 * - 7203 トヨタ自動車: priceSen あり・⑩は行自体が無い（未判定）、⑬は値あり
 */
async function seed(repository: D1CompanyRepository) {
  await repository.save(
    baseCompany({ code: '9433', name: 'KDDI CORP', priceSen: 425_000, fetchedAt: FETCHED_AT_9433 }),
    scoring(80, [metric('dividendYield', 318), metric('payoutRatio', 32.4)]),
  );
  await repository.save(
    baseCompany({ code: '1301', name: 'サンプル水産', priceSen: null, fetchedAt: FETCHED_AT_1301 }),
    // payoutRatio の行を意図的に作らない（未判定と「行が無い」を区別する）
    scoring(90, [metric('dividendYield', 500)]),
  );
  await repository.save(
    baseCompany({
      code: '7203',
      name: 'トヨタ自動車',
      priceSen: 300_000,
      fetchedAt: FETCHED_AT_7203,
    }),
    // dividendYield の行を意図的に作らない
    scoring(60, [metric('payoutRatio', 20)]),
  );
}

describe('listSummaries — q（部分一致、コード・銘柄名、大文字小文字混在）', () => {
  it('銘柄コードの部分一致でヒットする', async () => {
    const repository = new D1CompanyRepository(env.DB);
    await seed(repository);

    const result = await repository.listSummaries(query({ q: '203' }));
    expect(result.items.map((i) => i.code)).toEqual(['7203']);
    expect(result.total).toBe(1);
  });

  it('銘柄名（日本語）の部分一致でヒットする', async () => {
    const repository = new D1CompanyRepository(env.DB);
    await seed(repository);

    const result = await repository.listSummaries(query({ q: '水産' }));
    expect(result.items.map((i) => i.code)).toEqual(['1301']);
  });

  it('小文字の q（kddi）が大文字表記の銘柄名（KDDI CORP）にヒットする（SQLite既定LIKEの大文字小文字非区別の実測）', async () => {
    const repository = new D1CompanyRepository(env.DB);
    await seed(repository);

    const result = await repository.listSummaries(query({ q: 'kddi' }));
    expect(result.items.map((i) => i.code)).toEqual(['9433']);
  });

  it('q 未指定（空文字）は絞り込まない', async () => {
    const repository = new D1CompanyRepository(env.DB);
    await seed(repository);

    const result = await repository.listSummaries(query({ q: '' }));
    expect(result.total).toBe(3);
  });

  it('該当なしなら空配列・total=0', async () => {
    const repository = new D1CompanyRepository(env.DB);
    await seed(repository);

    const result = await repository.listSummaries(query({ q: '該当しない銘柄名' }));
    expect(result.items).toEqual([]);
    expect(result.total).toBe(0);
  });

  it('q="_" はワイルドカードとして解釈されず、文字通りの一致のみをヒットさせる（CR-1）', async () => {
    const repository = new D1CompanyRepository(env.DB);
    await seed(repository);

    // 未エスケープなら「任意の1文字」として全銘柄コード・銘柄名にヒットしてしまう
    const result = await repository.listSummaries(query({ q: '_' }));
    expect(result.items).toEqual([]);
    expect(result.total).toBe(0);
  });

  it('q="%" はワイルドカードとして解釈されず、文字通りの一致のみをヒットさせる（CR-1）', async () => {
    const repository = new D1CompanyRepository(env.DB);
    await seed(repository);

    const result = await repository.listSummaries(query({ q: '%' }));
    expect(result.items).toEqual([]);
    expect(result.total).toBe(0);
  });
});

describe('listSummaries — sort（DB側 ORDER BY。JS側ソートに戻っていない）', () => {
  it('created_desc（既定）: fetchedAt 降順', async () => {
    const repository = new D1CompanyRepository(env.DB);
    await seed(repository);

    const result = await repository.listSummaries(query({ sort: 'created_desc' }));
    expect(result.items.map((i) => i.code)).toEqual(['7203', '1301', '9433']);
  });

  it('score_desc: score_cards.total_score 降順', async () => {
    const repository = new D1CompanyRepository(env.DB);
    await seed(repository);

    const result = await repository.listSummaries(query({ sort: 'score_desc' }));
    expect(result.items.map((i) => i.code)).toEqual(['1301', '9433', '7203']);
  });

  it('score_asc: score_cards.total_score 昇順', async () => {
    const repository = new D1CompanyRepository(env.DB);
    await seed(repository);

    const result = await repository.listSummaries(query({ sort: 'score_asc' }));
    expect(result.items.map((i) => i.code)).toEqual(['7203', '9433', '1301']);
  });

  it('code_asc: companies.code 昇順', async () => {
    const repository = new D1CompanyRepository(env.DB);
    await seed(repository);

    const result = await repository.listSummaries(query({ sort: 'code_asc' }));
    expect(result.items.map((i) => i.code)).toEqual(['1301', '7203', '9433']);
  });
});

describe('listSummaries — page/perPage（境界）', () => {
  it('perPage=1: 1件ずつ返し、total はページングの影響を受けない', async () => {
    const repository = new D1CompanyRepository(env.DB);
    await seed(repository);

    const page1 = await repository.listSummaries(query({ sort: 'code_asc', page: 1, perPage: 1 }));
    expect(page1.items.map((i) => i.code)).toEqual(['1301']);
    expect(page1.total).toBe(3);

    const page2 = await repository.listSummaries(query({ sort: 'code_asc', page: 2, perPage: 1 }));
    expect(page2.items.map((i) => i.code)).toEqual(['7203']);
    expect(page2.total).toBe(3);
  });

  it('最終ページの端数（3件をperPage=2で2ページ目は1件）', async () => {
    const repository = new D1CompanyRepository(env.DB);
    await seed(repository);

    const lastPage = await repository.listSummaries(
      query({ sort: 'code_asc', page: 2, perPage: 2 }),
    );
    expect(lastPage.items.map((i) => i.code)).toEqual(['9433']);
    expect(lastPage.total).toBe(3);
  });

  it('存在しないページ番号は空配列だが total は件数のまま', async () => {
    const repository = new D1CompanyRepository(env.DB);
    await seed(repository);

    const emptyPage = await repository.listSummaries(
      query({ sort: 'code_asc', page: 99, perPage: 15 }),
    );
    expect(emptyPage.items).toEqual([]);
    expect(emptyPage.total).toBe(3);
  });
});

describe('listSummaries — 同点データのページング安定性（CR-2）', () => {
  /**
   * このテストは「タイブレーカー（`companies.code` 昇順）が実装されていること」の確認と
   * 将来の回帰検知が目的。CR-2 修正前（タイブレーカー無し）でも、SQLite の内部順序
   * （多くの場合 rowid 順＝insert順）がたまたま `code` 昇順と一致すると green になりうるため、
   * 「未実装だと必ず red になる」ことまでは保証しない。CR-2 の修正自体はコードレビューで確認する。
   */
  it('score_desc で totalScore が同点でも、ページを跨いでも全件が過不足なく1回ずつ出現する', async () => {
    const repository = new D1CompanyRepository(env.DB);
    // 4社とも totalScore=70 で同点にする（companies.code だけが異なる）
    const tiedCodes = ['4001', '4002', '4003', '4004'];
    for (const [index, code] of tiedCodes.entries()) {
      await repository.save(
        baseCompany({
          code,
          name: `同点銘柄${code}`,
          fetchedAt: `2026-08-0${index + 1}T00:00:00.000Z`,
        }),
        scoring(70, [metric('dividendYield', 300)]),
      );
    }

    const page1 = await repository.listSummaries(
      query({ sort: 'score_desc', page: 1, perPage: 2 }),
    );
    const page2 = await repository.listSummaries(
      query({ sort: 'score_desc', page: 2, perPage: 2 }),
    );

    // タイブレーカー（companies.code 昇順）により、常に code_asc の順で2件ずつ切られる
    expect(page1.items.map((i) => i.code)).toEqual(['4001', '4002']);
    expect(page2.items.map((i) => i.code)).toEqual(['4003', '4004']);

    // 重複・欠落が無いことを明示的に確認
    const allCodes = [...page1.items, ...page2.items].map((i) => i.code);
    expect(new Set(allCodes).size).toBe(4);
    expect(page1.total).toBe(4);
  });
});

describe('listSummaries — priceSen/dividendYieldValue/payoutRatioValue の JOIN 結果', () => {
  it('値がある場合はそのまま返す', async () => {
    const repository = new D1CompanyRepository(env.DB);
    await seed(repository);

    const result = await repository.listSummaries(query({ q: '9433' }));
    const item = result.items[0];
    expect(item?.priceSen).toBe(425_000);
    expect(item?.dividendYieldValue).toBe(318);
    expect(item?.payoutRatioValue).toBe(32.4);
  });

  it('priceSen が未入力（null）の会社はそのまま null', async () => {
    const repository = new D1CompanyRepository(env.DB);
    await seed(repository);

    const result = await repository.listSummaries(query({ q: '1301' }));
    expect(result.items[0]?.priceSen).toBeNull();
  });

  it('transformed_metrics に該当 metric_key の行が無い会社は該当フィールドが null になる（0に丸めない）', async () => {
    const repository = new D1CompanyRepository(env.DB);
    await seed(repository);

    // 1301 は payoutRatio の行を作っていない
    const sample1301 = await repository.listSummaries(query({ q: '1301' }));
    expect(sample1301.items[0]?.payoutRatioValue).toBeNull();
    expect(sample1301.items[0]?.dividendYieldValue).toBe(500);

    // 7203 は dividendYield の行を作っていない
    const sample7203 = await repository.listSummaries(query({ q: '7203' }));
    expect(sample7203.items[0]?.dividendYieldValue).toBeNull();
    expect(sample7203.items[0]?.payoutRatioValue).toBe(20);
  });

  it('会社1件につき複数行に膨らまない（1社1行に保たれる）', async () => {
    const repository = new D1CompanyRepository(env.DB);
    await seed(repository);

    const result = await repository.listSummaries(query({}));
    expect(result.items).toHaveLength(3);
    const uniqueCodes = new Set(result.items.map((i) => i.code));
    expect(uniqueCodes.size).toBe(3);
  });
});

describe('listSummaries — 空一覧', () => {
  it('保存が0件でも空配列・total=0', async () => {
    const repository = new D1CompanyRepository(env.DB);
    const result = await repository.listSummaries(query());
    expect(result.items).toEqual([]);
    expect(result.total).toBe(0);
  });
});
