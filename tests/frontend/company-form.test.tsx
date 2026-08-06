import { describe, expect, it } from 'vitest';

import {
  cellWarningText,
  confirmWarningsText,
  dropEditedWarnings,
  fillBlankMultiples,
  hasUnconfirmedWarnings,
  importedAmountNoteText,
  marketDiagnosticText,
  mergeDividendYears,
  mergeRowsWithImport,
  resolveEditedAmountNote,
  resolveImportedAmount,
  resolveImportedPriceYen,
  rowlessWarningText,
  rowlessWarnings,
  shouldShowConfirmation,
  splitEventText,
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

/**
 * Yahoo由来の年度別配当のマージ（`docs/02_design/ui/pages/market-data-import.md` §5.2・§7）。
 *
 * `mergeRowsWithImport` と違い、業績データを伴わない年度の配当も新規行として追加できる。
 * `null`（判定不能）と `0`（無配）を混同しない検証が本テストの核心
 * （`.claude/rules/frontend.md`「データなしを0と表示しない」）。
 */
type MarketDividendYear = Parameters<typeof mergeDividendYears>[1][number];

function marketDividend(fiscalYear: number, annualAmountSen: number | null): MarketDividendYear {
  return { fiscalYear, annualAmountSen };
}

describe('mergeDividendYears', () => {
  it('既存行と同じ年度・既存が空欄なら値が入り overwrittenCount は 0 のまま', () => {
    const result = mergeDividendYears(
      [row(2025, { dividendYen: '' })],
      [marketDividend(2025, 5000)],
    );

    expect(result.rows[0]?.dividendYen).toBe('50');
    expect(result.overwrittenCount).toBe(0);
  });

  it('既存の手入力を上書きし overwrittenCount が1増える', () => {
    const result = mergeDividendYears(
      [row(2025, { dividendYen: '100' })],
      [marketDividend(2025, 5000)],
    );

    expect(result.rows[0]?.dividendYen).toBe('50');
    expect(result.overwrittenCount).toBe(1);
  });

  it('業績データの無い古い年度は業績欄が空のまま新規行として追加される', () => {
    const result = mergeDividendYears([row(2025)], [marketDividend(2000, 3000)]);

    expect(result.rows.map((merged) => merged.fiscalYear)).toContain('2000');
    expect(result.rows.find((merged) => merged.fiscalYear === '2000')).toEqual(
      row(2000, { dividendYen: '30' }),
    );
  });

  it('annualAmountSen: null（判定不能）は空文字。0にしない', () => {
    const result = mergeDividendYears([], [marketDividend(2010, null)]);

    expect(result.rows[0]?.dividendYen).toBe('');
  });

  it('annualAmountSen: 0（無配）は "0"。空文字にしない（null と 0 の区別が本テストの核心）', () => {
    const result = mergeDividendYears([], [marketDividend(2010, 0)]);

    expect(result.rows[0]?.dividendYen).toBe('0');
  });

  it('配当が0件なら既存行は変化せず overwrittenCount は 0', () => {
    const existing = [row(2025, { dividendYen: '100' })];
    const result = mergeDividendYears(existing, []);

    expect(result.rows).toEqual(existing);
    expect(result.overwrittenCount).toBe(0);
  });

  it('判定不能（null）は既存の手入力を消さない（手入力を破壊しないという既存方針の回帰）', () => {
    const result = mergeDividendYears(
      [row(2025, { dividendYen: '100' })],
      [marketDividend(2025, null)],
    );

    expect(result.rows[0]?.dividendYen).toBe('100');
    expect(result.overwrittenCount).toBe(0);
  });

  it('同じ年度の行を2つ作らない', () => {
    const result = mergeDividendYears(
      [row(2025, { dividendYen: '100' })],
      [marketDividend(2025, 5000)],
    );

    const years = result.rows.map((merged) => merged.fiscalYear);
    expect(new Set(years).size).toBe(years.length);
  });
});

/**
 * 株式分割・併合イベントの表示（同設計書 §5.3）。参考情報であることを文言側で示す。
 */
describe('splitEventText', () => {
  it('numerator > denominator は分割', () => {
    expect(splitEventText({ date: '2025-03-28', numerator: 100, denominator: 1 })).toBe(
      '2025-03-28: 100株 / 1株（分割）',
    );
  });

  it('numerator < denominator は併合', () => {
    expect(splitEventText({ date: '2024-01-10', numerator: 1, denominator: 10 })).toBe(
      '2024-01-10: 1株 / 10株（併合）',
    );
  });

  it('numerator === denominator は変化なし', () => {
    expect(splitEventText({ date: '2025-06-01', numerator: 1, denominator: 1 })).toBe(
      '2025-06-01: 1株 / 1株（変化なし）',
    );
  });
});

/**
 * 市場データ取り込みの診断表示（同設計書 §5.5）。IRバンクと同じ「1件ずつ列挙」パターン
 * （`rowlessWarningText` 参照）を、`CellWarning` を持たない `ImportDiagnostic` に適用する。
 */
describe('marketDiagnosticText', () => {
  it('⚠記号と理由の文言・元の値を必ず添える（色だけで表現しない）', () => {
    const text = marketDiagnosticText({
      block: '配当',
      fiscalYearKey: '2026/03',
      column: '一株配当',
      reason: 'rounded',
      raw: '0.745833',
    });

    expect(text).toContain('⚠');
    expect(text).toContain('小数第3位以下を丸めました');
    expect(text).toContain('0.745833');
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
 * `resolveImportedPriceYen`: 取り込んだ株価を株価欄へ反映するかどうかの判定
 * （`docs/02_design/ui/pages/market-data-import.md` §5.1）。
 *
 * `handleMarketDataImport` は `await` 完了後に `priceYenRef.current`（ref から読んだ
 * 最新値）をこの関数へ渡す（fe-review-round2.md 指摘#1: 関数型 `setState` の
 * コールバック内代入を直後に読むパターンを ref 経由の読み出しへ置き換えた）。
 * ref の更新自体（`useEffect` 内の1行代入）は React の再レンダーに依存するため
 * 純粋関数として切り出せない。ここではその手前の「空欄かどうかで埋めるか決める」
 * 判定ロジックだけを検証する。
 */
describe('resolveImportedPriceYen', () => {
  it('株価欄が空欄で、取り込んだ株価があれば埋める', () => {
    expect(resolveImportedPriceYen('', 150000)).toBe('1500'); // 150000銭 = 1500円
  });

  it('株価欄が空欄でも、取り込んだ株価が取得できなければ（null）空欄のまま', () => {
    expect(resolveImportedPriceYen('', null)).toBe('');
  });

  it('株価欄に既に手入力があれば、取り込んだ株価があっても上書きしない', () => {
    expect(resolveImportedPriceYen('1234.50', 150000)).toBe('1234.50');
  });

  it('株価欄に既に手入力があり、取り込んだ株価も取得できなければそのまま', () => {
    expect(resolveImportedPriceYen('1234.50', null)).toBe('1234.50');
  });

  it('取り込んだ株価が 0円（境界値）でも空欄なら埋める（null との混同に注意）', () => {
    expect(resolveImportedPriceYen('', 0)).toBe('0');
  });
});

/**
 * ⑥ の入力（負債総額・前期末の配当総額）の取り込み
 * （`docs/02_design/logic/balance-sheet-derivation.md` §2.3・§5.4・§5.5）。
 *
 * フィクスチャの値は同設計書 §6.4 の実測値（9433 / 7203）をそのまま使う。
 * **`null`（取り込めなかった）と `valueSen: 0`（無借金・無配）を分けることが本テストの核心**
 * （`.claude/rules/frontend.md`「データが無い場合に 0 を表示しない」）。
 */
type ImportedAmount = NonNullable<Parameters<typeof resolveImportedAmount>[1]>;

describe('resolveImportedAmount', () => {
  const cases: readonly {
    readonly name: string;
    readonly currentYen: string;
    readonly imported: ImportedAmount | null;
    readonly expectedYen: string;
    readonly expectedNoteKind: string;
  }[] = [
    {
      name: '空欄なら取り込み値を銭→円で入れる（9433 の負債総額）',
      currentYen: '',
      imported: { valueSen: 1_347_067_400_000_000, fiscalYear: 2026 },
      expectedYen: '13470674000000',
      expectedNoteKind: 'filled',
    },
    {
      name: '空欄なら取り込み値を銭→円で入れる（9433 の前期末配当総額）',
      currentYen: '',
      imported: { valueSen: 30_154_700_000_000, fiscalYear: 2026 },
      expectedYen: '301547000000',
      expectedNoteKind: 'filled',
    },
    {
      name: 'valueSen: 0（無借金・無配）は値。"0" を入れる（null 扱いにしない）',
      currentYen: '',
      imported: { valueSen: 0, fiscalYear: 2026 },
      expectedYen: '0',
      expectedNoteKind: 'filled',
    },
    {
      name: '取り込めなかった（null）ら空欄のまま。"0" を書き込まない',
      currentYen: '',
      imported: null,
      expectedYen: '',
      expectedNoteKind: 'unavailable',
    },
    {
      name: '手入力済みなら取り込み値で上書きしない',
      currentYen: '123',
      imported: { valueSen: 456_00, fiscalYear: 2026 },
      expectedYen: '123',
      expectedNoteKind: 'kept-existing',
    },
    {
      name: '取り込めなくても手入力は消さない',
      currentYen: '123',
      imported: null,
      expectedYen: '123',
      expectedNoteKind: 'unavailable',
    },
    {
      name: '端数（1銭）も銭→円で入る',
      currentYen: '',
      imported: { valueSen: 1, fiscalYear: 2025 },
      expectedYen: '0.01',
      expectedNoteKind: 'filled',
    },
    {
      name: '手入力の "0" は「入力済み」。空欄と混同しない',
      currentYen: '0',
      imported: { valueSen: 500_00, fiscalYear: 2026 },
      expectedYen: '0',
      expectedNoteKind: 'kept-existing',
    },
  ];

  for (const { name, currentYen, imported, expectedYen, expectedNoteKind } of cases) {
    it(name, () => {
      const result = resolveImportedAmount(currentYen, imported);
      expect(result.yen).toBe(expectedYen);
      expect(result.noteKind).toBe(expectedNoteKind);
      expect(result.imported).toEqual(imported);
    });
  }
});

describe('importedAmountNoteText', () => {
  it('取り込み前（null）は何も出さない', () => {
    expect(importedAmountNoteText(null, 3)).toBe('');
  });

  it('埋めたときは採用した決算年度を出す（年度ずれを人が判断するため）', () => {
    const result = resolveImportedAmount('', { valueSen: 1_347_067_400_000_000, fiscalYear: 2026 });
    expect(importedAmountNoteText(result, 3)).toBe('IRバンク取り込み: 2026年3月期の値を入れました');
  });

  it('決算月が不明でも年度は出す', () => {
    const result = resolveImportedAmount('', { valueSen: 30_154_700_000_000, fiscalYear: 2026 });
    expect(importedAmountNoteText(result, null)).toBe('IRバンク取り込み: 2026年度の値を入れました');
  });

  it('入力済みで入れ替えなかったときは年度と金額を併記する（3桁区切り＋単位）', () => {
    // 7203 の負債総額（64.5兆円）。入力欄に出ていない値なので注記に出す
    const result = resolveImportedAmount('123', {
      valueSen: 6_450_226_300_000_000,
      fiscalYear: 2026,
    });
    const text = importedAmountNoteText(result, 3);
    expect(text).toContain('入力済みのため入れ替えていません');
    expect(text).toContain('2026年3月期');
    expect(text).toContain('64,502,263,000,000.00 円');
  });

  it('取り込めなかったときは言葉で明示し、数字を出さない（0 と表示しない）', () => {
    const result = resolveImportedAmount('', null);
    const text = importedAmountNoteText(result, 3);
    expect(text).toContain('取り込めませんでした');
    expect(text).toContain('手入力');
    expect(text).not.toContain('0');
  });

  it('valueSen: 0（無借金・無配）は「入れました」。データなし扱いにしない', () => {
    const result = resolveImportedAmount('', { valueSen: 0, fiscalYear: 2026 });
    const text = importedAmountNoteText(result, 3);
    expect(text).toContain('2026年3月期の値を入れました');
    expect(text).not.toContain('—');
  });
});

/**
 * 取り込み後に欄を手で書き換えたときの注記（fe-review CR-1 の回帰）。
 *
 * 取り込み時点の由来（「IRバンク取り込み: …の値を入れました」）が、表示中の値とは
 * 無関係なまま残り続けるのが元の不具合。注記を state ではなく**現在値からの派生**に
 * したので、値を変える経路が増えても取り残されない。
 *
 * 編集の判定は `note.yen !== currentYen`。**`'0'`（無借金・無配）と `''`（空欄）が
 * 別物として扱われることを必ず固定する**（`.claude/rules/frontend.md`）。
 */
describe('resolveEditedAmountNote', () => {
  const LIABILITIES_9433: ImportedAmount = { valueSen: 1_347_067_400_000_000, fiscalYear: 2026 };
  const DEBT_FREE: ImportedAmount = { valueSen: 0, fiscalYear: 2026 };

  const cases: readonly {
    readonly name: string;
    readonly note: ReturnType<typeof resolveImportedAmount> | null;
    readonly currentYen: string;
    readonly expectedNoteKind: string | null;
  }[] = [
    {
      name: '取り込み前（null）は編集しても何も出ない',
      note: null,
      currentYen: '999',
      expectedNoteKind: null,
    },
    {
      name: 'filled を編集していなければ取り込みの注記のまま',
      note: resolveImportedAmount('', LIABILITIES_9433),
      currentYen: '13470674000000',
      expectedNoteKind: 'filled',
    },
    {
      name: 'filled を別の値に書き換えたら「手入力」へ切り替わる',
      note: resolveImportedAmount('', LIABILITIES_9433),
      currentYen: '13470674000001',
      expectedNoteKind: 'edited',
    },
    {
      name: 'filled を空欄に戻しても「値を入れました」を残さない',
      note: resolveImportedAmount('', LIABILITIES_9433),
      currentYen: '',
      expectedNoteKind: 'edited',
    },
    {
      name: 'valueSen: 0（無借金・無配）の "0" は編集ではない（"" と混同しない）',
      note: resolveImportedAmount('', DEBT_FREE),
      currentYen: '0',
      expectedNoteKind: 'filled',
    },
    {
      name: 'valueSen: 0 の欄を空欄にしたら編集扱いになる（"0" と "" は別物）',
      note: resolveImportedAmount('', DEBT_FREE),
      currentYen: '',
      expectedNoteKind: 'edited',
    },
    {
      name: 'kept-existing を編集していなければそのまま出す',
      note: resolveImportedAmount('123', LIABILITIES_9433),
      currentYen: '123',
      expectedNoteKind: 'kept-existing',
    },
    {
      name: 'kept-existing を編集したら注記を消す（入れ替えなかった説明が成立しない）',
      note: resolveImportedAmount('123', LIABILITIES_9433),
      currentYen: '456',
      expectedNoteKind: null,
    },
    {
      name: 'unavailable を編集していなければそのまま出す',
      note: resolveImportedAmount('', null),
      currentYen: '',
      expectedNoteKind: 'unavailable',
    },
    {
      name: 'unavailable を手入力で埋めたら注記を消す',
      note: resolveImportedAmount('', null),
      currentYen: '789',
      expectedNoteKind: null,
    },
    {
      name: '編集して元の取り込み値に戻したら元の注記へ復帰する',
      note: resolveImportedAmount('', LIABILITIES_9433),
      currentYen: '13470674000000',
      expectedNoteKind: 'filled',
    },
  ];

  for (const { name, note, currentYen, expectedNoteKind } of cases) {
    it(name, () => {
      const resolved = resolveEditedAmountNote(note, currentYen);
      expect(resolved === null ? null : resolved.noteKind).toBe(expectedNoteKind);
    });
  }

  it('edited でも取り込み値は出所として残す（何を上書きしたか追えるようにする）', () => {
    const resolved = resolveEditedAmountNote(resolveImportedAmount('', LIABILITIES_9433), '1');
    expect(resolved?.noteKind).toBe('edited');
    expect(resolved?.imported).toEqual(LIABILITIES_9433);
  });
});

/**
 * 画面に出る文字列レベルでの回帰。**古い文言が残らないことを `not.toContain` で固定する。**
 * `noteKind` だけを見ていると、文言側の分岐漏れ（`edited` を `filled` と同じ文にする等）を
 * 検出できない。
 */
describe('importedAmountNoteText（編集後）', () => {
  const LIABILITIES_9433: ImportedAmount = { valueSen: 1_347_067_400_000_000, fiscalYear: 2026 };

  it('filled を書き換えたら「手入力に変更しました」＋取り込み値になる（「値を入れました」を残さない）', () => {
    const note = resolveEditedAmountNote(
      resolveImportedAmount('', LIABILITIES_9433),
      '13470674000001',
    );
    const text = importedAmountNoteText(note, 3);
    expect(text).toBe('手入力に変更しました（取り込み値: 2026年3月期 / 13,470,674,000,000.00 円）');
    expect(text).not.toContain('値を入れました');
  });

  it('filled を空欄に戻しても「値を入れました」は残らない', () => {
    const note = resolveEditedAmountNote(resolveImportedAmount('', LIABILITIES_9433), '');
    const text = importedAmountNoteText(note, 3);
    expect(text).toContain('手入力に変更しました');
    expect(text).not.toContain('値を入れました');
  });

  it('決算月が不明でも編集後の注記に年度は出す', () => {
    const note = resolveEditedAmountNote(resolveImportedAmount('', LIABILITIES_9433), '1');
    expect(importedAmountNoteText(note, null)).toBe(
      '手入力に変更しました（取り込み値: 2026年度 / 13,470,674,000,000.00 円）',
    );
  });

  it('kept-existing を編集したら何も出さない（入れ替えていません が残らない）', () => {
    const note = resolveEditedAmountNote(resolveImportedAmount('123', LIABILITIES_9433), '456');
    const text = importedAmountNoteText(note, 3);
    expect(text).toBe('');
    expect(text).not.toContain('入れ替えていません');
  });

  it('unavailable を編集したら何も出さない（取り込めませんでした が残らない）', () => {
    const note = resolveEditedAmountNote(resolveImportedAmount('', null), '789');
    const text = importedAmountNoteText(note, 3);
    expect(text).toBe('');
    expect(text).not.toContain('取り込めませんでした');
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

  /**
   * `inconsistent-value`（総資産 < 純資産、配当総額が負）は
   * `unparsable-value`（数値として読めなかった）と別物として言葉にする
   * （`docs/02_design/logic/balance-sheet-derivation.md` §5.1・§9.0）。
   */
  it('恒等式違反は「読めなかった」と混ぜず、成立しない値だったと伝える', () => {
    const text = cellWarningText(
      warning({
        field: null,
        column: '総資産',
        reason: 'inconsistent-value',
        valueKept: false,
        raw: '1000 - 1001',
      }),
    );
    expect(text).toBe(
      '⚠ 他の値と突き合わせると成立しない値でした。この欄は空欄にしました。必要なら手入力してください',
    );
    expect(text).not.toContain('数値として読めない');
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

  /**
   * 負債総額（総資産 − 純資産）の算出失敗は、画面に欄が無い列（`総資産`）の警告として
   * 表の外に出る（`docs/02_design/logic/balance-sheet-derivation.md` §2.2.1）。
   * 件数に潰さず、年度と理由を1件ずつ出す。
   */
  it('恒等式違反（inconsistent-value）は表の外に年度つきで1件出る', () => {
    const inconsistent = warning({
      field: null,
      fiscalYear: 2026,
      fiscalYearKey: '2026/03',
      column: '総資産',
      reason: 'inconsistent-value',
      valueKept: false,
      raw: '1000 - 1001',
    });
    const outside = rowlessWarnings([warning(), inconsistent]);

    expect(outside).toEqual([inconsistent]);
    expect(rowlessWarningText(inconsistent)).toBe(
      '⚠ 2026年度（2026/03）の総資産は取り込めていません: 他の値と突き合わせると成立しない値でした',
    );
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

  it('恒等式違反（inconsistent-value）は値を捨てた系なので確認バナーを出さない', () => {
    expect(
      hasUnconfirmedWarnings([warning({ reason: 'inconsistent-value', valueKept: false })]),
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
