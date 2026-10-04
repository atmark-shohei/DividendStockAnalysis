import { describe, expect, it } from 'vitest';

import { parsePriceInput } from '@/lib/input/parse-price';

/**
 * 株価入力欄のパース。
 * 仕様: docs/02_design/logic/dividend-yield-scoring.md §3.1
 * 「数値のみ入力可能。初期値は空」「全角数字は半角に正規化する」
 *
 * 戻り値は銭単位の整数。1 円 = 100 銭。
 */

/** 期待どおり読めたときの銭を取り出す。読めなければテストを落とす。 */
function sen(raw: string): number {
  const result = parsePriceInput(raw);
  if (result.kind !== 'ok') throw new Error(`読めなかった: ${raw} -> ${result.kind}`);
  return result.sen;
}

describe('株価入力のパース — 正常系', () => {
  it('半角の整数を銭に変換する', () => {
    expect(sen('1000')).toBe(100_000);
  });

  it('小数第2位まで受け付ける（1 銭単位）', () => {
    expect(sen('1234.56')).toBe(123_456);
  });

  it('全角数字を半角に正規化する', () => {
    // 日本語環境では日常的に混入する（.claude/rules/frontend.md）
    expect(sen('１２３４')).toBe(123_400);
  });

  it('全角のピリオドと数字が混ざっていても読む', () => {
    expect(sen('１２３４．５６')).toBe(123_456);
  });

  it('3桁区切りのカンマを許容する', () => {
    expect(sen('1,234')).toBe(123_400);
    expect(sen('１，２３４')).toBe(123_400);
    expect(sen('1,234,567')).toBe(123_456_700);
  });

  it('前後の空白を無視する', () => {
    expect(sen('  1000  ')).toBe(100_000);
    expect(sen('　1000')).toBe(100_000); // 全角スペース
  });

  it('負の株価もパースはする（妥当性の判定はスコア側の責務）', () => {
    // §4 で「株価が負 → 判定不能」と決まっているので、ここで握りつぶさない
    expect(sen('-1000')).toBe(-100_000);
  });

  it('U+2212（−）を負号として読む。IME が半角ハイフンの代わりに出す', () => {
    expect(sen('−1000')).toBe(-100_000);
  });

  it('0 はパースできる（ゼロ除算の判定はスコア側で行う）', () => {
    expect(sen('0')).toBe(0);
  });

  it('-0 を返さない。Object.is(-0, 0) が false で比較が事故るため', () => {
    expect(Object.is(sen('-0'), 0)).toBe(true);
  });
});

describe('株価入力のパース — 未入力と不正入力を区別する', () => {
  // 両方を null で返すと、abc と入力したユーザーに
  // 「株価を入力してください」と誤表示される（§4）
  it('空文字・空白のみは empty', () => {
    expect(parsePriceInput('').kind).toBe('empty');
    expect(parsePriceInput('   ').kind).toBe('empty');
    expect(parsePriceInput('　').kind).toBe('empty');
  });

  it('数値でない文字が混ざっていたら invalid（empty ではない）', () => {
    for (const bad of ['abc', '1000円', '1e3', '--5', '1.2.3', '＋1000']) {
      expect(parsePriceInput(bad)).toEqual({ kind: 'invalid' });
    }
  });

  it('小数第3位以下は受け付けない（1 銭未満は表現できない）', () => {
    expect(parsePriceInput('1234.567').kind).toBe('invalid');
  });
});

describe('株価入力のパース — 桁ずれを通さない', () => {
  it('3桁区切りとして不正なカンマは invalid', () => {
    // '12,3' は '12.3' の打ち間違い（テンキーで . と , は隣接）。
    // カンマを無検証で除去すると 123 円として通り、10倍の桁ずれになる
    for (const bad of ['12,3', ',,,123', '1,2,3,4', '1,234,', ',123', '1234,567']) {
      expect(parsePriceInput(bad)).toEqual({ kind: 'invalid' });
    }
  });

  it('3桁区切りの前置ゼロは invalid', () => {
    // '0,123' が通ると 123 円として読まれる。区切りとして妥当な形ではない
    for (const bad of ['0,123', '00,123']) {
      expect(parsePriceInput(bad)).toEqual({ kind: 'invalid' });
    }
  });

  it('安全整数を超える桁は invalid。非整数を下流に流さない', () => {
    // Number.isSafeInteger を超えると銭が整数でなくなり、整数比較の前提が崩れる
    for (const huge of ['12345678901234567890', '99999999999999999']) {
      expect(parsePriceInput(huge)).toEqual({ kind: 'invalid' });
    }
  });

  it('読めた値は必ず安全整数', () => {
    // ここが保証するのは「銭が安全整数であること」だけ。
    // 業務上の株価上限は §3.1 に規定が無く、実装していない。
    // 判定式の積が溢れる範囲は scoring 側（calculateDividendYield）が弾く。
    for (const ok of ['0', '1', '1000', '1234.56', '-1000', '10000000']) {
      const result = parsePriceInput(ok);
      expect(result.kind).toBe('ok');
      if (result.kind === 'ok') expect(Number.isSafeInteger(result.sen)).toBe(true);
    }
  });
});
