import { describe, expect, it } from 'vitest';

import { deriveMarketMultiples } from '@/domain/company/market-multiples';

/**
 * PER / PBR の導出（株価 ÷ EPS・BPS）。
 * 仕様: docs/02_design/logic/irbank-json-import.md §3.5
 *
 * PER は予想EPSを優先し、無ければ実績EPSで代用する（2026-07-29 決定）。
 * どちらを使ったかを `perSource` で追跡する。
 */

function input(overrides: {
  readonly priceSen?: number | null;
  readonly latestForecastEpsSen?: number | null;
  readonly latestActualEpsSen?: number | null;
  readonly latestActualBpsSen?: number | null;
}) {
  return {
    priceSen: null,
    latestForecastEpsSen: null,
    latestActualEpsSen: null,
    latestActualBpsSen: null,
    ...overrides,
  };
}

describe('株価が未入力なら判定不能', () => {
  it('priceSen が null なら両方 null。出所も null', () => {
    const result = deriveMarketMultiples(
      input({ latestActualEpsSen: 10_000, latestActualBpsSen: 100_000 }),
    );
    expect(result).toEqual({ per: null, perSource: null, pbr: null, pbrSource: null });
  });
});

describe('PER は予想EPSを優先する', () => {
  it('予想EPSがあればそれを使い、出所は forecast-eps', () => {
    const result = deriveMarketMultiples(
      input({ priceSen: 150_000, latestForecastEpsSen: 15_000, latestActualEpsSen: 10_000 }),
    );
    // 150,000 / 15,000 = 10倍（予想EPSの方）。実績EPSなら15倍になるので取り違えていないことも確認
    expect(result.per).toBe(10);
    expect(result.perSource).toBe('forecast-eps');
  });

  it('予想EPSが無ければ実績EPSで代用し、出所は actual-eps', () => {
    const result = deriveMarketMultiples(input({ priceSen: 150_000, latestActualEpsSen: 10_000 }));
    expect(result.per).toBe(15);
    expect(result.perSource).toBe('actual-eps');
  });

  it('予想EPSが 0 以下なら実績EPSにフォールバックする（赤字予想）', () => {
    const result = deriveMarketMultiples(
      input({ priceSen: 150_000, latestForecastEpsSen: -1_000, latestActualEpsSen: 10_000 }),
    );
    expect(result.per).toBe(15);
    expect(result.perSource).toBe('actual-eps');
  });

  it('どちらも無ければ null。出所も null', () => {
    const result = deriveMarketMultiples(input({ priceSen: 150_000 }));
    expect(result.per).toBeNull();
    expect(result.perSource).toBeNull();
  });
});

describe('PBR は常に実績（予想BPSは存在しない）', () => {
  it('株価1,000円・BPS500円 → PBR 2倍。出所は actual-bps', () => {
    const result = deriveMarketMultiples(input({ priceSen: 100_000, latestActualBpsSen: 50_000 }));
    expect(result.pbr).toBe(2);
    expect(result.pbrSource).toBe('actual-bps');
  });

  it('BPS が無ければ null。出所も null', () => {
    const result = deriveMarketMultiples(input({ priceSen: 100_000 }));
    expect(result.pbr).toBeNull();
    expect(result.pbrSource).toBeNull();
  });
});

describe('PER と PBR を同時に算出する。片方がもう片方を上書きしない', () => {
  it('両方が独立して算出される', () => {
    const result = deriveMarketMultiples(
      input({ priceSen: 200_000, latestActualEpsSen: 10_000, latestActualBpsSen: 50_000 }),
    );
    expect(result.per).toBe(20);
    expect(result.perSource).toBe('actual-eps');
    expect(result.pbr).toBe(4);
    expect(result.pbrSource).toBe('actual-bps');
  });
});

describe('欠損・0以下の基準値', () => {
  it('EPS が null なら PER も null。PBR は独立して算出される', () => {
    const result = deriveMarketMultiples(input({ priceSen: 100_000, latestActualBpsSen: 50_000 }));
    expect(result.per).toBeNull();
    expect(result.pbr).toBe(2);
  });

  it('実績EPSが 0 ならゼロ除算を避けて null（赤字境界）', () => {
    const result = deriveMarketMultiples(input({ priceSen: 100_000, latestActualEpsSen: 0 }));
    expect(result.per).toBeNull();
    expect(result.perSource).toBeNull();
  });

  it('実績EPSが負（赤字）でも null', () => {
    // 会社予想PERは市場が別途算出する値であり、実績赤字からの近似は誤解を招く
    const result = deriveMarketMultiples(input({ priceSen: 100_000, latestActualEpsSen: -5_000 }));
    expect(result.per).toBeNull();
  });

  it('BPS が 0 以下でも null（債務超過に近い状態）', () => {
    const result = deriveMarketMultiples(input({ priceSen: 100_000, latestActualBpsSen: -1 }));
    expect(result.pbr).toBeNull();
  });

  it('すべて null なら両方 null', () => {
    const result = deriveMarketMultiples(input({ priceSen: 100_000 }));
    expect(result).toEqual({ per: null, perSource: null, pbr: null, pbrSource: null });
  });
});
