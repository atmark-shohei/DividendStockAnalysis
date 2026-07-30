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

function balanceRow(bps: unknown): unknown[] {
  return ['-', '-', '-', '-', '-', '-', bps, '-'];
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

function dividendRow(perShare: unknown): unknown[] {
  return [perShare, '-', '-', '-', '-', '-'];
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
      for (const value of [entry.epsSen, entry.revenueSen, entry.dividendPerShareSen]) {
        if (value !== null) expect(Number.isSafeInteger(value)).toBe(true);
      }
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
    expect(forecast.dividendPerShareSen).toBe(8400);
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

  it('総資産（銭にすると安全整数を超える）は読まないので診断も出ない', () => {
    expect(imported.diagnostics.filter((entry) => entry.reason === 'unsafe-integer')).toEqual([]);
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
    expect(forecast.dividendPerShareSen).toBe(16000); // 160
  });
});

// --- 値の型の揺れ（§3.1） --------------------------------------------------

describe('§3.1 同じ列で number / 数値文字列 / "-" が混在する', () => {
  it('数値文字列と number が同じ銭になる', () => {
    const result = parseDocument({
      dividend: {
        '2025/03': dividendRow('67.5'),
        '2026/03': dividendRow(67.5),
      },
    });
    if (!result.ok) throw new Error('取り込みに失敗した');
    expect(result.value.records.map((entry) => entry.dividendPerShareSen)).toEqual([6750, 6750]);
  });

  it('"-" は null。**無配 0 円とは別物**', () => {
    const result = parseDocument({
      dividend: {
        '2025/03': dividendRow('-'),
        '2026/03': dividendRow(0),
      },
    });
    if (!result.ok) throw new Error('取り込みに失敗した');
    expect(result.value.records.map((entry) => entry.dividendPerShareSen)).toEqual([null, 0]);
  });

  it('読めない文字列は null にして診断に残す（捨てない）', () => {
    const result = parseDocument({ dividend: { '2026/03': dividendRow('N/A') } });
    if (!result.ok) throw new Error('取り込みに失敗した');
    expect(result.value.records[0]?.dividendPerShareSen).toBeNull();
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
    const result = parseDocument({ dividend: { '2026/03': dividendRow('1.005') } });
    if (!result.ok) throw new Error('取り込みに失敗した');
    expect(result.value.records[0]?.dividendPerShareSen).toBe(101);
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
    const result = parseDocument({ dividend: { '2026/03': dividendRow(100) } });
    if (!result.ok) throw new Error('取り込みに失敗した');
    expect(result.value.records[0]?.fiscalYear).toBe(2026);
  });

  it('同じ年度が2行あったら**両方**落として記録する（後勝ちにしない）', () => {
    const result = parseDocument({
      dividend: {
        '2026/03': dividendRow(100),
        '2026/12': dividendRow(200),
        '2025/03': dividendRow(50),
      },
    });
    if (!result.ok) throw new Error('取り込みに失敗した');
    expect(result.value.records.map((entry) => entry.fiscalYear)).toEqual([2025]);
    expect(result.value.diagnostics.map((entry) => entry.reason)).toContain('duplicate-year');
  });

  it('年度キーの形式が違う行は落として記録する', () => {
    const result = parseDocument({
      dividend: { 通期: dividendRow(100), '2026/03': dividendRow(80) },
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
    expect(result.value.records[0]?.dividendPerShareSen).toBe(8400);
  });

  it('配列の行は実績', () => {
    const result = parseDocument({ dividend: { '2026/03': dividendRow(80) } });
    if (!result.ok) throw new Error('取り込みに失敗した');
    expect(result.value.dividends[0]?.kind).toBe('actual');
  });

  it('備考が「予想」以外なら、その年度を採用せず記録する', () => {
    const result = parseDocument({
      dividend: {
        '2026/03': { 0: 80, 備考: '変則決算' },
        '2025/03': dividendRow(70),
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
      balance: { '2023/03': balanceRow(1000), '2024/03': balanceRow(2000) },
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
      dividend: { '2027/03': dividendRow(50) },
    });
    if (!result.ok) throw new Error('取り込みに失敗した');
    expect(result.value.records.map((entry) => entry.fiscalYear)).toEqual([2026, 2027]);
    expect(recordOf(result.value, 2027).epsSen).toBeNull();
    expect(recordOf(result.value, 2027).dividendPerShareSen).toBe(5000);
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
      jumpsOf({ dividend: { '2025/03': dividendRow(100), '2026/03': dividendRow(181) } }),
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
      jumpsOf({ dividend: { '2025/03': dividendRow(100), '2026/03': dividendRow(19) } }),
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
      jumpsOf({ dividend: { '2025/03': dividendRow(100), '2026/03': dividendRow(180) } }),
    ).toEqual([]);
    expect(
      jumpsOf({ dividend: { '2025/03': dividendRow(100), '2026/03': dividendRow(20) } }),
    ).toEqual([]);
  });

  it('境界をわずかに超えたら記録する', () => {
    expect(
      jumpsOf({ dividend: { '2025/03': dividendRow(1000), '2026/03': dividendRow(1800.01) } }),
    ).toHaveLength(1);
  });

  it('前年が "-"（データなし）なら比較できないので記録しない', () => {
    expect(
      jumpsOf({ dividend: { '2025/03': dividendRow('-'), '2026/03': dividendRow(200) } }),
    ).toEqual([]);
  });

  it('前年が 0（無配）ならゼロ除算になるので記録しない', () => {
    expect(
      jumpsOf({ dividend: { '2025/03': dividendRow(0), '2026/03': dividendRow(200) } }),
    ).toEqual([]);
  });

  it('記録しても値は採用したまま。null にしない', () => {
    const result = parseDocument({
      dividend: { '2025/03': dividendRow(100), '2026/03': dividendRow(181) },
      performance: {
        '2025/03': performanceRow({ eps: 100 }),
        '2026/03': performanceRow({ eps: 181 }),
      },
    });
    if (!result.ok) throw new Error('取り込みに失敗した');
    expect(result.value.records.map((entry) => entry.dividendPerShareSen)).toEqual([10000, 18100]);
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
