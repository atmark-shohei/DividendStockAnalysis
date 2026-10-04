import { describe, expect, it } from 'vitest';

import {
  INDICATOR_CONSTRAINTS,
  type MetricKey,
} from '../../frontend/pages/indicator-custom-content';
import {
  basisValueErrorText,
  buildSavePayload,
  canSaveIndicatorSettings,
  isSelectionCountLow,
  parseBasisValueInput,
  toggleSelection,
  toHalfWidthNumber,
} from '../../frontend/pages/indicator-custom-logic';

/**
 * 指標カスタマイズ画面（`/indicators`、T-101）の純関数。
 * `docs/02_design/ui/pages/indicator-custom-page.md` §4・§5・§9 が正。
 */

// 10指標のうち検証に使う代表キー（`src/domain/shared/metric-key.ts` の METRIC_KEYS 順）
const ALL_KEYS: readonly MetricKey[] = [
  'dividendGrowthRate',
  'consecutiveYears',
  'payoutRatio',
  'epsCagr',
  'roeAverage',
  'dividendSustainability',
  'revenueCagr',
  'operatingMargin',
  'mixCoefficient',
  'dividendYield',
];

describe('toggleSelection（§5「選択のブロックはトグル操作そのものを no-op にする」）', () => {
  it('選択解除: 5個 -> 4個への試行は no-op（下限）', () => {
    const selected: readonly MetricKey[] = ALL_KEYS.slice(0, 5);
    expect(toggleSelection(selected, selected[0] as MetricKey)).toBe(selected);
  });

  it('選択解除: 6個 -> 5個は許可される', () => {
    const selected: readonly MetricKey[] = ALL_KEYS.slice(0, 6);
    const result = toggleSelection(selected, selected[0] as MetricKey);
    expect(result).toHaveLength(5);
    expect(result).not.toContain(selected[0]);
  });

  it('選択追加: 9個 -> 10個は許可される', () => {
    const selected: readonly MetricKey[] = ALL_KEYS.slice(0, 9);
    const notSelected = ALL_KEYS[9] as MetricKey;
    const result = toggleSelection(selected, notSelected);
    expect(result).toHaveLength(10);
    expect(result).toContain(notSelected);
  });

  it('選択追加: 10個 -> 11個への試行は no-op（上限）', () => {
    const selected: readonly MetricKey[] = ALL_KEYS; // 10個すべて選択済み
    // 選択済みでない架空のキーは存在しないため、既存以外への追加は起こり得ない。
    // ここでは「既に10個」の状態で未選択キーが無い（ALL_KEYSが全指標）ため、
    // 4->5境界と対称に「9個の状態から10個目を追加できる」を上のケースで確認済み。
    // 上限そのものの no-op は、10個選択中に「11個目」を模した架空キーで検証する。
    const result = toggleSelection(selected, 'nonexistent-metric' as MetricKey);
    expect(result).toBe(selected);
  });

  it('選択済みのキーをトグルすると解除される（選択数が6以上のとき）', () => {
    const selected: readonly MetricKey[] = ALL_KEYS.slice(0, 7);
    const result = toggleSelection(selected, 'epsCagr');
    expect(result).toEqual([
      'dividendGrowthRate',
      'consecutiveYears',
      'payoutRatio',
      'roeAverage',
      'dividendSustainability',
      'revenueCagr',
    ]);
  });

  it('未選択のキーをトグルすると追加される（選択数が9以下のとき）', () => {
    const selected: readonly MetricKey[] = ALL_KEYS.slice(0, 4);
    const result = toggleSelection(selected, 'roeAverage');
    expect(result).toEqual([...selected, 'roeAverage']);
  });
});

describe('isSelectionCountLow（§2 カウンタのamber化条件）', () => {
  const cases: readonly (readonly [name: string, count: number, expected: boolean])[] = [
    ['4個は5未満', 4, true],
    ['5個ちょうどは5未満ではない（境界値）', 5, false],
    ['6個は5未満ではない', 6, false],
    ['0個は5未満', 0, true],
  ];

  it.each(cases)('%s', (_name, count, expected) => {
    expect(isSelectionCountLow(count)).toBe(expected);
  });
});

describe('toHalfWidthNumber（全角数字・全角マイナスの正規化）', () => {
  const cases: readonly (readonly [name: string, raw: string, expected: string])[] = [
    ['全角数字を半角化', '１２．５', '12.5'],
    ['全角マイナス（U+2212）を半角ハイフンにする', '－５', '-5'],
    ['前後の空白をtrimする', '  12.5  ', '12.5'],
    ['半角はそのまま', '12.5', '12.5'],
  ];

  it.each(cases)('%s', (_name, raw, expected) => {
    expect(toHalfWidthNumber(raw)).toBe(expected);
  });
});

describe('parseBasisValueInput（`CompanyForm.toRatio` と同じ3値設計）', () => {
  it('空文字は null（未入力）', () => {
    expect(parseBasisValueInput('')).toBeNull();
  });

  it('空白のみは null（trimして空文字扱い）', () => {
    expect(parseBasisValueInput('   ')).toBeNull();
  });

  it('数値として読める文字列は number', () => {
    expect(parseBasisValueInput('12.5')).toBe(12.5);
  });

  it('全角数字も数値として読む', () => {
    expect(parseBasisValueInput('１２．５')).toBe(12.5);
  });

  it('数値として読めない文字列は undefined', () => {
    expect(parseBasisValueInput('abc')).toBeUndefined();
  });
});

describe('basisValueErrorText（§4 追加ガード・§3 範囲）', () => {
  describe('昇順指標（roeAverage: step 0.1・min 0・max 100）', () => {
    const constraint = INDICATOR_CONSTRAINTS.roeAverage;
    if (constraint === null) throw new Error('unreachable: roeAverage has a constraint');

    const cases: readonly (readonly [
      name: string,
      value: number | null | undefined,
      expected: string | null,
    ])[] = [
      ['空文字（null）はエラー', null, '数値を入力してください'],
      ['不正値（undefined）はエラー', undefined, '数値を入力してください'],
      ['0はエラー（§4基準値>0）', 0, '満点となる基準値は 0 より大きい値にしてください'],
      ['負値はエラー（§4基準値>0）', -1, '満点となる基準値は 0 より大きい値にしてください'],
      // 0.01はstep(0.1)の倍数ではないため、CR-2のきざみ検証追加後はエラーになる
      // （下限に最も近い有効値は0.1。0はガード対象、0.01はきざみ違反というのが正しい境界）
      ['0.1は範囲内・stepの倍数でOK（境界値）', 0.1, null],
      ['0.01はstepの倍数でないためエラー（CR-2）', 0.01, '0.1きざみで入力してください'],
      ['ちょうど上限(100)はOK', 100, null],
      ['上限超過(100.1)はエラー', 100.1, '0〜100の範囲で入力してください'],
    ];

    it.each(cases)('%s', (_name, value, expected) => {
      expect(basisValueErrorText(value, constraint)).toBe(expected);
    });
  });

  describe('③予想配当性向（payoutRatio: min -100・max 500）', () => {
    const constraint = INDICATOR_CONSTRAINTS.payoutRatio;
    if (constraint === null) throw new Error('unreachable: payoutRatio has a constraint');

    const cases: readonly (readonly [name: string, value: number, expected: string | null])[] = [
      [
        'min(-100)入力は0以下ガードでエラー',
        -100,
        '満点となる基準値は 0 より大きい値にしてください',
      ],
      ['0はエラー', 0, '満点となる基準値は 0 より大きい値にしてください'],
      ['ちょうど上限(500)はOK', 500, null],
      ['上限超過(501)はエラー', 501, '-100〜500の範囲で入力してください'],
    ];

    it.each(cases)('%s', (_name, value, expected) => {
      expect(basisValueErrorText(value, constraint)).toBe(expected);
    });
  });

  describe('⑥配当維持可能年数（dividendSustainability: min -100・max 100）', () => {
    const constraint = INDICATOR_CONSTRAINTS.dividendSustainability;
    if (constraint === null)
      throw new Error('unreachable: dividendSustainability has a constraint');

    const cases: readonly (readonly [name: string, value: number, expected: string | null])[] = [
      [
        'min(-100)入力は0以下ガードでエラー',
        -100,
        '満点となる基準値は 0 より大きい値にしてください',
      ],
      ['0はエラー', 0, '満点となる基準値は 0 より大きい値にしてください'],
      ['ちょうど上限(100)はOK', 100, null],
      ['上限超過(100.5)はエラー', 100.5, '-100〜100の範囲で入力してください'],
    ];

    it.each(cases)('%s', (_name, value, expected) => {
      expect(basisValueErrorText(value, constraint)).toBe(expected);
    });
  });

  it('全角数字入力を parseBasisValueInput 経由で正しく数値化してから判定できる', () => {
    const constraint = INDICATOR_CONSTRAINTS.dividendGrowthRate;
    if (constraint === null) throw new Error('unreachable');
    expect(basisValueErrorText(parseBasisValueInput('１０'), constraint)).toBeNull();
  });

  it('①②④⑤⑦⑧⑩（minが0の指標）へ0を直接入力しても0以下ガードで拒否される', () => {
    const zeroMinKeys: readonly MetricKey[] = [
      'dividendGrowthRate',
      'consecutiveYears',
      'epsCagr',
      'roeAverage',
      'revenueCagr',
      'operatingMargin',
      'dividendYield',
    ];
    for (const key of zeroMinKeys) {
      const constraint = INDICATOR_CONSTRAINTS[key];
      if (constraint === null) throw new Error(`unreachable: ${key} has a constraint`);
      expect(basisValueErrorText(0, constraint)).toBe(
        '満点となる基準値は 0 より大きい値にしてください',
      );
    }
  });

  describe('きざみ（step）検証（fe-reviewer CR-2。BE `isMultipleOfStep` と同じ判定基準）', () => {
    describe('step 0.1（roeAverage: min 0・max 100）', () => {
      const constraint = INDICATOR_CONSTRAINTS.roeAverage;
      if (constraint === null) throw new Error('unreachable: roeAverage has a constraint');

      const cases: readonly (readonly [name: string, value: number, expected: string | null])[] = [
        ['ちょうどstepの倍数(12.3)はOK', 12.3, null],
        ['stepの倍数でない(12.35)はエラー', 12.35, '0.1きざみで入力してください'],
        ['浮動小数点誤差(12.3 相当の 0.1*123)は許容してOK（1e-6未満の誤差）', 0.1 * 123, null],
        ['整数(10)はstepの倍数としてOK', 10, null],
      ];

      it.each(cases)('%s', (_name, value, expected) => {
        expect(basisValueErrorText(value, constraint)).toBe(expected);
      });
    });

    describe('step 1（consecutiveYears: min 0・max 50）', () => {
      const constraint = INDICATOR_CONSTRAINTS.consecutiveYears;
      if (constraint === null) throw new Error('unreachable: consecutiveYears has a constraint');

      const cases: readonly (readonly [name: string, value: number, expected: string | null])[] = [
        ['整数(5)はOK', 5, null],
        ['小数(5.5)はstepの倍数でないためエラー', 5.5, '1きざみで入力してください'],
      ];

      it.each(cases)('%s', (_name, value, expected) => {
        expect(basisValueErrorText(value, constraint)).toBe(expected);
      });
    });

    it('範囲外はきざみ違反より先にレンジエラーを返す（優先順位: §3範囲 → きざみ）', () => {
      const constraint = INDICATOR_CONSTRAINTS.roeAverage;
      if (constraint === null) throw new Error('unreachable: roeAverage has a constraint');
      // 100.15 は上限(100)超過かつstep(0.1)の倍数でもない。範囲エラーが優先される
      expect(basisValueErrorText(100.15, constraint)).toBe('0〜100の範囲で入力してください');
    });
  });
});

describe('buildSavePayload（§6「選択していない指標の基準値は送らない」）', () => {
  it('選択5件: 選択された指標の基準値だけを含む', () => {
    const selected: readonly MetricKey[] = [
      'dividendGrowthRate',
      'consecutiveYears',
      'payoutRatio',
      'epsCagr',
      'roeAverage',
    ];
    const texts: Record<MetricKey, string> = {
      dividendGrowthRate: '10',
      consecutiveYears: '5',
      payoutRatio: '30',
      epsCagr: '8',
      roeAverage: '12',
      dividendSustainability: '99', // 未選択。含まれてはいけない
      revenueCagr: '',
      operatingMargin: '',
      mixCoefficient: '',
      dividendYield: '',
    };

    const payload = buildSavePayload(selected, texts);

    expect(payload.selected).toEqual(selected);
    expect(payload.basisValues).toEqual({
      dividendGrowthRate: 10,
      consecutiveYears: 5,
      payoutRatio: 30,
      epsCagr: 8,
      roeAverage: 12,
    });
  });

  it('選択10件（MIX係数含む）: MIX係数の基準値は選択されていても含まれない', () => {
    const selected: readonly MetricKey[] = [
      'dividendGrowthRate',
      'consecutiveYears',
      'payoutRatio',
      'epsCagr',
      'roeAverage',
      'dividendSustainability',
      'revenueCagr',
      'operatingMargin',
      'mixCoefficient',
      'dividendYield',
    ];
    const texts: Record<MetricKey, string> = {
      dividendGrowthRate: '10',
      consecutiveYears: '5',
      payoutRatio: '30',
      epsCagr: '8',
      roeAverage: '12',
      dividendSustainability: '20',
      revenueCagr: '3',
      operatingMargin: '5',
      mixCoefficient: '1.5', // 設定不可。含まれてはいけない
      dividendYield: '4',
    };

    const payload = buildSavePayload(selected, texts);

    expect(payload.selected).toEqual(selected);
    expect(payload.basisValues).not.toHaveProperty('mixCoefficient');
    expect(Object.keys(payload.basisValues)).toHaveLength(9);
  });

  it('解析できない値（不正文字列）は payload に含めない', () => {
    const selected: readonly MetricKey[] = ['dividendGrowthRate'];
    const texts = { dividendGrowthRate: 'abc' } as Record<MetricKey, string>;
    const payload = buildSavePayload(selected, texts);
    expect(payload.basisValues).toEqual({});
  });
});

describe('canSaveIndicatorSettings（§9「1行でもエラーがあれば送信ブロック」）', () => {
  const validTexts: Record<MetricKey, string> = {
    dividendGrowthRate: '10',
    consecutiveYears: '5',
    payoutRatio: '30',
    epsCagr: '8',
    roeAverage: '12',
    dividendSustainability: '20',
    revenueCagr: '3',
    operatingMargin: '5',
    mixCoefficient: '',
    dividendYield: '4',
  };

  it('選択中の全行が有効なら true（選択数5。CR-4の範囲チェックも満たす）', () => {
    const selected: readonly MetricKey[] = [
      'dividendGrowthRate',
      'consecutiveYears',
      'payoutRatio',
      'epsCagr',
      'roeAverage',
    ];
    expect(canSaveIndicatorSettings(selected, validTexts)).toBe(true);
  });

  it('選択中の1行でも0以下の基準値があれば false', () => {
    const selected: readonly MetricKey[] = ['dividendGrowthRate', 'roeAverage'];
    const texts = { ...validTexts, roeAverage: '0' };
    expect(canSaveIndicatorSettings(selected, texts)).toBe(false);
  });

  it('選択中の1行でも範囲外の基準値があれば false', () => {
    const selected: readonly MetricKey[] = ['payoutRatio'];
    const texts = { ...validTexts, payoutRatio: '501' };
    expect(canSaveIndicatorSettings(selected, texts)).toBe(false);
  });

  it('未選択行にエラーがあっても影響しない（選択数5。CR-4の範囲チェックも満たす）', () => {
    const selected: readonly MetricKey[] = [
      'dividendGrowthRate',
      'consecutiveYears',
      'payoutRatio',
      'epsCagr',
      'dividendSustainability',
    ];
    const texts = { ...validTexts, roeAverage: '0' }; // 未選択のため無視される
    expect(canSaveIndicatorSettings(selected, texts)).toBe(true);
  });

  it('MIX係数は選択されていても常に有効（基準値を持たないため。選択数5でCR-4の範囲チェックも満たす）', () => {
    const selected: readonly MetricKey[] = [
      'mixCoefficient',
      'dividendGrowthRate',
      'consecutiveYears',
      'payoutRatio',
      'epsCagr',
    ];
    expect(canSaveIndicatorSettings(selected, validTexts)).toBe(true);
  });

  describe('選択数の範囲チェック（fe-reviewer CR-4。5〜10の範囲外は行のエラー有無に関わらず false）', () => {
    it('選択数0（初期state）は false（`toggleSelection`の不変条件に頼らない防御）', () => {
      expect(canSaveIndicatorSettings([], validTexts)).toBe(false);
    });

    it('選択数4（下限未満）は行がすべて有効でも false', () => {
      const selected: readonly MetricKey[] = [
        'dividendGrowthRate',
        'consecutiveYears',
        'payoutRatio',
        'epsCagr',
      ];
      expect(selected).toHaveLength(4);
      expect(canSaveIndicatorSettings(selected, validTexts)).toBe(false);
    });

    it('選択数5（下限ちょうど）は行が有効なら true（境界値）', () => {
      const selected: readonly MetricKey[] = [
        'dividendGrowthRate',
        'consecutiveYears',
        'payoutRatio',
        'epsCagr',
        'roeAverage',
      ];
      expect(canSaveIndicatorSettings(selected, validTexts)).toBe(true);
    });

    it('選択数10（上限ちょうど・MIX係数含む）は行が有効なら true（境界値）', () => {
      const selected: readonly MetricKey[] = [
        'dividendGrowthRate',
        'consecutiveYears',
        'payoutRatio',
        'epsCagr',
        'roeAverage',
        'dividendSustainability',
        'revenueCagr',
        'operatingMargin',
        'mixCoefficient',
        'dividendYield',
      ];
      expect(canSaveIndicatorSettings(selected, validTexts)).toBe(true);
    });

    it('選択数11（上限超過。UI上は起こらないが防御的に検証）は false', () => {
      const selected: readonly MetricKey[] = [
        'dividendGrowthRate',
        'consecutiveYears',
        'payoutRatio',
        'epsCagr',
        'roeAverage',
        'dividendSustainability',
        'revenueCagr',
        'operatingMargin',
        'mixCoefficient',
        'dividendYield',
        'dividendGrowthRate', // 重複だが配列長としては11件を再現する
      ];
      expect(canSaveIndicatorSettings(selected, validTexts)).toBe(false);
    });
  });
});
