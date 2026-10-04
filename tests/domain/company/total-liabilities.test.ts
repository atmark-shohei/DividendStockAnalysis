import { describe, expect, it } from 'vitest';

import { deriveTotalLiabilities } from '@/domain/company/total-liabilities';

/**
 * 負債総額の導出（総資産 − 純資産）。
 * 仕様: docs/02_design/logic/balance-sheet-derivation.md §2.1 / §3 / §5 / 受入基準 §6
 *
 * **入力は円、出力の `valueSen` は銭**（同 §2.1 の意図的な例外）。
 */

describe('通常の算出', () => {
  it('総資産 − 純資産 を銭で返す', () => {
    expect(deriveTotalLiabilities(1_000, 400)).toEqual({ kind: 'derived', valueSen: 60_000 });
  });

  it('7203 の実測値: 総資産を先に銭化していたら unsafe-integer になる回帰', () => {
    // 総資産 105.5兆円は銭で 1.06e16（MAX_SAFE_INTEGER 超え）。円で引けば 64.5兆円 → 6.45e15 に収まる
    expect(deriveTotalLiabilities(105_522_331_000_000, 41_020_068_000_000)).toEqual({
      kind: 'derived',
      valueSen: 6_450_226_300_000_000,
    });
  });

  it('9433 の実測値（FY2026）', () => {
    expect(deriveTotalLiabilities(19_063_364_000_000, 5_592_690_000_000)).toEqual({
      kind: 'derived',
      valueSen: 1_347_067_400_000_000,
    });
  });

  it('8306 の実測値（FY2026）は円で引いても銭化で超える。銀行は埋まらない（§3.2）', () => {
    expect(deriveTotalLiabilities(431_731_548_000_000, 23_744_152_000_000)).toEqual({
      kind: 'unsafe-integer',
    });
  });
});

describe('境界値ちょうど', () => {
  it('差が0なら derived の 0 銭。input-missing でも negative-liabilities でもない', () => {
    // 無借金は実在する。0 を null に倒すと ⑥ のネットキャッシュが判定不能になる（§5.4）
    expect(deriveTotalLiabilities(1_000, 1_000)).toEqual({ kind: 'derived', valueSen: 0 });
  });

  it('総資産が純資産より1円少ないだけで negative-liabilities', () => {
    expect(deriveTotalLiabilities(1_000, 1_001)).toEqual({ kind: 'negative-liabilities' });
  });

  it('銭化して MAX_SAFE_INTEGER ちょうど手前は derived', () => {
    // 90,071,992,547,409 円 → 9,007,199,254,740,900 銭（MAX_SAFE_INTEGER = 9,007,199,254,740,991）
    const result = deriveTotalLiabilities(90_071_992_547_409, 0);
    expect(result).toEqual({ kind: 'derived', valueSen: 9_007_199_254_740_900 });
    if (result.kind !== 'derived') throw new Error('derived でない');
    expect(Number.isSafeInteger(result.valueSen)).toBe(true);
  });

  it('銭化して MAX_SAFE_INTEGER を超えたら unsafe-integer', () => {
    // 90,071,992,547,410 円 → 9,007,199,254,741,000 銭 > MAX_SAFE_INTEGER
    expect(deriveTotalLiabilities(90_071_992_547_410, 0)).toEqual({ kind: 'unsafe-integer' });
  });

  it('円の生値が整数でなければ not-integer', () => {
    expect(deriveTotalLiabilities(1_000.5, 400)).toEqual({ kind: 'not-integer' });
    expect(deriveTotalLiabilities(1_000, 400.5)).toEqual({ kind: 'not-integer' });
  });

  it('円の生値が整数でも安全整数を超えていたら unsafe-integer（実データでは起きない防御）', () => {
    // 1e17 は整数だが安全整数ではない。差だけを見ると 1e17 - 1e17 = 0 で通ってしまう
    expect(deriveTotalLiabilities(1e17, 1e17)).toEqual({ kind: 'unsafe-integer' });
  });
});

describe('負の値', () => {
  it('純資産が負（債務超過）でも算出する。negative-liabilities に倒さない', () => {
    // 1000 - (-500) = 1500 円 → 150000 銭。総資産より大きい負債総額が正しく出る（§5.2）
    expect(deriveTotalLiabilities(1_000, -500)).toEqual({ kind: 'derived', valueSen: 150_000 });
  });

  it('総資産が負でも差が正なら derived（総資産の符号だけで弾かない）', () => {
    expect(deriveTotalLiabilities(-500, -1_000)).toEqual({ kind: 'derived', valueSen: 50_000 });
  });

  it('債務超過を null に倒すと ⑥ が 0点を出せなくなるので、必ず値を返す（§5.2）', () => {
    const result = deriveTotalLiabilities(0, -1);
    expect(result.kind).toBe('derived');
  });
});

describe('データ欠損', () => {
  it('総資産が null なら input-missing。0 を返さない', () => {
    expect(deriveTotalLiabilities(null, 400)).toEqual({ kind: 'input-missing' });
  });

  it('純資産が null なら input-missing', () => {
    expect(deriveTotalLiabilities(1_000, null)).toEqual({ kind: 'input-missing' });
  });

  it('両方 null でも input-missing（0 でも not-integer でもない）', () => {
    expect(deriveTotalLiabilities(null, null)).toEqual({ kind: 'input-missing' });
  });

  it('欠損の判定は整数性より先に来る（null に Number.isInteger を掛けない）', () => {
    expect(deriveTotalLiabilities(null, 400.5)).toEqual({ kind: 'input-missing' });
  });
});
