import { describe, expect, it } from 'vitest';

import {
  NO_DATA,
  fiscalPeriodLabel,
  formatPriceAsOf,
  payoutRatioBreakdownText,
  ratioToEditableText,
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
