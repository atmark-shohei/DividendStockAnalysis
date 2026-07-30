import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

import { type FinancialSource } from '@/domain/company/financial-source';
import { createApp } from '@/handler/app';
import { D1CompanyRepository } from '@/infra/d1/company-repository';
import type { AnalyzeCompanyRequest, ScoringResponse } from '@/handler/dto/company-input';

/**
 * handler → usecase → domain → infra(D1) の結線を通しで確認する。
 *
 * 計算そのものは domain 側のテストで尽くしてある。ここで見たいのは
 * **層をまたいだときに値が壊れないか**（銭が丸められない、`null` が 0 にならない、
 * 年度の並びが崩れない）。
 */

const FIXED_NOW = new Date('2026-07-28T00:00:00.000Z');

/** このテストファイルは IRバンク取り込みを対象にしないので、呼ばれたら落とす */
const unusedFinancialSource: FinancialSource = {
  fetchByCode: () => {
    throw new Error('このテストで FinancialSource が呼ばれるのは想定外');
  },
};

function app() {
  return createApp({
    repository: new D1CompanyRepository(env.DB),
    financialSource: unusedFinancialSource,
    now: () => FIXED_NOW,
  });
}

/** ROE 15%（10点）・営業利益率 20%（10点）が5年続く会社 */
function samplePayload(overrides: Partial<AnalyzeCompanyRequest> = {}): AnalyzeCompanyRequest {
  const years = [2025, 2024, 2023, 2022, 2021, 2020];
  return {
    code: '9433',
    name: 'サンプル通信',
    records: [
      {
        fiscalYear: 2026,
        isForecast: true,
        epsSen: 30_000,
        roePercent: null,
        revenueSen: null,
        operatingMarginPercent: null,
        dividendPerShareSen: 6_000,
      },
      ...years.map((fiscalYear, index) => ({
        fiscalYear,
        isForecast: false,
        // 直近ほど大きい。増配・増収を作る
        epsSen: 30_000 - index * 2_000,
        roePercent: 15,
        revenueSen: 1_000_000_000 - index * 50_000_000,
        operatingMarginPercent: 20,
        dividendPerShareSen: 6_000 - index * 400,
      })),
    ],
    dividends: [
      { fiscalYear: 2026, kind: 'forecast', annualAmountSen: 6_000 },
      ...years.map((fiscalYear, index) => ({
        fiscalYear,
        kind: 'actual' as const,
        annualAmountSen: 6_000 - index * 400,
      })),
    ],
    balanceSheet: {
      currentAssetsSen: 10_000_000,
      investmentSecuritiesSen: 0,
      totalLiabilitiesSen: 0,
      previousDividendTotalSen: 250_000,
    },
    multiples: { per: 9, perSource: 'manual', pbr: 1, pbrSource: 'manual' },
    // 株価 1,000 円、予想配当 60 円 → 利回り 6.00% → 10点
    priceSen: 100_000,
    ...overrides,
  };
}

async function post(payload: AnalyzeCompanyRequest) {
  return app().request('/api/companies', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

beforeEach(async () => {
  // テスト間で保存済みデータを持ち越さない
  await env.DB.exec('DELETE FROM transformed_metrics');
  await env.DB.exec('DELETE FROM score_cards');
  await env.DB.exec('DELETE FROM dividend_records');
  await env.DB.exec('DELETE FROM financial_records');
  await env.DB.exec('DELETE FROM companies');
});

describe('POST /api/companies', () => {
  it('採点して保存し、総合点と有効指標数を返す', async () => {
    const response = await post(samplePayload());
    expect(response.status).toBe(201);

    const body = (await response.json()) as ScoringResponse;
    expect(body.metrics).toHaveLength(10);
    expect(body.maxTotalScore).toBe(100);
    expect(body.totalMetricCount).toBe(10);
    expect(body.effectiveMetricCount).toBeGreaterThan(0);
    expect(body.totalScore).toBeLessThanOrEqual(100);
    // 入力日時は注入した時計から来る
    expect(body.fetchedAt).toBe(FIXED_NOW.toISOString());
  });

  it('⑩ は予想配当を採用し、その旨を返す（§2.1）', async () => {
    const body = (await (await post(samplePayload())).json()) as ScoringResponse;
    const dividendYield = body.metrics.find((metric) => metric.key === 'dividendYield');
    expect(body.dividendSource).toBe('forecast');
    // 60円 / 1000円 = 6.00% → 1/100% 単位で 600
    expect(dividendYield?.value).toBe(600);
    expect(dividendYield?.score).toBe(10);
  });

  it('⑤ ROE 15% は 10点、⑧ 営業利益率 20% は 10点', async () => {
    const body = (await (await post(samplePayload())).json()) as ScoringResponse;
    expect(body.metrics.find((metric) => metric.key === 'roeAverage')?.score).toBe(10);
    expect(body.metrics.find((metric) => metric.key === 'operatingMargin')?.score).toBe(10);
  });

  it('判定不能の指標は score も value も null で返る。0 にしない（§0.5）', async () => {
    const payload = samplePayload({
      multiples: { per: null, perSource: null, pbr: null, pbrSource: null },
    });
    const body = (await (await post(payload)).json()) as ScoringResponse;
    const mix = body.metrics.find((metric) => metric.key === 'mixCoefficient');
    expect(mix?.score).toBeNull();
    expect(mix?.value).toBeNull();
    expect(mix?.unavailableReason).toBe('input-missing');
  });

  it('銭が丸められずに往復する', async () => {
    // 1 銭差で利回りの区分が変わる境界を通す
    const payload = samplePayload({ priceSen: 100_001 });
    const body = (await (await post(payload)).json()) as ScoringResponse;
    expect(body.metrics.find((metric) => metric.key === 'dividendYield')?.value).toBe(600);

    const stored = await env.DB.prepare('SELECT price_sen FROM companies WHERE code = ?')
      .bind('9433')
      .first<{ price_sen: number }>();
    expect(stored?.price_sen).toBe(100_001);
  });

  it('⑨ PER/PBR の出所が D1 を往復し、詳細取得の応答にも出る（2026-07-29 追加）', async () => {
    await post(
      samplePayload({
        multiples: { per: 9, perSource: 'forecast-eps', pbr: 1, pbrSource: 'actual-bps' },
      }),
    );

    const stored = await env.DB.prepare(
      'SELECT per_source, pbr_source FROM companies WHERE code = ?',
    )
      .bind('9433')
      .first<{ per_source: string; pbr_source: string }>();
    expect(stored?.per_source).toBe('forecast-eps');
    expect(stored?.pbr_source).toBe('actual-bps');

    const body = (await (await app().request('/api/companies/9433')).json()) as ScoringResponse;
    expect(body.perSource).toBe('forecast-eps');
    expect(body.pbrSource).toBe('actual-bps');
  });

  it('PER/PBR が null なら出所も null（データなしと混同しない）', async () => {
    const payload = samplePayload({
      multiples: { per: null, perSource: null, pbr: null, pbrSource: null },
    });
    const body = (await (await post(payload)).json()) as ScoringResponse;
    expect(body.perSource).toBeNull();
    expect(body.pbrSource).toBeNull();
  });

  it('入力が不正なら 400。内部情報は返さない', async () => {
    const response = await app().request('/api/companies', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: 'あ', name: '' }),
    });
    expect(response.status).toBe(400);

    const body = (await response.json()) as { error: string; issues: unknown[] };
    expect(body.error).toContain('入力が不正');
    expect(JSON.stringify(body)).not.toMatch(/SELECT|INSERT|node_modules|\.ts:/);
  });

  it('株価が業務上限（1株 1,000,000 円）を超えたら 400', async () => {
    const response = await post(samplePayload({ priceSen: 100_000_001 }));
    expect(response.status).toBe(400);
  });

  it('同じ銘柄を2回送っても行が重複しない（自然キーの UNIQUE が効く）', async () => {
    await post(samplePayload());
    await post(samplePayload({ name: 'サンプル通信（更新後）' }));

    const companies = await env.DB.prepare('SELECT COUNT(*) AS count FROM companies').first<{
      count: number;
    }>();
    const records = await env.DB.prepare('SELECT COUNT(*) AS count FROM financial_records').first<{
      count: number;
    }>();
    expect(companies?.count).toBe(1);
    expect(records?.count).toBe(7);
  });

  it('整形指標を計算バージョン付きで保存する（再監査用）', async () => {
    await post(samplePayload());
    const card = await env.DB.prepare('SELECT calc_version, total_score FROM score_cards').first<{
      calc_version: string;
      total_score: number;
    }>();
    expect(card?.calc_version).toBeTruthy();

    const metrics = await env.DB.prepare(
      'SELECT COUNT(*) AS count FROM transformed_metrics',
    ).first<{
      count: number;
    }>();
    expect(metrics?.count).toBe(10);
  });
});

describe('GET /api/companies', () => {
  it('保存済みの一覧を返す', async () => {
    await post(samplePayload());
    const response = await app().request('/api/companies');
    expect(response.status).toBe(200);

    const body = (await response.json()) as { companies: { code: string; totalScore: number }[] };
    expect(body.companies).toHaveLength(1);
    expect(body.companies[0]?.code).toBe('9433');
  });

  it('空でも 200 と空配列を返す', async () => {
    const body = (await (await app().request('/api/companies')).json()) as { companies: unknown[] };
    expect(body.companies).toEqual([]);
  });
});

describe('GET /api/companies/:code', () => {
  it('保存済みの生データから採点し直して返す', async () => {
    const posted = (await (await post(samplePayload())).json()) as ScoringResponse;
    const response = await app().request('/api/companies/9433');
    expect(response.status).toBe(200);

    const body = (await response.json()) as ScoringResponse;
    // 保存→読み出しで値が変わらない（銭も年度の並びも壊れていない）
    expect(body.totalScore).toBe(posted.totalScore);
    expect(body.metrics).toEqual(posted.metrics);
  });

  it('未保存の銘柄は 404', async () => {
    const response = await app().request('/api/companies/1234');
    expect(response.status).toBe(404);
  });

  it('コードの形式が不正なら 400', async () => {
    const response = await app().request('/api/companies/abc');
    expect(response.status).toBe(400);
  });
});

describe('DELETE /api/companies/:code', () => {
  it('削除すると一覧からも明細からも消える', async () => {
    await post(samplePayload());
    const response = await app().request('/api/companies/9433', { method: 'DELETE' });
    expect(response.status).toBe(204);

    const remaining = await env.DB.prepare(
      'SELECT COUNT(*) AS count FROM financial_records',
    ).first<{
      count: number;
    }>();
    expect(remaining?.count).toBe(0);
    expect((await app().request('/api/companies/9433')).status).toBe(404);
  });
});

describe('GET /api/health', () => {
  it('疎通確認に使える', async () => {
    const response = await app().request('/api/health');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
  });
});
