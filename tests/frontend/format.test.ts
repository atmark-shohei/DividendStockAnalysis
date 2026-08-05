import { describe, expect, it } from 'vitest';

import { formatPriceAsOf, ratioToEditableText, senToEditableText } from '../../frontend/format';

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
