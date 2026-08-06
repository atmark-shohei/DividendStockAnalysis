import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { type ImportedFinancials } from '@/domain/company/financial-source';
import { parseFyData } from '@/infra/irbank/parse-fy-data';

/**
 * IRバンク JSON の取り込み。
 * 仕様: docs/02_design/logic/irbank-json-import.md
 *
 * **fixture は 2026-07-28 に実際に取得した4銘柄そのもの。**
 * 手書きの理想形で書き換えないこと（`.claude/skills/import-financials/SKILL.md`）。
 * 実物には想定外が入っており、それを踏むことがこのテストの目的。
 */

const CODES = ['9433', '8306', '7203', '1301'] as const;

function fixture(code: string): unknown {
  const path = fileURLToPath(new URL(`../../fixtures/irbank/${code}.json`, import.meta.url));
  return JSON.parse(readFileSync(path, 'utf8'));
}

function parsed(code: string): ImportedFinancials {
  const result = parseFyData(fixture(code), code);
  if (!result.ok) throw new Error(`取り込みに失敗した: ${JSON.stringify(result.error)}`);
  return result.value;
}

function recordOf(imported: ImportedFinancials, fiscalYear: number) {
  const found = imported.records.find((entry) => entry.fiscalYear === fiscalYear);
  if (found === undefined) throw new Error(`${String(fiscalYear)} 年度が無い`);
  return found;
}

/** 1株配当は `dividends` にしか無い（ADR-0009 で `records` から外した） */
function dividendOf(imported: ImportedFinancials, fiscalYear: number) {
  const found = imported.dividends.find((entry) => entry.fiscalYear === fiscalYear);
  if (found === undefined) throw new Error(`${String(fiscalYear)} 年度の配当が無い`);
  return found;
}

// --- 合成データ（実物から派生させた最小形） -------------------------------

const PERFORMANCE_COLUMNS = ['売上高', '営業利益', '経常利益', '純利益', 'EPS', 'ROE', 'ROA'];
const DIVIDEND_COLUMNS = [
  '一株配当',
  '剰余金の配当',
  '自社株買い',
  '配当性向',
  '総還元性向',
  '純資産配当率',
];
const BALANCE_COLUMNS = [
  '総資産',
  '純資産',
  '株主資本',
  '利益剰余金',
  '短期借入金',
  '長期借入金',
  'BPS',
  '自己資本比率',
];

function balanceRow(values: {
  totalAssets?: unknown;
  netAssets?: unknown;
  bps?: unknown;
}): unknown[] {
  return [
    values.totalAssets ?? '-',
    values.netAssets ?? '-',
    '-',
    '-',
    '-',
    '-',
    values.bps ?? '-',
    '-',
  ];
}

function performanceRow(values: {
  revenue?: unknown;
  operatingIncome?: unknown;
  eps?: unknown;
  roe?: unknown;
}): unknown[] {
  return [
    values.revenue ?? '-',
    values.operatingIncome ?? '-',
    '-',
    '-',
    values.eps ?? '-',
    values.roe ?? '-',
    '-',
  ];
}

function dividendRow(values: { perShare?: unknown; total?: unknown }): unknown[] {
  return [values.perShare ?? '-', values.total ?? '-', '-', '-', '-', '-'];
}

function document(options: {
  readonly performance?: Record<string, unknown>;
  readonly dividend?: Record<string, unknown>;
  readonly balance?: Record<string, unknown>;
  readonly code?: string;
}): unknown {
  const code = options.code ?? '9999';
  const base = {
    業績: {
      meta: { code, type: '業績', item: { 年度: PERFORMANCE_COLUMNS } },
      item: options.performance ?? {},
    },
    配当: {
      meta: { code, type: '配当', item: { 年度: DIVIDEND_COLUMNS } },
      item: options.dividend ?? {},
    },
  };
  if (options.balance === undefined) return base;
  return {
    ...base,
    財務: {
      meta: { code, type: '財務', item: { 年度: BALANCE_COLUMNS } },
      item: options.balance,
    },
  };
}

function parseDocument(options: Parameters<typeof document>[0]) {
  return parseFyData(document(options), options.code ?? '9999');
}

// --- 実物4銘柄 -------------------------------------------------------------

describe('実物の4銘柄が取り込める', () => {
  it.each(CODES)('%s が取り込める', (code) => {
    const result = parseFyData(fixture(code), code);
    expect(result.ok).toBe(true);
  });

  it.each(CODES)('%s の金額はすべて安全整数（銭）', (code) => {
    const imported = parsed(code);
    for (const entry of imported.records) {
      for (const value of [entry.epsSen, entry.revenueSen]) {
        if (value !== null) expect(Number.isSafeInteger(value)).toBe(true);
      }
    }
    for (const entry of imported.dividends) {
      if (entry.annualAmountSen !== null) {
        expect(Number.isSafeInteger(entry.annualAmountSen)).toBe(true);
      }
    }
  });

  it.each(CODES)('%s の records は1株配当を持たない（ADR-0009 で dividends へ一本化）', (code) => {
    for (const entry of parsed(code).records) {
      expect(entry).not.toHaveProperty('dividendPerShareSen');
    }
  });

  it.each(CODES)('%s は予想の配当を1件だけ持つ', (code) => {
    const forecasts = parsed(code).dividends.filter((entry) => entry.kind === 'forecast');
    expect(forecasts).toHaveLength(1);
  });
});

describe('9433 NTT — 円の生値が銭になる', () => {
  const imported = parsed('9433');

  it('EPS 183.59 円 → 18359 銭', () => {
    expect(recordOf(imported, 2026).epsSen).toBe(18359);
  });

  it('売上高 6,071,915,000,000 円 → 607,191,500,000,000 銭', () => {
    expect(recordOf(imported, 2026).revenueSen).toBe(607_191_500_000_000);
  });

  it('ROE は % のまま。銭にしない', () => {
    expect(recordOf(imported, 2026).roePercent).toBe(13.93);
  });

  it('営業利益率を算出する（JSON に列が無い）', () => {
    // 1,099,125 / 6,071,915 = 18.10%
    expect(recordOf(imported, 2026).operatingMarginPercent).toBeCloseTo(18.1, 1);
  });

  it('業績に予想が無いので 2027 年度の EPS は null。配当だけが入る', () => {
    const forecast = recordOf(imported, 2027);
    expect(forecast.isForecast).toBe(true);
    expect(forecast.epsSen).toBeNull();
    expect(dividendOf(imported, 2027).annualAmountSen).toBe(8400);
  });

  it('⑨ 用の最新実績 EPS / BPS は予想を混ぜない', () => {
    // 2026 の EPS 183.59 と BPS 1333.5
    expect(imported.latestActualEpsSen).toBe(18359);
    expect(imported.latestActualBpsSen).toBe(133350);
  });
});

describe('8306 三菱UFJ — 営業利益が全年 "-"（金融業）', () => {
  const imported = parsed('8306');

  it('営業利益率は全年 null。0% ではない', () => {
    for (const entry of imported.records) {
      expect(entry.operatingMarginPercent).toBeNull();
    }
  });

  it('営業利益が無くても他の列は取り込める', () => {
    expect(recordOf(imported, 2026).epsSen).toBe(21317);
    expect(recordOf(imported, 2026).roePercent).toBe(10.9);
  });

  /**
   * ⑥ の負債総額を読むようになったので、総資産を読まなかった時代の
   * 「診断も出ない」は成り立たなくなった（balance-sheet-derivation.md §3.2）。
   * 円で引いても銭化で MAX_SAFE_INTEGER を超えるため、**実績5年すべてで桁あふれる**。
   */
  it('総資産（銭にすると安全整数を超える）は財務ブロックの unsafe-integer として残る', () => {
    const overflows = imported.diagnostics.filter((entry) => entry.reason === 'unsafe-integer');
    expect(overflows.length).toBeGreaterThan(0);
    for (const entry of overflows) {
      expect(entry.block).toBe('財務');
      expect(entry.column).toBe('総資産');
    }
  });

  it('業績・配当の金額列では桁あふれが起きない（EPS・一株配当は銭に収まる）', () => {
    expect(
      imported.diagnostics.filter(
        (entry) => entry.reason === 'unsafe-integer' && entry.block !== '財務',
      ),
    ).toEqual([]);
  });
});

describe('7203 トヨタ — ブロック間で年度レンジがずれる', () => {
  const imported = parsed('7203');

  it('業績 2023〜2027 / 財務 2022〜2026。records は業績と配当の和集合', () => {
    expect(imported.records.map((entry) => entry.fiscalYear)).toEqual([
      2023, 2024, 2025, 2026, 2027,
    ]);
  });

  it('最新実績は EPS も BPS も 2026 年度から取る（添字で揃えない）', () => {
    // 業績の最終行は 2027（予想）、財務の最終行は 2026。添字で揃えると1年ずれる
    expect(imported.latestActualEpsSen).toBe(29525); // 2026 の EPS 295.25
    expect(imported.latestActualBpsSen).toBe(306282); // 2026 の BPS 3062.82
  });

  it('予想行（オブジェクト形式）から isForecast が立つ', () => {
    const forecast = recordOf(imported, 2027);
    expect(forecast.isForecast).toBe(true);
    expect(forecast.epsSen).toBe(23018); // 予想 EPS 230.18
    expect(forecast.revenueSen).toBeNull(); // 予想の売上高は "-"
  });

  it('営業利益が数値文字列の年でも営業利益率が出る', () => {
    // 2023/03 の営業利益は "2725025000000"（文字列）
    expect(recordOf(imported, 2023).operatingMarginPercent).toBeCloseTo(7.33, 2);
    // 2025/03 は number。同じように扱えている
    expect(recordOf(imported, 2025).operatingMarginPercent).toBeCloseTo(9.98, 2);
  });
});

describe('1301 極洋 — 実績4期＋予想1期', () => {
  const imported = parsed('1301');

  it('予想 EPS と予想配当が揃う（③ が計算できる形）', () => {
    const forecast = recordOf(imported, 2027);
    expect(forecast.isForecast).toBe(true);
    expect(forecast.epsSen).toBe(60620); // 606.2
    expect(dividendOf(imported, 2027).annualAmountSen).toBe(16000); // 160
  });
});

// --- 値の型の揺れ（§3.1） --------------------------------------------------

describe('§3.1 同じ列で number / 数値文字列 / "-" が混在する', () => {
  it('数値文字列と number が同じ銭になる', () => {
    const result = parseDocument({
      dividend: {
        '2025/03': dividendRow({ perShare: '67.5' }),
        '2026/03': dividendRow({ perShare: 67.5 }),
      },
    });
    if (!result.ok) throw new Error('取り込みに失敗した');
    expect(result.value.dividends.map((entry) => entry.annualAmountSen)).toEqual([6750, 6750]);
  });

  it('"-" は null。**無配 0 円とは別物**', () => {
    const result = parseDocument({
      dividend: {
        '2025/03': dividendRow({ perShare: '-' }),
        '2026/03': dividendRow({ perShare: 0 }),
      },
    });
    if (!result.ok) throw new Error('取り込みに失敗した');
    expect(result.value.dividends.map((entry) => entry.annualAmountSen)).toEqual([null, 0]);
  });

  it('読めない文字列は null にして診断に残す（捨てない）', () => {
    const result = parseDocument({ dividend: { '2026/03': dividendRow({ perShare: 'N/A' }) } });
    if (!result.ok) throw new Error('取り込みに失敗した');
    expect(result.value.dividends[0]?.annualAmountSen).toBeNull();
    expect(result.value.diagnostics).toContainEqual({
      block: '配当',
      fiscalYearKey: '2026/03',
      column: '一株配当',
      reason: 'unparsable-value',
      raw: 'N/A',
    });
  });
});

// --- 銭への変換（§3.4） ----------------------------------------------------

describe('§3.4 銭への変換', () => {
  it('小数第3位以下は四捨五入し、丸めたことを記録する', () => {
    const result = parseDocument({ dividend: { '2026/03': dividendRow({ perShare: '1.005' }) } });
    if (!result.ok) throw new Error('取り込みに失敗した');
    expect(result.value.dividends[0]?.annualAmountSen).toBe(101);
    expect(result.value.diagnostics.map((entry) => entry.reason)).toContain('rounded');
  });

  it('丸めが起きていなければ rounded の診断は出ない（double の誤差と区別する）', () => {
    // 150.01 * 100 は 15000.999999999998 になるが、これは丸めではない
    const result = parseDocument({ performance: { '2026/03': performanceRow({ eps: 150.01 }) } });
    if (!result.ok) throw new Error('取り込みに失敗した');
    expect(result.value.records[0]?.epsSen).toBe(15001);
    expect(result.value.diagnostics.map((entry) => entry.reason)).not.toContain('rounded');
  });

  it('銭にすると安全整数を超える金額は null にして記録する', () => {
    const result = parseDocument({
      performance: { '2026/03': performanceRow({ revenue: '99999999999999999' }) },
    });
    if (!result.ok) throw new Error('取り込みに失敗した');
    expect(result.value.records[0]?.revenueSen).toBeNull();
    expect(result.value.diagnostics.map((entry) => entry.reason)).toContain('unsafe-integer');
  });

  it('負の値も銭になる', () => {
    const result = parseDocument({
      performance: { '2026/03': performanceRow({ operatingIncome: '-1234.56', revenue: 10000 }) },
    });
    if (!result.ok) throw new Error('取り込みに失敗した');
    expect(result.value.records[0]?.operatingMarginPercent).toBeCloseTo(-12.3456, 4);
  });
});

// --- 年度キーと予想の判別（§3.2 / §3.3） -----------------------------------

describe('§3.2 年度キー', () => {
  it('2026/03 → 2026 年度', () => {
    const result = parseDocument({ dividend: { '2026/03': dividendRow({ perShare: 100 }) } });
    if (!result.ok) throw new Error('取り込みに失敗した');
    expect(result.value.records[0]?.fiscalYear).toBe(2026);
  });

  it('同じ年度が2行あったら**両方**落として記録する（後勝ちにしない）', () => {
    const result = parseDocument({
      dividend: {
        '2026/03': dividendRow({ perShare: 100 }),
        '2026/12': dividendRow({ perShare: 200 }),
        '2025/03': dividendRow({ perShare: 50 }),
      },
    });
    if (!result.ok) throw new Error('取り込みに失敗した');
    expect(result.value.records.map((entry) => entry.fiscalYear)).toEqual([2025]);
    expect(result.value.diagnostics.map((entry) => entry.reason)).toContain('duplicate-year');
  });

  it('年度キーの形式が違う行は落として記録する', () => {
    const result = parseDocument({
      dividend: { 通期: dividendRow({ perShare: 100 }), '2026/03': dividendRow({ perShare: 80 }) },
    });
    if (!result.ok) throw new Error('取り込みに失敗した');
    expect(result.value.records.map((entry) => entry.fiscalYear)).toEqual([2026]);
    expect(result.value.diagnostics.map((entry) => entry.reason)).toContain('year-out-of-range');
  });
});

describe('§3.3 予想の判別', () => {
  it('備考が「予想」なら forecast', () => {
    const result = parseDocument({
      dividend: { '2027/03': { 0: 84, 1: '-', 2: '-', 3: '-', 4: '-', 5: '-', 備考: '予想' } },
    });
    if (!result.ok) throw new Error('取り込みに失敗した');
    expect(result.value.dividends[0]?.kind).toBe('forecast');
    expect(result.value.dividends[0]?.annualAmountSen).toBe(8400);
  });

  it('配列の行は実績', () => {
    const result = parseDocument({ dividend: { '2026/03': dividendRow({ perShare: 80 }) } });
    if (!result.ok) throw new Error('取り込みに失敗した');
    expect(result.value.dividends[0]?.kind).toBe('actual');
  });

  it('備考が「予想」以外なら、その年度を採用せず記録する', () => {
    const result = parseDocument({
      dividend: {
        '2026/03': { 0: 80, 備考: '変則決算' },
        '2025/03': dividendRow({ perShare: 70 }),
      },
    });
    if (!result.ok) throw new Error('取り込みに失敗した');
    expect(result.value.records.map((entry) => entry.fiscalYear)).toEqual([2025]);
    expect(result.value.diagnostics).toContainEqual({
      block: '配当',
      fiscalYearKey: '2026/03',
      column: '備考',
      reason: 'unknown-note',
      raw: '変則決算',
    });
  });

  it('revised は生成されない（IRバンクは修正を別行にしない）', () => {
    for (const code of CODES) {
      expect(parsed(code).dividends.some((entry) => entry.kind === 'revised')).toBe(false);
    }
  });
});

// --- ブロック間の突き合わせ（§3.2） ----------------------------------------

describe('§3.2 ブロックをまたぐときは添字ではなく年度で突き合わせる', () => {
  it('BPS は財務ブロックの最新実績年度から取る。業績の年度に引きずられない', () => {
    // 業績は 2026 まで、財務は 2024 までしか無い。添字で最後の行どうしを
    // 組にすると、2026 の EPS に 2024 の BPS が付いていることに気づけない
    const result = parseDocument({
      performance: {
        '2025/03': performanceRow({ eps: 100 }),
        '2026/03': performanceRow({ eps: 200 }),
      },
      balance: { '2023/03': balanceRow({ bps: 1000 }), '2024/03': balanceRow({ bps: 2000 }) },
    });
    if (!result.ok) throw new Error('取り込みに失敗した');
    expect(result.value.latestActualEpsSen).toBe(20000); // 2026
    expect(result.value.latestActualBpsSen).toBe(200000); // 2024（財務の最新）
  });

  it('財務ブロックが無くても取り込みは成立し、BPS は null になる', () => {
    const result = parseDocument({ performance: { '2026/03': performanceRow({ eps: 100 }) } });
    if (!result.ok) throw new Error('取り込みに失敗した');
    expect(result.value.latestActualBpsSen).toBeNull();
    expect(result.value.latestActualEpsSen).toBe(10000);
  });

  it('配当だけにある年度も records に入る（和集合を取る）', () => {
    const result = parseDocument({
      performance: { '2026/03': performanceRow({ eps: 100 }) },
      dividend: { '2027/03': dividendRow({ perShare: 50 }) },
    });
    if (!result.ok) throw new Error('取り込みに失敗した');
    expect(result.value.records.map((entry) => entry.fiscalYear)).toEqual([2026, 2027]);
    expect(recordOf(result.value, 2027).epsSen).toBeNull();
    expect(dividendOf(result.value, 2027).annualAmountSen).toBe(5000);
  });
});

// --- 営業利益率（§3.5） ----------------------------------------------------

describe('§3.5 営業利益率の算出', () => {
  it('売上高が 0 ならゼロ除算を避けて null', () => {
    const result = parseDocument({
      performance: { '2026/03': performanceRow({ revenue: 0, operatingIncome: 100 }) },
    });
    if (!result.ok) throw new Error('取り込みに失敗した');
    expect(result.value.records[0]?.operatingMarginPercent).toBeNull();
  });

  it('どちらかが欠損なら null', () => {
    const result = parseDocument({
      performance: { '2026/03': performanceRow({ revenue: 10000 }) },
    });
    if (!result.ok) throw new Error('取り込みに失敗した');
    expect(result.value.records[0]?.operatingMarginPercent).toBeNull();
  });
});

// --- 株式分割の反映漏れ（§5.3 の桁チェック） --------------------------------

describe('§5.3 前年比が ±80% を超えたら診断に記録する（除外はしない）', () => {
  function jumpsOf(options: Parameters<typeof document>[0]) {
    const result = parseDocument(options);
    if (!result.ok) throw new Error('取り込みに失敗した');
    return result.value.diagnostics.filter((entry) => entry.reason === 'suspicious-jump');
  }

  it('一株配当が +81% なら記録する', () => {
    expect(
      jumpsOf({
        dividend: {
          '2025/03': dividendRow({ perShare: 100 }),
          '2026/03': dividendRow({ perShare: 181 }),
        },
      }),
    ).toEqual([
      {
        block: '配当',
        fiscalYearKey: '2026/03',
        column: '一株配当',
        reason: 'suspicious-jump',
        raw: '10000 -> 18100',
      },
    ]);
  });

  it('一株配当が -81% なら記録する', () => {
    expect(
      jumpsOf({
        dividend: {
          '2025/03': dividendRow({ perShare: 100 }),
          '2026/03': dividendRow({ perShare: 19 }),
        },
      }),
    ).toHaveLength(1);
  });

  it('EPS でも記録する（業績ブロック）', () => {
    expect(
      jumpsOf({
        performance: {
          '2025/03': performanceRow({ eps: 100 }),
          '2026/03': performanceRow({ eps: 181 }),
        },
      }),
    ).toEqual([
      {
        block: '業績',
        fiscalYearKey: '2026/03',
        column: 'EPS',
        reason: 'suspicious-jump',
        raw: '10000 -> 18100',
      },
    ]);
  });

  it('ちょうど ±80% は「超えた」に当たらないので記録しない', () => {
    expect(
      jumpsOf({
        dividend: {
          '2025/03': dividendRow({ perShare: 100 }),
          '2026/03': dividendRow({ perShare: 180 }),
        },
      }),
    ).toEqual([]);
    expect(
      jumpsOf({
        dividend: {
          '2025/03': dividendRow({ perShare: 100 }),
          '2026/03': dividendRow({ perShare: 20 }),
        },
      }),
    ).toEqual([]);
  });

  it('境界をわずかに超えたら記録する', () => {
    expect(
      jumpsOf({
        dividend: {
          '2025/03': dividendRow({ perShare: 1000 }),
          '2026/03': dividendRow({ perShare: 1800.01 }),
        },
      }),
    ).toHaveLength(1);
  });

  it('前年が "-"（データなし）なら比較できないので記録しない', () => {
    expect(
      jumpsOf({
        dividend: {
          '2025/03': dividendRow({ perShare: '-' }),
          '2026/03': dividendRow({ perShare: 200 }),
        },
      }),
    ).toEqual([]);
  });

  it('前年が 0（無配）ならゼロ除算になるので記録しない', () => {
    expect(
      jumpsOf({
        dividend: {
          '2025/03': dividendRow({ perShare: 0 }),
          '2026/03': dividendRow({ perShare: 200 }),
        },
      }),
    ).toEqual([]);
  });

  it('記録しても値は採用したまま。null にしない', () => {
    const result = parseDocument({
      dividend: {
        '2025/03': dividendRow({ perShare: 100 }),
        '2026/03': dividendRow({ perShare: 181 }),
      },
      performance: {
        '2025/03': performanceRow({ eps: 100 }),
        '2026/03': performanceRow({ eps: 181 }),
      },
    });
    if (!result.ok) throw new Error('取り込みに失敗した');
    expect(result.value.records.map((entry) => entry.epsSen)).toEqual([10000, 18100]);
    expect(result.value.dividends.map((entry) => entry.annualAmountSen)).toEqual([10000, 18100]);
  });

  /**
   * 実物で誤検出していないかの確認。7203 の 2024/03 は EPS 179.47 → 365.94 で
   * **実際に倍増した年**（株式分割ではない）。仕様どおり値は採用したまま記録だけ残る。
   */
  it.each(CODES)('%s の実データで出る診断は既知のものだけ', (code) => {
    const jumps = parsed(code).diagnostics.filter((entry) => entry.reason === 'suspicious-jump');
    expect(jumps).toEqual(
      code === '7203'
        ? [
            {
              block: '業績',
              fiscalYearKey: '2024/03',
              column: 'EPS',
              reason: 'suspicious-jump',
              raw: '17947 -> 36594',
            },
          ]
        : [],
    );
  });

  /**
   * `/impl-from-spec` の code-reviewer 指摘（2026-07-29）: `records` は業績と配当の
   * **年度の和集合**であり、間の年度がどちらのブロックにも無ければ配列上は
   * 隣り合っていても暦年としては隣り合わない（決算期変更で1年が丸ごと欠ける
   * ケース。§3.2）。配列の添字だけで「前年比」を計算すると、複数年にまたがる
   * 複利成長を1年分の急変と誤認する。
   */
  it('配列上は隣り合っていても、暦年で1年差でなければ比較しない（年度が丸ごと欠けるケース）', () => {
    // 2021→2024 の3年で EPS が 130→250（年率 24%成長）。3年で見れば分割ではないが、
    // 1年分の変化として扱うと (250-130)/130 = 92.3% で閾値を超えてしまう
    const result = parseDocument({
      performance: {
        '2021/03': performanceRow({ eps: 130 }),
        '2024/03': performanceRow({ eps: 250 }),
      },
    });
    if (!result.ok) throw new Error('取り込みに失敗した');
    expect(result.value.records.map((entry) => entry.fiscalYear)).toEqual([2021, 2024]);
    expect(result.value.diagnostics.filter((entry) => entry.reason === 'suspicious-jump')).toEqual(
      [],
    );
  });

  it('暦年で1年差なら、間に他の年度が記録として無くても比較する', () => {
    const result = parseDocument({
      performance: {
        '2025/03': performanceRow({ eps: 100 }),
        '2026/03': performanceRow({ eps: 181 }),
      },
    });
    if (!result.ok) throw new Error('取り込みに失敗した');
    expect(
      result.value.diagnostics.filter((entry) => entry.reason === 'suspicious-jump'),
    ).toHaveLength(1);
  });
});

// --- 決算月の導出（§7.1.1。市場データ取り込み(Yahoo)向けの決算月の持ち回り） -------

describe('§3.2 決算月の導出（deriveFiscalYearEndMonth）', () => {
  it('年度キーが 2022/03〜2026/03 のみ → fiscalYearEndMonth: 3', () => {
    const result = parseDocument({
      dividend: {
        '2022/03': dividendRow({ perShare: 10 }),
        '2023/03': dividendRow({ perShare: 10 }),
        '2024/03': dividendRow({ perShare: 10 }),
        '2025/03': dividendRow({ perShare: 10 }),
        '2026/03': dividendRow({ perShare: 10 }),
      },
    });
    if (!result.ok) throw new Error('取り込みに失敗した');
    expect(result.value.fiscalYearEndMonth).toBe(3);
  });

  it('年度キーが 2022/12〜2026/12 のみ → fiscalYearEndMonth: 12', () => {
    const result = parseDocument({
      dividend: {
        '2022/12': dividendRow({ perShare: 10 }),
        '2023/12': dividendRow({ perShare: 10 }),
        '2024/12': dividendRow({ perShare: 10 }),
        '2025/12': dividendRow({ perShare: 10 }),
        '2026/12': dividendRow({ perShare: 10 }),
      },
    });
    if (!result.ok) throw new Error('取り込みに失敗した');
    expect(result.value.fiscalYearEndMonth).toBe(12);
  });

  it('2025/03 と 2026/12 が混在 → null（決算期変更）。推測しない。診断を1件出す', () => {
    const result = parseDocument({
      dividend: { '2025/03': dividendRow({ perShare: 10 }) },
      performance: { '2026/12': performanceRow({ eps: 100 }) },
    });
    if (!result.ok) throw new Error('取り込みに失敗した');
    expect(result.value.fiscalYearEndMonth).toBeNull();
    expect(result.value.diagnostics).toContainEqual({
      block: '決算期',
      fiscalYearKey: expect.any(String) as unknown as string,
      column: '決算月',
      reason: 'unknown-note',
      raw: '3/12',
    });
  });

  it('既存の年度パース（2026/03 → 2026年度）の挙動は変わらない（回帰）', () => {
    const result = parseDocument({ dividend: { '2026/03': dividendRow({ perShare: 100 }) } });
    if (!result.ok) throw new Error('取り込みに失敗した');
    expect(result.value.records[0]?.fiscalYear).toBe(2026);
    expect(result.value.fiscalYearEndMonth).toBe(3);
  });

  it.each(CODES)('%s の実物4銘柄は決算月が一意に定まる', (code) => {
    // 直近5期ぶんの年度キーが単一の決算月であることの実データ確認
    expect(parsed(code).fiscalYearEndMonth).not.toBeNull();
  });
});

// --- ⑥ の入力（負債総額・前期末の配当総額） --------------------------------
// 仕様: docs/02_design/logic/balance-sheet-derivation.md §2.2 / §2.3 / §5 / §6

/** 財務ブロックの1年ぶん。両列を明示して「片方だけ読める」ケースを作れるようにする */
function balanceYear(totalAssets: unknown, netAssets: unknown): unknown[] {
  return balanceRow({ totalAssets, netAssets, bps: 100 });
}

describe('§2.3 負債総額の対象年度の選択（財務ブロック）', () => {
  it('最新実績年度で両方読めればその年度を採る', () => {
    const result = parseDocument({
      performance: { '2026/03': performanceRow({ eps: 100 }) },
      balance: {
        '2025/03': balanceYear(2_000, 1_000),
        '2026/03': balanceYear(1_000, 400),
      },
    });
    if (!result.ok) throw new Error('取り込みに失敗した');
    expect(result.value.totalLiabilities).toEqual({ valueSen: 60_000, fiscalYear: 2026 });
  });

  it('最新実績年度が両方 "-" なら1つ前の年度を採る', () => {
    const result = parseDocument({
      performance: { '2026/03': performanceRow({ eps: 100 }) },
      balance: {
        '2025/03': balanceYear(2_000, 1_000),
        '2026/03': balanceYear('-', '-'),
      },
    });
    if (!result.ok) throw new Error('取り込みに失敗した');
    expect(result.value.totalLiabilities).toEqual({ valueSen: 100_000, fiscalYear: 2025 });
    // 正常な欠損なので診断は出さない
    expect(result.value.diagnostics.filter((entry) => entry.block === '財務')).toEqual([]);
  });

  it('総資産だけ読めても年度を確定させない（1つ前を採る）', () => {
    const result = parseDocument({
      performance: { '2026/03': performanceRow({ eps: 100 }) },
      balance: {
        '2025/03': balanceYear(2_000, 1_000),
        '2026/03': balanceYear(5_000, '-'),
      },
    });
    if (!result.ok) throw new Error('取り込みに失敗した');
    expect(result.value.totalLiabilities).toEqual({ valueSen: 100_000, fiscalYear: 2025 });
  });

  it('純資産だけ読めても年度を確定させない（2列のどちらが欠けても同じ）', () => {
    const result = parseDocument({
      performance: { '2026/03': performanceRow({ eps: 100 }) },
      balance: {
        '2025/03': balanceYear(2_000, 1_000),
        '2026/03': balanceYear('-', 900),
      },
    });
    if (!result.ok) throw new Error('取り込みに失敗した');
    expect(result.value.totalLiabilities).toEqual({ valueSen: 100_000, fiscalYear: 2025 });
  });

  it('最新年度が桁あふれでも1つ前を採り、unsafe-integer の診断が残る', () => {
    const result = parseDocument({
      performance: { '2026/03': performanceRow({ eps: 100 }) },
      balance: {
        '2025/03': balanceYear(2_000, 1_000),
        // 431.7兆 − 23.7兆 = 408.0兆円 → 4.08e16 銭（MAX_SAFE_INTEGER 超え）
        '2026/03': balanceYear(431_731_548_000_000, 23_744_152_000_000),
      },
    });
    if (!result.ok) throw new Error('取り込みに失敗した');
    // 診断が出た＝値が無い、ではない（§2.3）
    expect(result.value.totalLiabilities).toEqual({ valueSen: 100_000, fiscalYear: 2025 });
    expect(result.value.diagnostics.filter((entry) => entry.block === '財務')).toEqual([
      {
        block: '財務',
        fiscalYearKey: '2026/03',
        column: '総資産',
        reason: 'unsafe-integer',
        raw: '431731548000000 - 23744152000000',
      },
    ]);
  });

  it('総資産 < 純資産の年度は飛ばし、inconsistent-value の診断が残る', () => {
    const result = parseDocument({
      performance: { '2026/03': performanceRow({ eps: 100 }) },
      balance: {
        '2025/03': balanceYear(2_000, 1_000),
        '2026/03': balanceYear(1_000, 1_001),
      },
    });
    if (!result.ok) throw new Error('取り込みに失敗した');
    expect(result.value.totalLiabilities).toEqual({ valueSen: 100_000, fiscalYear: 2025 });
    expect(result.value.diagnostics.filter((entry) => entry.block === '財務')).toEqual([
      {
        block: '財務',
        fiscalYearKey: '2026/03',
        column: '総資産',
        reason: 'inconsistent-value',
        // どちらの列が誤りか機械的に決められないので、両方を残す（§2.2.1）
        raw: '1000 - 1001',
      },
    ]);
  });

  it('円の生値が整数でない年度は unparsable-value を残して飛ばす', () => {
    const result = parseDocument({
      performance: { '2026/03': performanceRow({ eps: 100 }) },
      balance: {
        '2025/03': balanceYear(2_000, 1_000),
        '2026/03': balanceYear('1000.5', 400),
      },
    });
    if (!result.ok) throw new Error('取り込みに失敗した');
    expect(result.value.totalLiabilities).toEqual({ valueSen: 100_000, fiscalYear: 2025 });
    expect(result.value.diagnostics.filter((entry) => entry.block === '財務')).toEqual([
      {
        block: '財務',
        fiscalYearKey: '2026/03',
        column: '総資産',
        reason: 'unparsable-value',
        raw: '1000.5 - 400',
      },
    ]);
  });

  it('数値として読めない文字列は診断をちょうど1件出して飛ばす（二重に出さない）', () => {
    const result = parseDocument({
      performance: { '2026/03': performanceRow({ eps: 100 }) },
      balance: { '2026/03': balanceYear('N/A', 400) },
    });
    if (!result.ok) throw new Error('取り込みに失敗した');
    expect(result.value.totalLiabilities).toBeNull();
    expect(result.value.diagnostics.filter((entry) => entry.block === '財務')).toEqual([
      {
        block: '財務',
        fiscalYearKey: '2026/03',
        column: '総資産',
        reason: 'unparsable-value',
        raw: 'N/A',
      },
    ]);
  });

  it('純資産だけが読めない文字列でも診断は1件。列は純資産に付く（総資産へ寄せない）', () => {
    const result = parseDocument({
      performance: { '2026/03': performanceRow({ eps: 100 }) },
      balance: { '2026/03': balanceYear(1_000, 'N/A') },
    });
    if (!result.ok) throw new Error('取り込みに失敗した');
    expect(result.value.totalLiabilities).toBeNull();
    // `yenAt` が壊れた**列そのもの**を記録する経路。2列から1つの値を作る
    // `readTotalLiabilities` の診断（列を総資産へ寄せる経路）とは別物なので、
    // ここで column が '総資産' になったら列の取り違えである
    expect(result.value.diagnostics.filter((entry) => entry.block === '財務')).toEqual([
      {
        block: '財務',
        fiscalYearKey: '2026/03',
        column: '純資産',
        reason: 'unparsable-value',
        raw: 'N/A',
      },
    ]);
  });

  it('純資産が整数でない年度も unparsable-value を残して飛ばす（raw は「総資産 - 純資産」の並び）', () => {
    const result = parseDocument({
      performance: { '2026/03': performanceRow({ eps: 100 }) },
      balance: {
        '2025/03': balanceYear(2_000, 1_000),
        '2026/03': balanceYear(2_000, '1000.5'),
      },
    });
    if (!result.ok) throw new Error('取り込みに失敗した');
    expect(result.value.totalLiabilities).toEqual({ valueSen: 100_000, fiscalYear: 2025 });
    // 非整数は「読めた値」なので `yenAt` は診断を出さず、`deriveTotalLiabilities` の
    // not-integer 経由で1件だけ出る。この経路は列を総資産に固定し、raw に両方を並べる
    expect(result.value.diagnostics.filter((entry) => entry.block === '財務')).toEqual([
      {
        block: '財務',
        fiscalYearKey: '2026/03',
        column: '総資産',
        reason: 'unparsable-value',
        raw: '2000 - 1000.5',
      },
    ]);
  });

  it('総資産・純資産の両方が読めない文字列なら、列ごとに1件ずつ計2件出る', () => {
    const result = parseDocument({
      performance: { '2026/03': performanceRow({ eps: 100 }) },
      balance: { '2026/03': balanceYear('N/A', '???') },
    });
    if (!result.ok) throw new Error('取り込みに失敗した');
    expect(result.value.totalLiabilities).toBeNull();
    // 壊れた列の数だけ出る（「ちょうど1件」ではない）。どちらの列を直せばよいか
    // 原典と突き合わせる人が判断できるよう、列ごとに残す
    expect(result.value.diagnostics.filter((entry) => entry.block === '財務')).toEqual([
      {
        block: '財務',
        fiscalYearKey: '2026/03',
        column: '総資産',
        reason: 'unparsable-value',
        raw: 'N/A',
      },
      {
        block: '財務',
        fiscalYearKey: '2026/03',
        column: '純資産',
        reason: 'unparsable-value',
        raw: '???',
      },
    ]);
  });

  it('input-missing の年度しか無ければ totalLiabilities は null（年度だけの組を作らない）', () => {
    const result = parseDocument({
      performance: { '2026/03': performanceRow({ eps: 100 }) },
      balance: { '2026/03': balanceYear('-', '-') },
    });
    if (!result.ok) throw new Error('取り込みに失敗した');
    expect(result.value.totalLiabilities).toBeNull();
    expect(result.value.diagnostics.filter((entry) => entry.block === '財務')).toEqual([]);
  });

  it('財務が予想行だけなら totalLiabilities は null', () => {
    const result = parseDocument({
      performance: { '2026/03': performanceRow({ eps: 100 }) },
      balance: {
        '2027/03': {
          0: 1_000,
          1: 400,
          2: '-',
          3: '-',
          4: '-',
          5: '-',
          6: 100,
          7: '-',
          備考: '予想',
        },
      },
    });
    if (!result.ok) throw new Error('取り込みに失敗した');
    expect(result.value.totalLiabilities).toBeNull();
  });

  it('予想行の総資産・純資産は採らない（実績行だけを走査する）', () => {
    const result = parseDocument({
      performance: { '2026/03': performanceRow({ eps: 100 }) },
      balance: {
        '2026/03': balanceYear(2_000, 1_000),
        '2027/03': { 0: 9_999, 1: 0, 2: '-', 3: '-', 4: '-', 5: '-', 6: 100, 7: '-', 備考: '予想' },
      },
    });
    if (!result.ok) throw new Error('取り込みに失敗した');
    expect(result.value.totalLiabilities).toEqual({ valueSen: 100_000, fiscalYear: 2026 });
  });

  it('財務ブロックが丸ごと無くても取り込みは成立し、totalLiabilities だけ null になる（§10-2）', () => {
    const result = parseDocument({ performance: { '2026/03': performanceRow({ eps: 100 }) } });
    if (!result.ok) throw new Error('取り込みに失敗した');
    expect(result.value.totalLiabilities).toBeNull();
    expect(result.value.latestActualEpsSen).toBe(10_000);
  });

  it('無借金（総資産 = 純資産）は 0 銭。null に丸めない（§5.4）', () => {
    const result = parseDocument({
      performance: { '2026/03': performanceRow({ eps: 100 }) },
      balance: { '2026/03': balanceYear(1_000, 1_000) },
    });
    if (!result.ok) throw new Error('取り込みに失敗した');
    expect(result.value.totalLiabilities).toEqual({ valueSen: 0, fiscalYear: 2026 });
  });

  it('債務超過（純資産が負）でも算出して年度を載せる（§5.2）', () => {
    const result = parseDocument({
      performance: { '2026/03': performanceRow({ eps: 100 }) },
      balance: { '2026/03': balanceYear(1_000, -500) },
    });
    if (!result.ok) throw new Error('取り込みに失敗した');
    expect(result.value.totalLiabilities).toEqual({ valueSen: 150_000, fiscalYear: 2026 });
    expect(result.value.diagnostics.filter((entry) => entry.block === '財務')).toEqual([]);
  });

  it('数値文字列で来ても読める（7203 の純資産は文字列の年がある）', () => {
    const result = parseDocument({
      performance: { '2026/03': performanceRow({ eps: 100 }) },
      balance: { '2026/03': balanceYear('105522331000000', '41020068000000') },
    });
    if (!result.ok) throw new Error('取り込みに失敗した');
    expect(result.value.totalLiabilities).toEqual({
      valueSen: 6_450_226_300_000_000,
      fiscalYear: 2026,
    });
  });
});

describe('§2.2 前期末の配当総額（剰余金の配当）', () => {
  it('最新実績年度の剰余金の配当を採り、その年度を載せる', () => {
    const result = parseDocument({
      dividend: {
        '2025/03': dividendRow({ perShare: 70, total: 2_000 }),
        '2026/03': dividendRow({ perShare: 80, total: 3_000 }),
      },
    });
    if (!result.ok) throw new Error('取り込みに失敗した');
    expect(result.value.previousDividendTotal).toEqual({ valueSen: 300_000, fiscalYear: 2026 });
  });

  it('最新実績年度が "-" なら1つ前の年度を採る', () => {
    const result = parseDocument({
      dividend: {
        '2025/03': dividendRow({ perShare: 70, total: 2_000 }),
        '2026/03': dividendRow({ perShare: 80 }),
      },
    });
    if (!result.ok) throw new Error('取り込みに失敗した');
    expect(result.value.previousDividendTotal).toEqual({ valueSen: 200_000, fiscalYear: 2025 });
  });

  it('剰余金の配当が "-" は正常な欠損。診断を出さない', () => {
    const result = parseDocument({ dividend: { '2026/03': dividendRow({ perShare: 80 }) } });
    if (!result.ok) throw new Error('取り込みに失敗した');
    expect(result.value.previousDividendTotal).toBeNull();
    expect(result.value.diagnostics.filter((entry) => entry.column === '剰余金の配当')).toEqual([]);
  });

  it('剰余金の配当 0 は 0 銭。null に丸めない（無配とデータ欠損は別物）', () => {
    const result = parseDocument({
      dividend: { '2026/03': dividendRow({ perShare: 0, total: 0 }) },
    });
    if (!result.ok) throw new Error('取り込みに失敗した');
    expect(result.value.previousDividendTotal).toEqual({ valueSen: 0, fiscalYear: 2026 });
  });

  it('配当が予想行だけなら previousDividendTotal は null', () => {
    const result = parseDocument({
      dividend: { '2027/03': { 0: 84, 1: 5_000, 2: '-', 3: '-', 4: '-', 5: '-', 備考: '予想' } },
    });
    if (!result.ok) throw new Error('取り込みに失敗した');
    expect(result.value.previousDividendTotal).toBeNull();
  });

  it('予想行の剰余金の配当は採らない（実績行だけを走査する）', () => {
    const result = parseDocument({
      dividend: {
        '2026/03': dividendRow({ perShare: 80, total: 3_000 }),
        '2027/03': { 0: 84, 1: 9_999, 2: '-', 3: '-', 4: '-', 5: '-', 備考: '予想' },
      },
    });
    if (!result.ok) throw new Error('取り込みに失敗した');
    expect(result.value.previousDividendTotal).toEqual({ valueSen: 300_000, fiscalYear: 2026 });
  });

  it('剰余金の配当が負なら null にし、inconsistent-value を1件残す（§5.5）', () => {
    const result = parseDocument({
      dividend: { '2026/03': dividendRow({ perShare: -1, total: -1 }) },
    });
    if (!result.ok) throw new Error('取り込みに失敗した');
    expect(result.value.previousDividendTotal).toBeNull();
    expect(result.value.diagnostics.filter((entry) => entry.column === '剰余金の配当')).toEqual([
      {
        block: '配当',
        fiscalYearKey: '2026/03',
        column: '剰余金の配当',
        reason: 'inconsistent-value',
        // 銭化後（-100）ではなく原文を残す。原典と突き合わせるのは人なので
        raw: '-1',
      },
    ]);
  });

  it('負の検査は senAt の外側にある（同じ文書の一株配当 -1 は -100 銭のまま採用される）', () => {
    const result = parseDocument({
      dividend: { '2026/03': dividendRow({ perShare: -1, total: -1 }) },
    });
    if (!result.ok) throw new Error('取り込みに失敗した');
    // senAt() を「負なら null」に変えると、この期待値と営業赤字の取り込みが同時に壊れる
    expect(result.value.dividends[0]?.annualAmountSen).toBe(-100);
  });

  it('負の年度は飛ばし、1つ前の実績年度を採る', () => {
    const result = parseDocument({
      dividend: {
        '2025/03': dividendRow({ perShare: 70, total: 2_000 }),
        '2026/03': dividendRow({ perShare: 80, total: -1 }),
      },
    });
    if (!result.ok) throw new Error('取り込みに失敗した');
    expect(result.value.previousDividendTotal).toEqual({ valueSen: 200_000, fiscalYear: 2025 });
  });

  it('負債総額と配当総額の決算年度が食い違っても両方返す。診断も出さない（§2.3）', () => {
    const result = parseDocument({
      performance: { '2026/03': performanceRow({ eps: 100 }) },
      dividend: {
        '2024/03': dividendRow({ perShare: 70, total: 2_000 }),
        '2025/03': dividendRow({ perShare: 75 }),
        '2026/03': dividendRow({ perShare: 80 }),
      },
      balance: { '2026/03': balanceYear(1_000, 400) },
    });
    if (!result.ok) throw new Error('取り込みに失敗した');
    expect(result.value.totalLiabilities).toEqual({ valueSen: 60_000, fiscalYear: 2026 });
    expect(result.value.previousDividendTotal).toEqual({ valueSen: 200_000, fiscalYear: 2024 });
    expect(
      result.value.diagnostics.filter(
        (entry) => entry.column === '剰余金の配当' || entry.column === '総資産',
      ),
    ).toEqual([]);
  });
});

describe('§6.4 実物4銘柄の ⑥ 入力', () => {
  it('9433: 負債総額・配当総額の両方が FY2026 で埋まる', () => {
    const imported = parsed('9433');
    expect(imported.totalLiabilities).toEqual({
      valueSen: 1_347_067_400_000_000,
      fiscalYear: 2026,
    });
    expect(imported.previousDividendTotal).toEqual({
      valueSen: 30_154_700_000_000,
      fiscalYear: 2026,
    });
  });

  it('1301: 負債総額・配当総額の両方が FY2026 で埋まる', () => {
    const imported = parsed('1301');
    expect(imported.totalLiabilities).toEqual({ valueSen: 13_526_000_000_000, fiscalYear: 2026 });
    expect(imported.previousDividendTotal).toEqual({ valueSen: 155_400_000_000, fiscalYear: 2026 });
  });

  it('7203: 剰余金の配当は全年 "-" で null。負債総額は算出される（円で引いてから銭化）', () => {
    const imported = parsed('7203');
    expect(imported.totalLiabilities).toEqual({
      valueSen: 6_450_226_300_000_000,
      fiscalYear: 2026,
    });
    expect(imported.previousDividendTotal).toBeNull();
    // 全年 "-" は正常な欠損。診断は出さない
    expect(imported.diagnostics.filter((entry) => entry.column === '剰余金の配当')).toEqual([]);
  });

  it('8306: 負債総額は桁あふれで null（unsafe-integer の診断つき）、配当総額だけ埋まる', () => {
    const imported = parsed('8306');
    expect(imported.totalLiabilities).toBeNull();
    expect(imported.previousDividendTotal).toEqual({
      valueSen: 84_891_500_000_000,
      fiscalYear: 2026,
    });
    // 実績5年すべてが桁あふれるので件数は1件ではない
    const overflows = imported.diagnostics.filter(
      (entry) => entry.block === '財務' && entry.reason === 'unsafe-integer',
    );
    expect(overflows.length).toBeGreaterThanOrEqual(1);
  });

  it.each(CODES)('%s の ⑥ 入力は銭の安全整数（判定不能なら null）', (code) => {
    const imported = parsed(code);
    for (const amount of [imported.totalLiabilities, imported.previousDividendTotal]) {
      if (amount === null) continue;
      expect(Number.isSafeInteger(amount.valueSen)).toBe(true);
      expect(amount.valueSen).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(amount.fiscalYear)).toBe(true);
    }
  });
});

// --- エラー（§5.1） --------------------------------------------------------

describe('§5.1 取り込みが成立しない場合', () => {
  it('要求した銘柄コードと meta.code が違えば code-mismatch', () => {
    const result = parseFyData(fixture('9433'), '7203');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({ kind: 'code-mismatch', expected: '7203', actual: '9433' });
  });

  it('ルートがオブジェクトでなければ unexpected-shape', () => {
    const result = parseFyData([], '9433');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('unexpected-shape');
  });

  it('meta.code が無ければ unexpected-shape', () => {
    const result = parseFyData({ 業績: {} }, '9433');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('unexpected-shape');
  });

  it('使える年度が1件も無ければ no-usable-year', () => {
    const result = parseDocument({});
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('no-usable-year');
  });

  it('例外を投げない。失敗は Result で返す', () => {
    expect(() => parseFyData(null, '9433')).not.toThrow();
    expect(() => parseFyData({ 業績: { meta: { code: '9433' } } }, '9433')).not.toThrow();
  });
});
