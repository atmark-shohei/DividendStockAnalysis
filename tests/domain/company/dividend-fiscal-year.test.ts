import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { toFiscalYearDividends } from '@/domain/company/dividend-fiscal-year';
import { type DividendPayment } from '@/domain/company/market-data-source';
import { parseChart } from '@/infra/yahoo/parse-chart';

/**
 * 権利落ちベースの配当（Yahoo）を決算年度へ集計する。
 * 仕様: docs/02_design/logic/market-data-source.md §3.2・§3.4・§4.2・§7.1
 *
 * **ネットワーク非依存の純粋関数。** 実フィクスチャを使う分割またぎのテストだけ
 * `parseChart` 経由で本物の `DividendPayment[]` を作る（`.claude/rules/backend.md`
 * 「テストで実 API を叩かない」— ここでは保存済みの fixture を読むだけで、
 * 実 API へは問い合わせない）。
 */

function payment(exDividendDate: string, amountYenText: string): DividendPayment {
  return { exDividendDate, amountYenText };
}

function fixtureText(code: string): string {
  return readFileSync(
    fileURLToPath(new URL(`../../fixtures/yahoo/${code}.json`, import.meta.url)),
    'utf8',
  );
}

function fixturePayments(code: string): readonly DividendPayment[] {
  const result = parseChart(fixtureText(code), code);
  if (!result.ok) throw new Error(`fixture のパースに失敗した: ${JSON.stringify(result.error)}`);
  return result.value.dividendPayments;
}

function unwrap<T>(result: { ok: boolean; value?: T; error?: unknown }) {
  if (!result.ok) throw new Error(`集計に失敗した: ${JSON.stringify(result.error)}`);
  return result.value as T;
}

describe('決算年度への集計（§3.2 権利落ち日→決算年度）', () => {
  it('3月期・権利落ち 2025-09-29(35) と 2026-03-30(40) → 2026年度に7,500銭', () => {
    const result = toFiscalYearDividends(
      [payment('2025-09-29', '35'), payment('2026-03-30', '40')],
      3,
      new Date('2026-04-01T00:00:00.000Z'),
    );
    const { records } = unwrap(result);
    expect(records).toEqual([{ fiscalYear: 2026, kind: 'actual', annualAmountSen: 7_500 }]);
  });

  it('3月期・期末日ちょうどの境界: 2026-03-31 は2026年度、2026-04-01 は2027年度', () => {
    const result = toFiscalYearDividends(
      [payment('2026-03-31', '10'), payment('2026-04-01', '20')],
      3,
      new Date('2027-04-01T00:00:00.000Z'),
    );
    const { records } = unwrap(result);
    expect(records.map((r) => r.fiscalYear)).toEqual([2026, 2027]);
    expect(records[0]?.annualAmountSen).toBe(1_000);
    expect(records[1]?.annualAmountSen).toBe(2_000);
  });

  it('12月期・2025-01-01 と 2025-12-31 はどちらも2025年度', () => {
    const result = toFiscalYearDividends(
      [payment('2025-01-01', '10'), payment('2025-12-31', '20')],
      12,
      new Date('2025-12-31T00:00:00.000Z'),
    );
    const { records } = unwrap(result);
    expect(records).toEqual([{ fiscalYear: 2025, kind: 'actual', annualAmountSen: 3_000 }]);
  });

  it('12月期・2024-12-31 は2024年度（M=12の折り返し）', () => {
    const result = toFiscalYearDividends(
      [payment('2024-12-31', '10')],
      12,
      new Date('2024-12-31T00:00:00.000Z'),
    );
    const { records } = unwrap(result);
    expect(records).toEqual([{ fiscalYear: 2024, kind: 'actual', annualAmountSen: 1_000 }]);
  });

  it('9月期・2025-10-01 は2026年度', () => {
    const result = toFiscalYearDividends(
      [payment('2025-10-01', '10')],
      9,
      new Date('2026-09-30T00:00:00.000Z'),
    );
    const { records } = unwrap(result);
    expect(records).toEqual([{ fiscalYear: 2026, kind: 'actual', annualAmountSen: 1_000 }]);
  });

  it('年1回配当（期末のみ）でも正しい年度に入る', () => {
    const result = toFiscalYearDividends(
      [payment('2026-03-31', '80')],
      3,
      new Date('2026-03-31T00:00:00.000Z'),
    );
    const { records } = unwrap(result);
    expect(records).toEqual([{ fiscalYear: 2026, kind: 'actual', annualAmountSen: 8_000 }]);
  });

  it('年4回配当（四半期配当）が同じ年度に合算される', () => {
    const result = toFiscalYearDividends(
      [
        payment('2025-06-27', '20'),
        payment('2025-09-29', '20'),
        payment('2025-12-26', '20'),
        payment('2026-03-30', '20'),
      ],
      3,
      new Date('2026-03-31T00:00:00.000Z'),
    );
    const { records } = unwrap(result);
    expect(records).toEqual([{ fiscalYear: 2026, kind: 'actual', annualAmountSen: 8_000 }]);
  });
});

describe('§3.4 合算してから丸める', () => {
  it('0.745833 + 0.745833 → 149銭（150銭ではない）', () => {
    const result = toFiscalYearDividends(
      [payment('2000-09-28', '0.745833'), payment('2001-03-28', '0.745833')],
      3,
      new Date('2001-03-31T00:00:00.000Z'),
    );
    const { records, diagnostics } = unwrap(result);
    expect(records).toEqual([{ fiscalYear: 2001, kind: 'actual', annualAmountSen: 149 }]);
    expect(diagnostics).toEqual([
      {
        block: '配当',
        fiscalYearKey: '2001',
        column: '年間配当',
        reason: 'rounded',
        raw: expect.any(String),
      },
    ]);
  });

  it('丸めが起きなければ rounded は出ない（35+40 は丸めない）', () => {
    const result = toFiscalYearDividends(
      [payment('2025-09-29', '35'), payment('2026-03-30', '40')],
      3,
      new Date('2026-04-01T00:00:00.000Z'),
    );
    const { diagnostics } = unwrap(result);
    expect(diagnostics).toEqual([]);
  });

  it('銭にして安全整数を超える額 → unsafe-integer を出し、その年度は null', () => {
    const result = toFiscalYearDividends(
      [payment('2026-03-30', '99999999999999999999')],
      3,
      new Date('2026-03-31T00:00:00.000Z'),
    );
    const { records, diagnostics } = unwrap(result);
    expect(records).toEqual([{ fiscalYear: 2026, kind: 'actual', annualAmountSen: null }]);
    expect(diagnostics.map((d) => d.reason)).toContain('unsafe-integer');
  });

  it('配当が0件 → 空配列。例外を投げない', () => {
    const result = toFiscalYearDividends([], 3, new Date('2026-03-31T00:00:00.000Z'));
    const { records, diagnostics } = unwrap(result);
    expect(records).toEqual([]);
    expect(diagnostics).toEqual([]);
  });

  it('配当額 0 の支払いがある年度は 0 を返す（null にしない。無配と欠損は別物）', () => {
    const result = toFiscalYearDividends(
      [payment('2026-03-30', '0')],
      3,
      new Date('2026-03-31T00:00:00.000Z'),
    );
    const { records, diagnostics } = unwrap(result);
    expect(records).toEqual([{ fiscalYear: 2026, kind: 'actual', annualAmountSen: 0 }]);
    expect(diagnostics).toEqual([]);
  });

  it('丸めた結果 0 銭になる年度は null（0 にしない）', () => {
    const result = toFiscalYearDividends(
      [payment('2026-03-30', '0.001')],
      3,
      new Date('2026-03-31T00:00:00.000Z'),
    );
    const { records, diagnostics } = unwrap(result);
    expect(records).toEqual([{ fiscalYear: 2026, kind: 'actual', annualAmountSen: null }]);
    expect(diagnostics.map((d) => d.reason)).toContain('rounded');
  });

  it('返す DividendRecord の kind はすべて actual', () => {
    const result = toFiscalYearDividends(
      [payment('2025-09-29', '35'), payment('2026-03-30', '40')],
      3,
      new Date('2026-04-01T00:00:00.000Z'),
    );
    const { records } = unwrap(result);
    for (const record of records) expect(record.kind).toBe('actual');
  });
});

describe('決算月の妥当性（推測で3月にしない）', () => {
  it.each([0, 13, 1.5, Number.NaN])('fiscalYearEndMonth=%p はエラー', (month) => {
    const result = toFiscalYearDividends([payment('2026-03-30', '40')], month, new Date());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({ kind: 'invalid-fiscal-year-end-month' });
  });
});

describe('§3.2 進行中の年度は集計しない', () => {
  it('3月期・取得時点2026-10-01: FY2027 のレコードを作らない（FY2026 の7,500銭のみ）', () => {
    const result = toFiscalYearDividends(
      [payment('2025-09-29', '35'), payment('2026-03-30', '40'), payment('2026-09-28', '40')],
      3,
      new Date('2026-10-01T00:00:00.000Z'),
    );
    const { records } = unwrap(result);
    expect(records).toEqual([{ fiscalYear: 2026, kind: 'actual', annualAmountSen: 7_500 }]);
  });

  it('期間末日ちょうど（3月期・取得時点2026-03-31）は FY2026 を作る', () => {
    const result = toFiscalYearDividends(
      [payment('2026-03-30', '40')],
      3,
      new Date('2026-03-31T00:00:00.000Z'),
    );
    const { records } = unwrap(result);
    expect(records).toEqual([{ fiscalYear: 2026, kind: 'actual', annualAmountSen: 4_000 }]);
  });

  it('取得時点は引数で渡す。同じ入力でも asOf が違えば結果が変わる', () => {
    const payments = [payment('2026-09-28', '40')];
    const beforeYearEnd = unwrap(
      toFiscalYearDividends(payments, 3, new Date('2026-10-01T00:00:00.000Z')),
    );
    const afterYearEnd = unwrap(
      toFiscalYearDividends(payments, 3, new Date('2027-04-01T00:00:00.000Z')),
    );
    expect(beforeYearEnd.records).toEqual([]);
    expect(afterYearEnd.records).toEqual([
      { fiscalYear: 2027, kind: 'actual', annualAmountSen: 4_000 },
    ]);
  });
});

describe('§3.2 カバー範囲内の空白年', () => {
  it('権利落ちが2020年度と2023年度にしかない → 2021・2022年度は0（無配）', () => {
    const result = toFiscalYearDividends(
      [payment('2019-04-01', '10'), payment('2022-04-01', '20')],
      3,
      new Date('2023-03-31T00:00:00.000Z'),
    );
    const { records } = unwrap(result);
    expect(records).toEqual([
      { fiscalYear: 2020, kind: 'actual', annualAmountSen: 1_000 },
      { fiscalYear: 2021, kind: 'actual', annualAmountSen: 0 },
      { fiscalYear: 2022, kind: 'actual', annualAmountSen: 0 },
      { fiscalYear: 2023, kind: 'actual', annualAmountSen: 2_000 },
    ]);
  });

  it('最古の権利落ちより前の年度はレコードを作らない（nullですらない）', () => {
    const result = toFiscalYearDividends(
      [payment('2019-04-01', '10')],
      3,
      new Date('2020-03-31T00:00:00.000Z'),
    );
    const { records } = unwrap(result);
    expect(records.some((r) => r.fiscalYear < 2020)).toBe(false);
  });

  it('全年度が空白（対象年度の配当が1件も無い）→ 空配列', () => {
    // 唯一の支払いが進行中の年度のため除外され、集計対象が1件も残らない
    const result = toFiscalYearDividends(
      [payment('2026-09-28', '40')],
      3,
      new Date('2026-10-01T00:00:00.000Z'),
    );
    const { records } = unwrap(result);
    expect(records).toEqual([]);
  });
});

describe('分割をまたぐ継続性（実フィクスチャ。設計書 §2.3 で約束した検証）', () => {
  it('9433: 2025年3月の1:2分割をまたぐ FY2024〜FY2026 がすべて分割調整後の基準で連続する', () => {
    const payments = fixturePayments('9433');
    const { records } = unwrap(
      toFiscalYearDividends(payments, 3, new Date('2026-08-03T00:00:00.000Z')),
    );
    const byYear = new Map(records.map((r) => [r.fiscalYear, r.annualAmountSen]));
    expect(byYear.get(2024)).toBe(7_000); // 35 + 35
    expect(byYear.get(2025)).toBe(7_250); // 35 + 37.5
    expect(byYear.get(2026)).toBe(8_000); // 40 + 40
  });

  it('1301（併合）の実フィクスチャでも連続する', () => {
    const payments = fixturePayments('1301');
    const { records } = unwrap(
      toFiscalYearDividends(payments, 3, new Date('2026-08-03T00:00:00.000Z')),
    );
    const byYear = new Map(records.map((r) => [r.fiscalYear, r.annualAmountSen]));
    // 2016-09-28 に 1:10 の併合。前後の年度が桁で不連続にならないことを確認する
    expect(byYear.get(2016)).toBe(5_000); // 2016-03-29 の 50円
    expect(byYear.get(2017)).toBe(6_000); // 2017-03-29 の 60円
  });
});
