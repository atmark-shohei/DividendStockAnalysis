import { describe, expect, it } from 'vitest';

import {
  cellWarningText,
  confirmWarningsText,
  dropEditedWarnings,
  fillBlankMultiples,
  hasUnconfirmedWarnings,
  mergeRowsWithImport,
  rowlessWarningText,
  rowlessWarnings,
  shouldShowConfirmation,
  toYearRow,
  warningsForCell,
} from '../../frontend/components/CompanyForm';

/**
 * 入力フォームのうち、React の state を持たない部分。
 * 仕様: `docs/02_design/logic/irbank-json-import.md` §7.2（手動確認しかなかった2項目）
 *
 * ⚠️ **拡張子が `.tsx` なのは意図的。** ルートの `tsconfig.json` は Worker 側の設定で
 * jsx も DOM の lib も持たないため、その対象（`tests` 配下の `.ts`）から
 * `.tsx` を import すると型チェックが落ちる（TS6142）。このファイルだけは
 * `tsconfig.frontend.json` 側で型チェックする。
 * `@testing-library/react` は導入していないので JSX は書かない。
 */

const THIS_YEAR = new Date().getFullYear();

type ImportedRecord = Parameters<typeof mergeRowsWithImport>[1][number];
type ImportedDividend = Parameters<typeof mergeRowsWithImport>[2][number];
type YearRow = Parameters<typeof mergeRowsWithImport>[0][number];

function actual(fiscalYear: number, values: Partial<ImportedRecord> = {}): ImportedRecord {
  return {
    fiscalYear,
    isForecast: false,
    epsSen: null,
    roePercent: null,
    revenueSen: null,
    operatingMarginPercent: null,
    ...values,
  };
}

/** 1株配当は `records` ではなく `dividends` から来る（ADR-0009） */
function dividend(fiscalYear: number, annualAmountSen: number | null): ImportedDividend {
  return { fiscalYear, annualAmountSen };
}

function row(fiscalYear: number, values: Partial<YearRow> = {}): YearRow {
  return {
    fiscalYear: String(fiscalYear),
    isForecast: false,
    epsYen: '',
    roePercent: '',
    revenueYen: '',
    operatingMarginPercent: '',
    dividendYen: '',
    ...values,
  };
}

/** 画面の初期状態。予想1行＋実績6行の空行 */
function defaultRows(): YearRow[] {
  return [
    row(THIS_YEAR + 1, { isForecast: true }),
    ...Array.from({ length: 6 }, (_, index) => row(THIS_YEAR - index)),
  ];
}

function recentActuals(): ImportedRecord[] {
  return Array.from({ length: 6 }, (_, index) => actual(THIS_YEAR - index, { epsSen: 10000 }));
}

describe('toYearRow', () => {
  it('銭を編集できるテキストにする', () => {
    const row = toYearRow(
      actual(2026, {
        epsSen: 18359,
        roePercent: 13.93,
        revenueSen: 607_191_500_000_000,
        operatingMarginPercent: 18.101785021694145,
      }),
      8000,
    );
    expect(row).toEqual({
      fiscalYear: '2026',
      isForecast: false,
      epsYen: '183.59',
      roePercent: '13.93',
      revenueYen: '6071915000000',
      // 除算由来の値は編集欄で小数第2位に丸める
      operatingMarginPercent: '18.1',
      dividendYen: '80',
    });
  });

  it('データなしは空欄。0 にしない（無配 0 円と区別する）', () => {
    const row = toYearRow(actual(2025), null);
    expect(row.epsYen).toBe('');
    expect(row.dividendYen).toBe('');
    expect(toYearRow(actual(2025), 0).dividendYen).toBe('0');
  });
});

/**
 * 仕様: `docs/02_design/logic/import-review.md` §5.5 / 受入基準 §7.3。
 * ①②④⑦ は取り込みで構造的に埋まらないので、この機能は手入力との併用が前提。
 * 取り込みが手入力を消してはいけない（同設計書 §2.2）。
 */
describe('mergeRowsWithImport', () => {
  it('取り込みに無い年度の行は手入力のまま残る（§2.2 の回帰テスト）', () => {
    const result = mergeRowsWithImport(
      [row(2019, { epsYen: '100' })],
      [actual(2020, { epsSen: 5000 })],
      [],
    );

    expect(result.rows.map((merged) => [merged.fiscalYear, merged.epsYen])).toEqual([
      ['2020', '50'],
      ['2019', '100'],
    ]);
  });

  it('取り込みが null のセルは手入力を残し、値があるセルだけ入れる', () => {
    const result = mergeRowsWithImport(
      [row(2019, { epsYen: '100' })],
      [actual(2019, { revenueSen: 50_000 })],
      [],
    );

    expect(result.rows[0]?.epsYen).toBe('100');
    expect(result.rows[0]?.revenueYen).toBe('500');
    expect(result.overwrittenCount).toBe(0);
  });

  it('取り込みが値を持つセルは上書きし、上書き件数を返す', () => {
    const result = mergeRowsWithImport(
      [row(2019, { epsYen: '100' })],
      [actual(2019, { epsSen: 12000 })],
      [],
    );

    expect(result.rows[0]?.epsYen).toBe('120');
    expect(result.overwrittenCount).toBe(1);
  });

  it('「年度を追加」で足した古い行は取り込み後も残る', () => {
    const result = mergeRowsWithImport(
      [...defaultRows(), row(2018, { dividendYen: '50' })],
      recentActuals(),
      [],
    );

    expect(result.rows.at(-1)).toEqual(row(2018, { dividendYen: '50' }));
  });

  it('同じ年度の行を2つ作らない', () => {
    const result = mergeRowsWithImport(
      defaultRows(),
      [
        { ...actual(THIS_YEAR + 1), isForecast: true },
        actual(THIS_YEAR, { epsSen: 18359 }),
        actual(THIS_YEAR - 6, { epsSen: 12000 }),
      ],
      [dividend(THIS_YEAR + 1, 8400)],
    );

    const years = result.rows.map((merged) => merged.fiscalYear);
    expect(new Set(years).size).toBe(years.length);
  });

  it('先頭が予想行、以降は実績年度の降順', () => {
    const result = mergeRowsWithImport(
      [row(THIS_YEAR - 1), row(THIS_YEAR + 1, { isForecast: true })],
      [actual(THIS_YEAR), actual(THIS_YEAR - 6)],
      [],
    );

    expect(result.rows[0]?.isForecast).toBe(true);
    expect(result.rows[0]?.fiscalYear).toBe(String(THIS_YEAR + 1));
    expect(result.rows.slice(1).map((merged) => merged.fiscalYear)).toEqual(
      [THIS_YEAR, THIS_YEAR - 1, THIS_YEAR - 6].map(String),
    );
  });

  it('2回続けて取り込んでも1回目と同じ結果になる（冪等）', () => {
    const records = [{ ...actual(THIS_YEAR + 1), isForecast: true }, ...recentActuals()];
    const dividends = [dividend(THIS_YEAR + 1, 8400)];

    const first = mergeRowsWithImport(defaultRows(), records, dividends);
    const second = mergeRowsWithImport(first.rows, records, dividends);

    expect(second.rows).toEqual(first.rows);
    expect(second.overwrittenCount).toBe(0);
  });

  it('既存が空行だけなら取り込んだ6年ぶんが入り、上書きは 0 件', () => {
    const result = mergeRowsWithImport(defaultRows(), recentActuals(), []);

    expect(result.rows).toHaveLength(7);
    expect(result.rows.filter((merged) => merged.epsYen === '100')).toHaveLength(6);
    expect(result.overwrittenCount).toBe(0);
  });

  it('予想の取り込み値は予想行に入る', () => {
    const result = mergeRowsWithImport(
      defaultRows(),
      [{ ...actual(THIS_YEAR + 1), isForecast: true }],
      [dividend(THIS_YEAR + 1, 8400)],
    );

    expect(result.rows[0]?.isForecast).toBe(true);
    expect(result.rows[0]?.dividendYen).toBe('84');
  });

  it('予想年度が実績として来たら、行を増やさずその行を実績にする（§5.5-5）', () => {
    const result = mergeRowsWithImport(
      defaultRows(),
      [actual(THIS_YEAR + 1, { epsSen: 18359 })],
      [],
    );

    expect(result.rows).toHaveLength(7);
    expect(result.rows[0]?.fiscalYear).toBe(String(THIS_YEAR + 1));
    expect(result.rows[0]?.isForecast).toBe(false);
    expect(result.rows[0]?.epsYen).toBe('183.59');
  });
});

describe('fillBlankMultiples', () => {
  // 9433 の実データ: 株価 1500 円 / EPS 183.59 円 / BPS 1333.5 円（予想EPSなし）
  const importedActualOnly = {
    latestForecastEpsSen: null,
    latestActualEpsSen: 18359,
    latestActualBpsSen: 133350,
  };

  it('株価が入力済みで PER/PBR が空なら算出した値と出所を返す（予想EPSなし→実績EPS）', () => {
    expect(
      fillBlankMultiples({ priceYen: '1500', per: '', pbr: '', ...importedActualOnly }),
    ).toEqual({
      per: '8.17', // 1500 ÷ 183.59
      perSource: 'actual-eps',
      pbr: '1.12', // 1500 ÷ 1333.5
      pbrSource: 'actual-bps',
    });
  });

  it('予想EPSがあれば優先し、出所は forecast-eps', () => {
    const result = fillBlankMultiples({
      priceYen: '1500',
      per: '',
      pbr: '',
      latestForecastEpsSen: 15000, // 150円
      latestActualEpsSen: 18359,
      latestActualBpsSen: null,
    });
    expect(result.per).toBe('10'); // 1500 ÷ 150（実績EPSなら8.17になるので取り違えていないことも確認）
    expect(result.perSource).toBe('forecast-eps');
  });

  it('既に入力済みの PER/PBR は上書きしない。出所も返さない（呼び出し側が state を変えないため）', () => {
    expect(
      fillBlankMultiples({ priceYen: '1500', per: '10', pbr: '2', ...importedActualOnly }),
    ).toEqual({ per: '10', perSource: null, pbr: '2', pbrSource: null });
  });

  it('片方だけ入力済みなら、空いている方だけ埋める', () => {
    const result = fillBlankMultiples({
      priceYen: '1500',
      per: '10',
      pbr: '',
      ...importedActualOnly,
    });
    expect(result.per).toBe('10');
    expect(result.perSource).toBeNull();
    expect(result.pbr).toBe('1.12');
    expect(result.pbrSource).toBe('actual-bps');
  });

  it('株価が空なら何も入らない', () => {
    expect(fillBlankMultiples({ priceYen: '', per: '', pbr: '', ...importedActualOnly })).toEqual({
      per: '',
      perSource: null,
      pbr: '',
      pbrSource: null,
    });
  });

  it('株価が数値として読めなければ現在の値をそのまま返す', () => {
    expect(
      fillBlankMultiples({ priceYen: 'abc', per: '10', pbr: '', ...importedActualOnly }),
    ).toEqual({ per: '10', perSource: null, pbr: '', pbrSource: null });
  });

  it('取り込み前（EPS/BPS が null）なら空のまま', () => {
    expect(
      fillBlankMultiples({
        priceYen: '1500',
        per: '',
        pbr: '',
        latestForecastEpsSen: null,
        latestActualEpsSen: null,
        latestActualBpsSen: null,
      }),
    ).toEqual({ per: '', perSource: null, pbr: '', pbrSource: null });
  });

  it('実績EPSが 0 以下ならゼロ除算・符号反転を避けて空のまま', () => {
    expect(
      fillBlankMultiples({
        priceYen: '1500',
        per: '',
        pbr: '',
        latestForecastEpsSen: null,
        latestActualEpsSen: 0,
        latestActualBpsSen: -100,
      }),
    ).toEqual({ per: '', perSource: null, pbr: '', pbrSource: null });
  });
});

/**
 * セル警告の表示（`docs/02_design/logic/import-review.md` §5.2・§5.3 / 受入基準 §7.4）。
 *
 * 診断を件数に潰していた `summarizeDiagnostics` の置き換え（同 §2.1）。
 * DOM を組み立てるテストは書けない（`@testing-library/react` は未導入）ので、
 * `aria-invalid` と文言を決める純粋関数を直接検証する。
 */
type CellWarning = Parameters<typeof cellWarningText>[0];

function warning(values: Partial<CellWarning> = {}): CellWarning {
  return {
    fiscalYear: 2026,
    fiscalYearKey: '2026/03',
    field: 'epsYen',
    column: 'EPS',
    reason: 'suspicious-jump',
    valueKept: true,
    raw: '1234 -> 2900',
    ...values,
  };
}

describe('warningsForCell', () => {
  it('該当年度・該当欄の警告だけ返す（この有無が aria-invalid になる）', () => {
    const warnings = [warning(), warning({ field: 'dividendYen', column: '一株配当' })];
    expect(warningsForCell(warnings, '2026', 'epsYen')).toEqual([warning()]);
  });

  it('別の年度の行には出さない', () => {
    expect(warningsForCell([warning()], '2025', 'epsYen')).toEqual([]);
  });

  it('同じ年度・同じ欄に2件あれば2件返す（1件に潰さない）', () => {
    const warnings = [warning({ reason: 'rounded', raw: '150.005' }), warning()];
    expect(warningsForCell(warnings, '2026', 'epsYen')).toHaveLength(2);
  });

  it('行に紐づかない警告（field が null）はセルに出さない', () => {
    expect(
      warningsForCell([warning({ field: null, column: '営業利益' })], '2026', 'epsYen'),
    ).toEqual([]);
  });
});

describe('cellWarningText', () => {
  it('⚠記号と理由の文言を必ず添える（色クラスだけにしない）', () => {
    const text = cellWarningText(warning());
    expect(text).toContain('⚠');
    expect(text).toContain('前年からの変化が大きすぎます');
  });

  it('値を採用した警告は「採用している」と伝える（データなし扱いにしない）', () => {
    const text = cellWarningText(warning({ reason: 'rounded', valueKept: true }));
    expect(text).toContain('値は採用しています');
    expect(text).not.toContain('空欄');
  });

  it('値が落ちた警告は空欄にしたことと手入力を促す', () => {
    const text = cellWarningText(
      warning({ reason: 'unparsable-value', valueKept: false, raw: 'N/A' }),
    );
    expect(text).toContain('数値として読めない値でした');
    expect(text).toContain('空欄');
    expect(text).toContain('手入力');
  });
});

describe('dropEditedWarnings', () => {
  it('編集したセルの警告は消える（値を直した時点で用済み）', () => {
    expect(dropEditedWarnings([warning()], '2026', { epsYen: '200' })).toEqual([]);
  });

  it('同じ行の別の欄を編集しても消えない', () => {
    expect(dropEditedWarnings([warning()], '2026', { dividendYen: '80' })).toHaveLength(1);
  });

  it('別の年度の行を編集しても消えない', () => {
    expect(dropEditedWarnings([warning()], '2025', { epsYen: '200' })).toHaveLength(1);
  });

  it('行に紐づかない警告は残る（対応するセルが無いので編集で解決しない）', () => {
    const rowless = warning({ field: null, column: '年度', reason: 'duplicate-year' });
    expect(dropEditedWarnings([rowless], '2026', { epsYen: '200' })).toEqual([rowless]);
  });

  it('決算年度欄自体を編集したら、その行の警告を全部落とす（field の一致では拾えないため）', () => {
    const warnings = [warning({ field: 'epsYen' }), warning({ field: 'dividendYen' })];
    expect(dropEditedWarnings(warnings, '2026', { fiscalYear: '2025' })).toEqual([]);
  });
});

describe('rowlessWarnings / rowlessWarningText', () => {
  it('field が null の警告だけを表の外へ出す', () => {
    const rowless = warning({ field: null, column: 'BPS' });
    expect(rowlessWarnings([warning(), rowless])).toEqual([rowless]);
  });

  it('件数に潰さず、年度と理由を1件ずつ出す', () => {
    const texts = rowlessWarnings([
      warning({
        field: null,
        fiscalYear: 2024,
        fiscalYearKey: '2024/03',
        column: '年度',
        reason: 'duplicate-year',
        valueKept: false,
      }),
      warning({
        field: null,
        fiscalYear: 2023,
        fiscalYearKey: '2023/03',
        column: '営業利益',
        reason: 'unparsable-value',
        valueKept: false,
      }),
    ]).map(rowlessWarningText);

    expect(texts).toHaveLength(2);
    expect(texts[0]).toContain('2024年度（2024/03）');
    expect(texts[0]).toContain('同じ決算年度が重複していました');
    expect(texts[1]).toContain('2023年度（2023/03）');
    expect(texts[1]).toContain('営業利益');
    for (const text of texts) expect(text).toContain('⚠');
  });

  it('行ごと落ちた警告は手入力を促す', () => {
    const text = rowlessWarningText(
      warning({ field: null, column: '年度', reason: 'year-out-of-range', valueKept: false }),
    );
    expect(text).toContain('行は取り込めませんでした');
    expect(text).toContain('手入力');
  });

  it('年度に解決できないキーはキー文字列のまま出す', () => {
    const text = rowlessWarningText(
      warning({
        field: null,
        fiscalYear: null,
        fiscalYearKey: '20XX/03',
        column: '年度',
        reason: 'year-out-of-range',
        valueKept: false,
      }),
    );
    expect(text).toContain('20XX/03');
  });
});

/**
 * 保存前の確認（`docs/02_design/logic/import-review.md` §5.6 / 受入基準 §7.4）。
 * `valueKept: true` の警告が残ったまま保存すると、株式分割の反映漏れを黙って
 * 取り込むことになる。送信を1回止めて人に確かめる。
 */
describe('hasUnconfirmedWarnings', () => {
  it('警告が無ければ確認は要らない（既存の挙動を変えない）', () => {
    expect(hasUnconfirmedWarnings([])).toBe(false);
  });

  it('値が落ちた警告だけなら確認は要らない（採用していないので確かめる値が無い）', () => {
    expect(
      hasUnconfirmedWarnings([warning({ reason: 'unparsable-value', valueKept: false })]),
    ).toBe(false);
  });

  it('値を採用したままの警告があれば確認が要る', () => {
    expect(hasUnconfirmedWarnings([warning({ valueKept: true })])).toBe(true);
  });

  it('1件でも採用したままなら確認が要る', () => {
    const warnings = [
      warning({ reason: 'unparsable-value', valueKept: false }),
      warning({ valueKept: true }),
    ];
    expect(hasUnconfirmedWarnings(warnings)).toBe(true);
  });
});

/**
 * 確認を挟むかの判定。**ペイロードを運ばない**ことが要点
 * （旧 `gateSubmit` はスナップショットを運んでいて、確認バナー表示中にセルを直すと
 * 修正前の値が保存されるバグがあった。code-reviewer 指摘、2026-07-30）。
 *
 * ⚠️ **「確認中に直した値が送信される」経路はここではテストできない。** DOM を
 * 組み立てるテストが書けない（`@testing-library/react` 未導入）ため。この経路は
 * 「スナップショットを一切持たず、`handleSubmit` が呼ばれるたびに最新の state から
 * ペイロードを組み立て直す」という構造そのものが保証している。`shouldShowConfirmation`
 * にペイロードを渡す引数が無いことが、その構造の機械的な裏付けになる。
 */
describe('shouldShowConfirmation', () => {
  it('診断が0件なら確認は入らない', () => {
    expect(shouldShowConfirmation([], false)).toBe(false);
  });

  it('値を採用したままの警告があれば1回目は確認が必要', () => {
    expect(shouldShowConfirmation([warning({ valueKept: true })], false)).toBe(true);
  });

  it('同じ警告でも確認済みなら通す（「確認した」を経た2回目の呼び出し）', () => {
    expect(shouldShowConfirmation([warning({ valueKept: true })], true)).toBe(false);
  });

  it('警告が無ければ確認済みかどうかに関わらず通す', () => {
    expect(shouldShowConfirmation([], true)).toBe(false);
  });
});

describe('confirmWarningsText', () => {
  it('⚠記号と件数を添える（色クラスだけにしない）', () => {
    const text = confirmWarningsText([
      warning({ valueKept: true }),
      warning({ reason: 'rounded', valueKept: true }),
      warning({ reason: 'unparsable-value', valueKept: false }),
    ]);
    expect(text).toContain('⚠');
    expect(text).toContain('2 件');
  });
});
