import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { type MarketData } from '@/domain/company/market-data-source';
import { parseChart } from '@/infra/yahoo/parse-chart';

/**
 * Yahoo chart レスポンスのパース。
 * 仕様: docs/02_design/logic/market-data-source.md §3・§7.2
 *
 * **fixture は実際に取得した 9433 / 1301 そのもの。**
 * 手書きの理想形で書き換えないこと（`.claude/rules/backend.md`）。
 */

function fixtureText(code: string): string {
  return readFileSync(
    fileURLToPath(new URL(`../../fixtures/yahoo/${code}.json`, import.meta.url)),
    'utf8',
  );
}

function parsed(code: string): MarketData {
  const result = parseChart(fixtureText(code), code);
  if (!result.ok) throw new Error(`パースに失敗した: ${JSON.stringify(result.error)}`);
  return result.value;
}

/** 最小限の chart レスポンスを組み立てる */
function chartResponse(options: {
  readonly meta?: Record<string, unknown>;
  readonly events?: Record<string, unknown>;
  readonly error?: unknown;
  readonly noResult?: boolean;
}): string {
  const result = {
    meta: { symbol: '9433.T', ...(options.meta ?? {}) },
    ...(options.events !== undefined ? { events: options.events } : {}),
  };
  return JSON.stringify({
    chart: {
      result: options.noResult === true ? [] : [result],
      error: options.error ?? null,
    },
  });
}

describe('§3.1 events.dividends はキーではなく date を読む', () => {
  it('キー 1740754800（2025-03-01）と date 1743120000（2025-03-28）が違う場合、date を使う', () => {
    const text = chartResponse({
      events: {
        dividends: { '1740754800': { amount: 40, date: 1743120000 } },
      },
    });
    const result = parseChart(text, '9433');
    if (!result.ok) throw new Error('パースに失敗した');
    expect(result.value.dividendPayments).toEqual([
      { exDividendDate: '2025-03-28', amountYenText: '40' },
    ]);
  });

  it('9433 実フィクスチャ: 配当が複数件、金額は文字列のまま持ち回る', () => {
    const marketData = parsed('9433');
    expect(marketData.dividendPayments.length).toBeGreaterThan(0);
    // 実測: 0.745833 円（浮動小数点を経由せず文字列のまま）
    expect(marketData.dividendPayments.some((p) => p.amountYenText === '0.745833')).toBe(true);
  });
});

describe('§3.5 分割・併合は numerator/denominator をそのまま使う', () => {
  it('9433: numerator:100, denominator:1（分割）を保持する', () => {
    const marketData = parsed('9433');
    expect(marketData.splits).toContainEqual(
      expect.objectContaining({ numerator: 100, denominator: 1 }),
    );
  });

  it('1301: numerator:1, denominator:10（併合）を保持する', () => {
    const marketData = parsed('1301');
    expect(marketData.splits).toContainEqual(
      expect.objectContaining({ numerator: 1, denominator: 10 }),
    );
  });
});

describe('§3.3 株価と観測時刻はセットで扱う', () => {
  it('regularMarketTime が無い応答 → priceSen も null にする。診断が1件残る', () => {
    const text = chartResponse({ meta: { regularMarketPrice: 3000 } });
    const result = parseChart(text, '9433');
    if (!result.ok) throw new Error('パースに失敗した');
    expect(result.value.priceSen).toBeNull();
    expect(result.value.priceAsOf).toBeNull();
    expect(result.value.diagnostics).toEqual([
      { block: '株価', fiscalYearKey: 'unknown', column: '株価', reason: 'unparsable-value', raw: '3000' },
    ]);
  });

  it('regularMarketPrice が無い → priceSen は null、他は返す。診断が1件残る', () => {
    const text = chartResponse({
      meta: { regularMarketTime: 1_700_000_000, longName: 'Example Inc.' },
    });
    const result = parseChart(text, '9433');
    if (!result.ok) throw new Error('パースに失敗した');
    expect(result.value.priceSen).toBeNull();
    expect(result.value.priceAsOf).toBeNull();
    expect(result.value.name).toBe('Example Inc.');
    expect(result.value.diagnostics).toEqual([
      {
        block: '株価',
        fiscalYearKey: 'unknown',
        column: '株価',
        reason: 'unparsable-value',
        raw: '1700000000',
      },
    ]);
  });

  it('両方揃っていれば priceSen（銭）と priceAsOf（UTC ISO 8601）を返す。診断は残らない', () => {
    const text = chartResponse({
      meta: { regularMarketPrice: 2903, regularMarketTime: 1_785_738_600 },
    });
    const result = parseChart(text, '9433');
    if (!result.ok) throw new Error('パースに失敗した');
    expect(result.value.priceSen).toBe(290_300);
    expect(result.value.priceAsOf).toBe('2026-08-03T06:30:00.000Z');
    expect(result.value.diagnostics).toEqual([]);
  });

  it('0以下の株価は取り込まない（priceSen は null）。診断が1件残る', () => {
    const text = chartResponse({
      meta: { regularMarketPrice: 0, regularMarketTime: 1_700_000_000 },
    });
    const result = parseChart(text, '9433');
    if (!result.ok) throw new Error('パースに失敗した');
    expect(result.value.priceSen).toBeNull();
    expect(result.value.diagnostics).toEqual([
      { block: '株価', fiscalYearKey: 'unknown', column: '株価', reason: 'unparsable-value', raw: '0' },
    ]);
  });

  it('業務上限（1株1,000,000円）を超える株価は取り込まない。unsafe-integer の診断が1件残る', () => {
    const text = chartResponse({
      meta: { regularMarketPrice: 1_000_001, regularMarketTime: 1_700_000_000 },
    });
    const result = parseChart(text, '9433');
    if (!result.ok) throw new Error('パースに失敗した');
    expect(result.value.priceSen).toBeNull();
    expect(result.value.diagnostics).toEqual([
      {
        block: '株価',
        fiscalYearKey: 'unknown',
        column: '株価',
        reason: 'unsafe-integer',
        raw: '1000001',
      },
    ]);
  });

  it('両方とも無い（該当データが存在しない銘柄）→ 診断を積まない', () => {
    const text = chartResponse({});
    const result = parseChart(text, '9433');
    if (!result.ok) throw new Error('パースに失敗した');
    expect(result.value.priceSen).toBeNull();
    expect(result.value.diagnostics).toEqual([]);
  });

  it('9433 実フィクスチャの株価と観測時刻', () => {
    const marketData = parsed('9433');
    expect(marketData.priceSen).toBe(290_300);
    expect(marketData.priceAsOf).toBe('2026-08-03T06:30:00.000Z');
  });
});

describe('§7.2 配当エントリの amount/date が読めない場合（§8-7 診断）', () => {
  it.each([
    {
      label: 'amount のみ欠如（date はある）→ fiscalYearKey は権利落ち日',
      entry: { date: 1743120000 },
      expectedFiscalYearKey: '2025-03-28',
    },
    {
      label: 'date のみ欠如（amount はある）→ fiscalYearKey は unknown',
      entry: { amount: 40 },
      expectedFiscalYearKey: 'unknown',
    },
    {
      label: '両方欠如 → fiscalYearKey は unknown',
      entry: {},
      expectedFiscalYearKey: 'unknown',
    },
  ])('$label', ({ entry, expectedFiscalYearKey }) => {
    const text = chartResponse({
      events: { dividends: { '1740754800': entry } },
    });
    const result = parseChart(text, '9433');
    if (!result.ok) throw new Error('パースに失敗した');
    expect(result.value.dividendPayments).toEqual([]);
    expect(result.value.diagnostics).toEqual([
      {
        block: '配当',
        fiscalYearKey: expectedFiscalYearKey,
        column: '配当明細',
        reason: 'unparsable-value',
        raw: JSON.stringify(entry),
      },
    ]);
  });
});

describe('§2.2 銘柄名は英語名のみ。longName → shortName → null', () => {
  it('longName が無ければ shortName', () => {
    const text = chartResponse({ meta: { shortName: 'KDDI CORPORATION' } });
    const result = parseChart(text, '9433');
    if (!result.ok) throw new Error('パースに失敗した');
    expect(result.value.name).toBe('KDDI CORPORATION');
  });

  it('longName・shortName の両方が無ければ null', () => {
    const text = chartResponse({});
    const result = parseChart(text, '9433');
    if (!result.ok) throw new Error('パースに失敗した');
    expect(result.value.name).toBeNull();
  });

  it('9433 実フィクスチャ: longName（KDDI Corporation）を優先する', () => {
    expect(parsed('9433').name).toBe('KDDI Corporation');
  });
});

describe('§7.2 events 自体が無い応答（配当実績の無い銘柄）', () => {
  it('events キーが無ければ空配列。エラーにしない', () => {
    const text = chartResponse({});
    const result = parseChart(text, '9433');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.dividendPayments).toEqual([]);
    expect(result.value.splits).toEqual([]);
  });
});

describe('§5.1 取り込みが成立しない場合', () => {
  it('chart.result が空 → unexpected-shape', () => {
    const text = chartResponse({ noResult: true });
    const result = parseChart(text, '9433');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('unexpected-shape');
  });

  it('chart.error が非 null → source-not-found', () => {
    const text = chartResponse({ error: { code: 'Not Found', description: 'No data found' } });
    const result = parseChart(text, '9999');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({ kind: 'source-not-found', code: '9999' });
  });

  it('JSON として壊れていれば malformed-response', () => {
    const result = parseChart('{ こわれた', '9433');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('malformed-response');
  });

  it('ルートがオブジェクトでなければ unexpected-shape', () => {
    const result = parseChart('[]', '9433');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('unexpected-shape');
  });

  it('meta が無ければ unexpected-shape', () => {
    const text = JSON.stringify({ chart: { result: [{}], error: null } });
    const result = parseChart(text, '9433');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('unexpected-shape');
  });

  it('例外を投げない。失敗は Result で返す', () => {
    expect(() => parseChart('null', '9433')).not.toThrow();
    expect(() => parseChart('', '9433')).not.toThrow();
  });
});

describe('実物2銘柄が取り込める', () => {
  it.each(['9433', '1301'])('%s が取り込める', (code) => {
    const result = parseChart(fixtureText(code), code);
    expect(result.ok).toBe(true);
  });

  it.each(['9433', '1301'])('%s の code は要求したコードそのもの', (code) => {
    expect(parsed(code).code).toBe(code);
  });
});
