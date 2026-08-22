import { describe, expect, it } from 'vitest';

import {
  NO_DATA,
  consecutiveYearsSummaryText,
  dividendYoyChangeText,
  dividendYoyDiffText,
  dividendYoyGlyph,
  dividendYoyStateLabel,
  fiscalPeriodLabel,
  formatBandRange,
  formatMetricValue,
  formatPriceAsOf,
  formatSen,
  payoutRatioBreakdownText,
  ratioToEditableText,
  reasonText,
  senToEditableText,
} from '../../frontend/format';

/**
 * IRバンク取り込みのプレフィル変換。
 *
 * `senToEditableText` / `ratioToEditableText` は `formatSen` 等の**表示用**
 * 整形とは別物で、編集可能なテキスト入力の初期値を作る（単位・桁区切りなし）。
 */

describe('senToEditableText', () => {
  it('null は空文字（データなしと0円を区別する）', () => {
    expect(senToEditableText(null)).toBe('');
  });

  it('銭を円のテキストにする', () => {
    expect(senToEditableText(18_359)).toBe('183.59');
    expect(senToEditableText(8_000)).toBe('80');
  });

  it('0銭は "0"。空文字にしない', () => {
    expect(senToEditableText(0)).toBe('0');
  });

  it('負の値も往復する', () => {
    expect(senToEditableText(-12_345)).toBe('-123.45');
  });
});

/**
 * 株価の観測時刻表示（`docs/02_design/logic/market-data-source.md` §7.4）。
 * `formatFetchedAt`（保存時刻）とは別関数。`priceAsOf` は Yahoo が返した観測時刻そのもので、
 * `null`（取れなかった）を受けたときの文言も違う。
 */
describe('formatPriceAsOf', () => {
  it('UTC を JST に変換する', () => {
    expect(formatPriceAsOf('2026-07-30T06:30:00Z')).toBe('2026/7/30 15:30:00（JST）');
  });

  it('日をまたぐ境界（UTC 15:00 → JST 翌日 0:00）', () => {
    expect(formatPriceAsOf('2026-07-30T15:00:00Z')).toBe('2026/7/31 0:00:00（JST）');
  });

  it('null は「取得時刻不明」（空文字にしない）', () => {
    expect(formatPriceAsOf(null)).toBe('取得時刻不明');
  });

  it('不正な文字列は「取得時刻不明」', () => {
    expect(formatPriceAsOf('not-a-date')).toBe('取得時刻不明');
  });
});

/**
 * 採用した決算年度のラベル（`docs/02_design/logic/balance-sheet-derivation.md` §2.3）。
 * ⑥ の入力（負債総額・前期末の配当総額）が「どの決算年度の値か」を画面に出すために使う。
 */
describe('fiscalPeriodLabel', () => {
  const cases: readonly {
    readonly name: string;
    readonly fiscalYear: number | null;
    readonly endMonth: number | null;
    readonly expected: string;
  }[] = [
    { name: '3月期', fiscalYear: 2026, endMonth: 3, expected: '2026年3月期' },
    {
      name: '3月期以外も月をそのまま出す',
      fiscalYear: 2026,
      endMonth: 12,
      expected: '2026年12月期',
    },
    {
      name: '決算月が定まらない銘柄は年度まで（月を推測しない）',
      fiscalYear: 2026,
      endMonth: null,
      expected: '2026年度',
    },
    {
      name: '年度が無ければ「—」。0年3月期のような偽の期を作らない',
      fiscalYear: null,
      endMonth: 3,
      expected: NO_DATA,
    },
    { name: '年度も決算月も無ければ「—」', fiscalYear: null, endMonth: null, expected: NO_DATA },
  ];

  for (const { name, fiscalYear, endMonth, expected } of cases) {
    it(name, () => {
      expect(fiscalPeriodLabel(fiscalYear, endMonth)).toBe(expected);
    });
  }

  it('データなしを 0 と表示しない', () => {
    expect(fiscalPeriodLabel(null, 3)).not.toContain('0');
  });
});

/**
 * ③ 予想配当性向の内訳（`docs/02_design/logic/payout-ratio-scoring.md` §7）。
 *
 * **`null`（判定不能）と 0点は別物**（`.claude/rules/frontend.md`「データが無い場合に
 * 0 を表示しない」）。無配（配当0・判定可）は `0.00%` / `0 点` を出し、判定不能は
 * `NO_DATA`（`—`）+ 理由文言を出す。両者を混同しないことを本テストの核心とする。
 */
describe('payoutRatioBreakdownText', () => {
  it('予想・実績とも判定可（EPS赤字で予想0点、実績は正常7点のケース）', () => {
    const text = payoutRatioBreakdownText(
      { value: 61.79, score: 0, unavailableReason: null },
      { value: 36.3, score: 7, unavailableReason: null },
      'actual',
    );
    expect(text).toBe('予想 61.79% / 0 点／実績 36.30% / 7 点／採用: 実績');
  });

  it('予想が判定不能（null）、実績は判定可 → 予想側は NO_DATA + 理由。0.00%/0点にしない', () => {
    const text = payoutRatioBreakdownText(
      { value: null, score: null, unavailableReason: 'input-missing' },
      { value: 36.3, score: 7, unavailableReason: null },
      'actual',
    );
    expect(text).toBe(`予想 ${NO_DATA} / ${NO_DATA}（データなし）／実績 36.30% / 7 点／採用: 実績`);
    expect(text).not.toContain('0.00%');
    expect(text).not.toContain('0 点');
  });

  it('実績が判定不能（null）、予想は判定可 → 実績側は NO_DATA + 理由', () => {
    const text = payoutRatioBreakdownText(
      { value: 25, score: 9, unavailableReason: null },
      { value: null, score: null, unavailableReason: 'division-by-zero' },
      'forecast',
    );
    expect(text).toBe(
      `予想 25.00% / 9 点／実績 ${NO_DATA} / ${NO_DATA}（基準値が 0 のため算出できません）／採用: 予想`,
    );
  });

  it('両方が判定不能（null） → 採用: —（source: null）', () => {
    const text = payoutRatioBreakdownText(
      { value: null, score: null, unavailableReason: 'input-missing' },
      { value: null, score: null, unavailableReason: 'input-missing' },
      null,
    );
    expect(text).toBe(
      `予想 ${NO_DATA} / ${NO_DATA}（データなし）／実績 ${NO_DATA} / ${NO_DATA}（データなし）／採用: ${NO_DATA}`,
    );
  });

  it('無配（配当0・判定可）は 0.00% / 0 点。null 表示（—）と区別する', () => {
    const text = payoutRatioBreakdownText(
      { value: 0, score: 0, unavailableReason: null },
      { value: 0, score: 0, unavailableReason: null },
      'forecast',
    );
    expect(text).toBe('予想 0.00% / 0 点／実績 0.00% / 0 点／採用: 予想');
    expect(text).not.toContain(NO_DATA);
  });
});

/**
 * ④EPS CAGR・⑦売上高CAGR専用の判定不能理由
 * （`docs/02_design/logic/edinet-history-import.md` §4.3）。
 *
 * `reasonText` は `REASON_TEXT` に無いキーへ既定文言（「判定できません」）へ
 * フォールバックする（`format.ts:30-33`）。`restated-history` を追加しても
 * この後方互換が壊れないことを合わせて固定する。
 */
describe('reasonText', () => {
  const cases: readonly {
    readonly name: string;
    readonly reason: string;
    readonly expected: string;
  }[] = [
    {
      name: 'restated-history は遡及修正の専用文言（フォールバックの「判定できません」にしない）',
      reason: 'restated-history',
      expected: '有価証券報告書の記載が年度をまたいで一致しないため、算出できません',
    },
    {
      name: '未知の理由コードはフォールバック文言のまま（restated-history追加後も壊れない）',
      reason: 'some-future-reason',
      expected: '判定できません',
    },
  ];

  for (const { name, reason, expected } of cases) {
    it(name, () => {
      expect(reasonText(reason)).toBe(expected);
    });
  }

  it('null は空文字（理由が無いこと自体を示す。既存の後方互換）', () => {
    expect(reasonText(null)).toBe('');
  });
});

/**
 * 解析ダイアログのヒーロー行（株価・PER・PBR。T-096・`analysis-dialog.md` §4.1、§9）が
 * 使う表示整形。**「PBR が null の銘柄で『— データなし』と表示され、0 は出ない」**
 * （§9 受入基準）を含め、`null`（判定不能・未入力）と 0（無配・実測ゼロ）を混同しないことを
 * 検証する。
 */
describe('formatSen（解析ダイアログの株価表示）', () => {
  it('null は — データなし（未入力の株価と0円を混同しない）', () => {
    expect(formatSen(null)).toBe(NO_DATA);
  });

  it('0銭は「0.00 円」。null と区別する', () => {
    expect(formatSen(0)).toBe('0.00 円');
    expect(formatSen(0)).not.toBe(NO_DATA);
  });

  it('銭を3桁区切りの円に変換する（端数あり）', () => {
    expect(formatSen(314_200)).toBe('3,142.00 円');
  });

  it('端数の無い銭も小数第2位までゼロ埋めする', () => {
    expect(formatSen(100_000)).toBe('1,000.00 円');
  });
});

describe('formatMetricValue（解析ダイアログの PER/PBR 表示。単位「倍」）', () => {
  it('PER が null（算出不能）なら — データなし。0倍にしない', () => {
    expect(formatMetricValue(null, '倍', false)).toBe(NO_DATA);
  });

  it('PBR が null（算出不能）なら — データなし。0倍にしない（analysis-dialog.md §9）', () => {
    expect(formatMetricValue(null, '倍', false)).toBe(NO_DATA);
  });

  it('PER の値をそのまま「倍」付きで表示する（小数第2位まで）', () => {
    expect(formatMetricValue(14.2, '倍', false)).toBe('14.20 倍');
  });

  it('0倍（算出結果として実際に0）は 0.00 倍。null と混同しない', () => {
    expect(formatMetricValue(0, '倍', false)).toBe('0.00 倍');
    expect(formatMetricValue(0, '倍', false)).not.toBe(NO_DATA);
  });

  it('⑩配当利回りは1/100%単位（isHundredthsPercent=true）で% へ戻す', () => {
    expect(formatMetricValue(318, '%', true)).toBe('3.18%');
  });

  it('⑩配当利回りが null なら — データなし', () => {
    expect(formatMetricValue(null, '%', true)).toBe(NO_DATA);
  });
});

/**
 * ①線グラフ下の表・前年比（`docs/02_design/ui/pages/analysis-dialog.md` §5.1、§9受入基準）。
 *
 * **`±0円` にしない**。前年データが無い（1年分しか無い）場合と「金額が変わらない」場合を
 * 区別する（データ欠損と「変化なし」の区別。§9「①の線グラフで、配当が1年分しかない年度の
 * 前年比が `—` になり `±0円` にならない」）。色は中立トークンのみ（Manager決定。
 * `--color-positive`/`--color-negative` は使わない）。
 */
describe('dividendYoyChangeText', () => {
  const cases: readonly {
    readonly name: string;
    readonly currentSen: number | null;
    readonly previousSen: number | null | undefined;
    readonly expected: string;
  }[] = [
    { name: '増配', currentSen: 15_000, previousSen: 10_000, expected: '▲ +50.00円' },
    { name: '減配', currentSen: 10_000, previousSen: 15_000, expected: '▼ -50.00円' },
    { name: '据置（同額・非ゼロ）', currentSen: 10_000, previousSen: 10_000, expected: '－ 据置' },
    {
      name: '無配継続（0→0）は「変化なし」と判定可能。±0円にしない',
      currentSen: 0,
      previousSen: 0,
      expected: '－ 据置',
    },
    {
      name: '前年データなし（1年分のみ。§9受入基準の直接対象）。±0円にならない',
      currentSen: 10_000,
      previousSen: undefined,
      expected: NO_DATA,
    },
    { name: '前年が判定不能（null）', currentSen: 10_000, previousSen: null, expected: NO_DATA },
    { name: '当年が判定不能（null）', currentSen: null, previousSen: 10_000, expected: NO_DATA },
  ];

  for (const { name, currentSen, previousSen, expected } of cases) {
    it(name, () => {
      expect(dividendYoyChangeText(currentSen, previousSen)).toBe(expected);
    });
  }

  it('前年データなしのケースは ±0円 を含まない（§9受入基準を明示的にassert）', () => {
    expect(dividendYoyChangeText(10_000, undefined)).not.toContain('円');
  });

  it('金額の丸め境界値: 1銭差でも 0.01円 を正しく返す', () => {
    expect(dividendYoyChangeText(101, 100)).toBe('▲ +0.01円');
  });
});

/**
 * ②連続非減配年数の年次リスト（`docs/02_design/ui/pages/analysis-dialog.md` §5.2、T-098）。
 *
 * **増配／据置／減配の判定はBE domain側で確定済み**（`GET /api/companies/:code/dividends`
 * の `consecutiveYearRows[].state`）。ここでは `dividendYoyGlyph`/`dividendYoyStateLabel`が
 * 既に確定した `state` を glyph・文言へ変換するだけであることを検証する
 * （FE側で `current - previous` の符号判定を行わない）。
 */
describe('dividendYoyGlyph', () => {
  const cases: readonly {
    readonly name: string;
    readonly state: 'increase' | 'flat' | 'decrease' | null;
    readonly expected: string;
  }[] = [
    { name: '増配は ▲', state: 'increase', expected: '▲' },
    { name: '据置は －', state: 'flat', expected: '－' },
    { name: '減配は ▼', state: 'decrease', expected: '▼' },
    { name: '判定不能（先頭行・データ欠損）は NO_DATA', state: null, expected: NO_DATA },
  ];

  for (const { name, state, expected } of cases) {
    it(name, () => {
      expect(dividendYoyGlyph(state)).toBe(expected);
    });
  }
});

describe('dividendYoyStateLabel', () => {
  const cases: readonly {
    readonly name: string;
    readonly state: 'increase' | 'flat' | 'decrease' | null;
    readonly expected: string;
  }[] = [
    { name: '増配', state: 'increase', expected: '増配' },
    { name: '据置', state: 'flat', expected: '据置' },
    { name: '減配', state: 'decrease', expected: '減配' },
    { name: '判定不能は NO_DATA', state: null, expected: NO_DATA },
  ];

  for (const { name, state, expected } of cases) {
    it(name, () => {
      expect(dividendYoyStateLabel(state)).toBe(expected);
    });
  }
});

/**
 * ②年次リストの前年差（`diffSen` はBEが算出済み。FEは金額整形のみ担う）。
 * `±0円` にしない（データ欠損と「変化なし」を区別する。①の `dividendYoyChangeText` と
 * 同じ判断）。
 */
describe('dividendYoyDiffText', () => {
  const cases: readonly {
    readonly name: string;
    readonly diffSen: number | null;
    readonly expected: string;
  }[] = [
    { name: '増配（正の差額）', diffSen: 5_000, expected: '+50.00円' },
    { name: '減配（負の差額）', diffSen: -5_000, expected: '-50.00円' },
    {
      name: '据置（差0）は「0円」。データ欠損の NO_DATA と区別する',
      diffSen: 0,
      expected: '0円',
    },
    { name: '判定不能（前年比較ができない先頭行等）は NO_DATA', diffSen: null, expected: NO_DATA },
    { name: '金額境界値: 1銭差でも 0.01円 を正しく返す', diffSen: 1, expected: '+0.01円' },
  ];

  for (const { name, diffSen, expected } of cases) {
    it(name, () => {
      expect(dividendYoyDiffText(diffSen)).toBe(expected);
    });
  }

  it('据置のケースは ±0円 を含まない（0円 と ±0円 を混同しない）', () => {
    expect(dividendYoyDiffText(0)).not.toContain('±');
  });
});

/**
 * ②年次リスト末尾の要約行。`consecutiveYears` はBEのスコアリング結果値
 * （`activeMetric.value`）そのもの。**`0`年は判定可能な結果であり NO_DATA にしない**
 * （`null`→0表示の禁止事項とは逆方向の境界値。`consecutive-years-scoring.md` §6.3）。
 */
describe('consecutiveYearsSummaryText', () => {
  it('0年（直近が減配。判定可能な結果） → NO_DATA にしない', () => {
    const text = consecutiveYearsSummaryText(0);
    expect(text).toBe('減配のない状態が0年継続中です。');
    expect(text).not.toBe(NO_DATA);
  });

  it('18年（全期間非減配の上限ケース）', () => {
    expect(consecutiveYearsSummaryText(18)).toBe('減配のない状態が18年継続中です。');
  });

  it('null（判定不能） → NO_DATA。「0年継続中」を出さない', () => {
    const text = consecutiveYearsSummaryText(null);
    expect(text).toBe(NO_DATA);
    expect(text).not.toContain('0年');
  });
});

describe('ratioToEditableText', () => {
  it('null は空文字', () => {
    expect(ratioToEditableText(null)).toBe('');
  });

  it('元から2桁程度の値はそのまま', () => {
    expect(ratioToEditableText(13.93)).toBe('13.93');
  });

  it('除算由来の浮動小数点の誤差を小数第2位に丸める', () => {
    // 1,099,125 / 6,071,915 * 100（9433 の営業利益率、実測）
    expect(ratioToEditableText(18.101785021694145)).toBe('18.1');
    // 1500 / 183.59（PER、実測）
    expect(ratioToEditableText(8.170379650307751)).toBe('8.17');
  });

  it('0は "0"', () => {
    expect(ratioToEditableText(0)).toBe('0');
  });
});

/**
 * 評価基準タブ（T-099）の区分表1行の整形。**計算・判定はしない**（BEが返した
 * `minInclusive`/`maxExclusive` をそのまま整形するだけ）。テスト用のband値は
 * `bands.ts` の実値をコピーしない合成値を使う（表示ロジックのテストであり、
 * 採点区分値の二重管理を避けるため）。
 */
describe('formatBandRange', () => {
  it('上限無し（最上位区分）は「◯以上」', () => {
    expect(formatBandRange({ minInclusive: 30, maxExclusive: null }, '%', false)).toBe('30.00%以上');
  });

  it('下限無し（⑤ROE最下段相当）は「◯未満」', () => {
    expect(formatBandRange({ minInclusive: null, maxExclusive: 20 }, '%', false)).toBe('20.00%未満');
  });

  it('通常区間は「◯以上 ◯未満」', () => {
    expect(formatBandRange({ minInclusive: 10, maxExclusive: 20 }, '%', false)).toBe(
      '10.00%以上 20.00%未満',
    );
  });

  it('⑩相当の1/100%スケーリング（550 → 5.50%）', () => {
    expect(formatBandRange({ minInclusive: 550, maxExclusive: null }, '%', true)).toBe('5.50%以上');
    expect(formatBandRange({ minInclusive: null, maxExclusive: 550 }, '%', true)).toBe('5.50%未満');
  });

  it('倍単位', () => {
    expect(formatBandRange({ minInclusive: 10, maxExclusive: 12 }, '倍', false)).toBe(
      '10.00 倍以上 12.00 倍未満',
    );
  });

  it('年単位・整数年は小数を出さない', () => {
    expect(formatBandRange({ minInclusive: 17, maxExclusive: null }, '年', false)).toBe(
      '17 年以上',
    );
  });

  it('年単位・端数年は小数第2位まで出す', () => {
    expect(formatBandRange({ minInclusive: 2.5, maxExclusive: 5 }, '年', false)).toBe(
      '2.50 年以上 5 年未満',
    );
  });

  it('下限・上限とも null（区分表として不正な行）は NO_DATA', () => {
    expect(formatBandRange({ minInclusive: null, maxExclusive: null }, '%', false)).toBe(NO_DATA);
  });
});
