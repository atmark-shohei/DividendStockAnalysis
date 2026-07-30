import { describe, expect, it } from 'vitest';

import { type ImportDiagnostic } from '@/domain/company/financial-source';
import { resolveCellWarnings } from '@/domain/company/import-review';

/**
 * 取り込み診断を画面のセルに解決する。
 * 仕様: docs/02_design/logic/import-review.md §3.2 / 受入基準 §7.1
 */

function diagnostic(values: Partial<ImportDiagnostic> = {}): ImportDiagnostic {
  return {
    block: '業績',
    fiscalYearKey: '2026/03',
    column: 'EPS',
    reason: 'unparsable-value',
    raw: 'N/A',
    ...values,
  };
}

describe('セルへの解決', () => {
  it('業績 / 2026/03 / EPS / suspicious-jump は EPS 欄の警告になり、値は採用済み', () => {
    const warnings = resolveCellWarnings([
      diagnostic({ column: 'EPS', reason: 'suspicious-jump', raw: '1234 -> 2900' }),
    ]);

    expect(warnings).toEqual([
      {
        fiscalYear: 2026,
        fiscalYearKey: '2026/03',
        field: 'epsYen',
        column: 'EPS',
        reason: 'suspicious-jump',
        valueKept: true,
        raw: '1234 -> 2900',
      },
    ]);
  });

  it('配当 / 一株配当 / unparsable-value は1株配当欄の警告になり、値は落ちている', () => {
    const warnings = resolveCellWarnings([
      diagnostic({ block: '配当', fiscalYearKey: '2025/03', column: '一株配当' }),
    ]);

    expect(warnings[0]?.field).toBe('dividendYen');
    expect(warnings[0]?.fiscalYear).toBe(2025);
    expect(warnings[0]?.valueKept).toBe(false);
  });

  it('ROE と売上高もそれぞれの欄に対応する', () => {
    expect(resolveCellWarnings([diagnostic({ column: 'ROE' })])[0]?.field).toBe('roePercent');
    expect(resolveCellWarnings([diagnostic({ column: '売上高' })])[0]?.field).toBe('revenueYen');
  });
});

describe('セルに紐づかない診断', () => {
  it('業績 / 営業利益 は画面に列が無いので field は null（営業利益率は派生値）', () => {
    const warnings = resolveCellWarnings([
      diagnostic({ fiscalYearKey: '2024/03', column: '営業利益' }),
    ]);

    expect(warnings[0]?.field).toBeNull();
    // 何が読めなかったかを行外で伝えるため、列名は捨てない（§5.3）
    expect(warnings[0]?.column).toBe('営業利益');
  });

  it('財務 / BPS は画面に欄が無いので field は null', () => {
    const warnings = resolveCellWarnings([
      diagnostic({ block: '財務', fiscalYearKey: '2024/03', column: 'BPS' }),
    ]);

    expect(warnings[0]?.field).toBeNull();
  });

  it('duplicate-year は行ごと落ちているので field は null、値も採用しない', () => {
    const warnings = resolveCellWarnings([
      diagnostic({ column: '年度', reason: 'duplicate-year', raw: '2026/03' }),
    ]);

    expect(warnings[0]?.field).toBeNull();
    expect(warnings[0]?.valueKept).toBe(false);
  });
});

describe('valueKept', () => {
  it('rounded は値を採用したまま記録しただけ。データなし扱いにしない', () => {
    expect(resolveCellWarnings([diagnostic({ reason: 'rounded' })])[0]?.valueKept).toBe(true);
  });

  it.each([
    ['unparsable-value' as const],
    ['unsafe-integer' as const],
    ['year-out-of-range' as const],
    ['duplicate-year' as const],
    ['unknown-note' as const],
  ])('%s は値が落ちている', (reason) => {
    expect(resolveCellWarnings([diagnostic({ reason })])[0]?.valueKept).toBe(false);
  });
});

describe('決算年度の解決', () => {
  it('12月期（2026/12）も 2026 年度になる', () => {
    expect(resolveCellWarnings([diagnostic({ fiscalYearKey: '2026/12' })])[0]?.fiscalYear).toBe(
      2026,
    );
  });

  it('年度に解決できないキーは fiscalYear を null にし、キー文字列を残す', () => {
    const warnings = resolveCellWarnings([
      diagnostic({ fiscalYearKey: '20XX/03', column: '年度', reason: 'year-out-of-range' }),
    ]);

    expect(warnings[0]?.fiscalYear).toBeNull();
    expect(warnings[0]?.fiscalYearKey).toBe('20XX/03');
  });
});

describe('件数に潰さない', () => {
  it('同じ年度・同じ列の rounded と suspicious-jump は2件とも返る', () => {
    const warnings = resolveCellWarnings([
      diagnostic({ reason: 'rounded', raw: '150.005' }),
      diagnostic({ reason: 'suspicious-jump', raw: '1234 -> 2900' }),
    ]);

    expect(warnings).toHaveLength(2);
    expect(warnings.map((warning) => warning.reason)).toEqual(['rounded', 'suspicious-jump']);
  });

  it('診断が無ければ空配列（null ではない）', () => {
    expect(resolveCellWarnings([])).toEqual([]);
  });
});
