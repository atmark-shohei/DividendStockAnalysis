import { describe, expect, it } from 'vitest';

import {
  CONSECUTIVE_YEARS_BANDS,
  DIVIDEND_GROWTH_RATE_BANDS,
  DIVIDEND_SUSTAINABILITY_BANDS,
  DIVIDEND_YIELD_BANDS,
  EPS_CAGR_BANDS,
  MIX_COEFFICIENT_BANDS,
  OPERATING_MARGIN_BANDS,
  PAYOUT_RATIO_BANDS,
  REVENUE_CAGR_BANDS,
  ROE_AVERAGE_BANDS,
} from '@/domain/scoring/bands';
import { type ScoreBand, assertContiguous, validateBands } from '@/domain/scoring/score-band';

/**
 * 10指標の区分表。原典のスコア表には実際に穴があった（§0.2 の ① の 1〜2%）。
 * 同じ事故を再発させないよう、**全指標の定数**を健全性チェックに通す。
 */

const ALL_BANDS: readonly (readonly [string, readonly ScoreBand[]])[] = [
  ['① 増配率', DIVIDEND_GROWTH_RATE_BANDS],
  ['② 連続非減配年数', CONSECUTIVE_YEARS_BANDS],
  ['③ 予想配当性向', PAYOUT_RATIO_BANDS],
  ['④ EPS CAGR', EPS_CAGR_BANDS],
  ['⑤ ROE 5年平均', ROE_AVERAGE_BANDS],
  ['⑥ 配当維持可能年数', DIVIDEND_SUSTAINABILITY_BANDS],
  ['⑦ 売上高 CAGR', REVENUE_CAGR_BANDS],
  ['⑧ 営業利益率 5年平均', OPERATING_MARGIN_BANDS],
  ['⑨ MIX係数', MIX_COEFFICIENT_BANDS],
  ['⑩ 配当利回り', DIVIDEND_YIELD_BANDS],
];

describe('区分表の健全性', () => {
  it.each(ALL_BANDS)('%s の区分表に穴も重複もない', (_label, bands) => {
    expect(() => assertContiguous(bands)).not.toThrow();
    expect(validateBands(bands).ok).toBe(true);
  });

  it.each(ALL_BANDS)('%s の点数はすべて 0〜10 の整数', (_label, bands) => {
    for (const band of bands) {
      expect(Number.isInteger(band.points)).toBe(true);
      expect(band.points).toBeGreaterThanOrEqual(0);
      expect(band.points).toBeLessThanOrEqual(10);
    }
  });

  it.each(ALL_BANDS)('%s に同じ点数の区分が2つ以上ない', (_label, bands) => {
    const points = bands.map((band) => band.points);
    expect(new Set(points).size).toBe(points.length);
  });
});

describe('段数（原典の決定がそのまま入っているか）', () => {
  it('③ だけ 10段。1点を返す経路が無いのは意図的（2026-07-27 決定 / 設計書 §7）', () => {
    expect(PAYOUT_RATIO_BANDS).toHaveLength(10);
    expect(PAYOUT_RATIO_BANDS.some((band) => band.points === 1)).toBe(false);
  });

  it('② は 4段。10/5/3/0 しかない', () => {
    expect(CONSECUTIVE_YEARS_BANDS.map((band) => band.points)).toEqual([10, 5, 3, 0]);
  });

  it('①④⑥⑦⑧ は 0点の行を持たない（0以下は実装側のガードで落とす）', () => {
    for (const bands of [
      DIVIDEND_GROWTH_RATE_BANDS,
      EPS_CAGR_BANDS,
      DIVIDEND_SUSTAINABILITY_BANDS,
      REVENUE_CAGR_BANDS,
      OPERATING_MARGIN_BANDS,
    ]) {
      expect(bands.some((band) => band.points === 0)).toBe(false);
    }
  });

  it('⑤ の最下段は下限なし。負の平均 ROE を 0点にするため（§0.3）', () => {
    const lowest = ROE_AVERAGE_BANDS.find((band) => band.points === 0);
    expect(lowest?.minInclusive).toBeNull();
    expect(lowest?.maxExclusive).toBe(2);
  });

  it('⑨ は最上位区分が 0点。低いほど高得点なので表の向きが逆', () => {
    const openEnded = MIX_COEFFICIENT_BANDS.find((band) => band.maxExclusive === null);
    expect(openEnded?.points).toBe(0);
    expect(openEnded?.minInclusive).toBe(40);
  });

  it('③ も最上位区分が 0点（70%以上）', () => {
    const openEnded = PAYOUT_RATIO_BANDS.find((band) => band.maxExclusive === null);
    expect(openEnded?.points).toBe(0);
    expect(openEnded?.minInclusive).toBe(70);
  });
});

describe('④⑦⑧ の重複は意図的', () => {
  // 共有すると ⑦ の閾値を直したときに ④⑧ が黙って変わる。
  // 指標ごとに独立して出典の議論があるため、別々の定数にしてある。
  // 「今は一致している」ことをここで固定し、片方だけ動いたら気付けるようにする。
  it('現時点では ④ と ⑦ と ⑧ の表は一致している', () => {
    expect(EPS_CAGR_BANDS).toEqual(REVENUE_CAGR_BANDS);
    expect(EPS_CAGR_BANDS).toEqual(OPERATING_MARGIN_BANDS);
  });

  it('別の配列オブジェクトである（片方を書き換えても他方に波及しない）', () => {
    expect(EPS_CAGR_BANDS).not.toBe(REVENUE_CAGR_BANDS);
    expect(EPS_CAGR_BANDS).not.toBe(OPERATING_MARGIN_BANDS);
  });
});
