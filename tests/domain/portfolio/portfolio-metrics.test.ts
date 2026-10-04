import { describe, expect, it } from 'vitest';

import { MAX_PRICE_SEN } from '@/domain/company/dividend-record';
import {
  type Holding,
  calculatePortfolioMetrics,
  describeHoldingValuation,
} from '@/domain/portfolio/portfolio-metrics';

/**
 * ポートフォリオ集計（T-102 / `docs/02_design/logic/portfolio-metrics.md`）。
 *
 * `weightedYieldPercent`（§3.3）と `costBasisYieldPercent`（§3.4）は係数
 * （`÷100` と `÷10000`）を取り違えやすい（T-088 レビュー指摘）。手計算する期待値は
 * 設計書の式をそのまま素朴に計算し、実装側の「分子共有」の変形を経由しない。
 */

describe('calculatePortfolioMetrics', () => {
  it('保有0件: 評価額・評価損益は0、利回り2種とscoreAverageはnull', () => {
    const metrics = calculatePortfolioMetrics([]);
    expect(metrics.totalValueSen).toBe(0);
    expect(metrics.evaluableValueCount).toBe(0);
    expect(metrics.unrealizedGainLossSen).toBe(0);
    expect(metrics.weightedYieldPercent).toBeNull();
    expect(metrics.costBasisYieldPercent).toBeNull();
    expect(metrics.yieldEvaluableHoldingCount).toBe(0);
    expect(metrics.scoreAverage).toBeNull();
  });

  it('全銘柄の株価が未取得(currentPriceSen=null): 評価額・利回りは算出不能だがscoreAverageは出る', () => {
    const holdings: Holding[] = [
      {
        quantity: 10,
        acquisitionPriceSen: 100_000,
        currentPriceSen: null,
        dividendYieldBp: 300,
        totalScore: 60,
      },
      {
        quantity: 5,
        acquisitionPriceSen: 200_000,
        currentPriceSen: null,
        dividendYieldBp: 150,
        totalScore: 40,
      },
    ];
    const metrics = calculatePortfolioMetrics(holdings);
    expect(metrics.totalValueSen).toBe(0);
    expect(metrics.evaluableValueCount).toBe(0);
    expect(metrics.unrealizedGainLossSen).toBe(0);
    expect(metrics.weightedYieldPercent).toBeNull();
    expect(metrics.costBasisYieldPercent).toBeNull();
    expect(metrics.yieldEvaluableHoldingCount).toBe(0);
    expect(metrics.scoreAverage).toBe(50); // (60+40)/2。保有はあるのでnullにしない
  });

  it('全銘柄の配当利回りが判定不能(dividendYieldBp=null): 評価額はあるが利回り2種はnull', () => {
    const holdings: Holding[] = [
      {
        quantity: 10,
        acquisitionPriceSen: 80_000,
        currentPriceSen: 100_000,
        dividendYieldBp: null,
        totalScore: 60,
      },
      {
        quantity: 5,
        acquisitionPriceSen: 150_000,
        currentPriceSen: 200_000,
        dividendYieldBp: null,
        totalScore: 40,
      },
    ];
    const metrics = calculatePortfolioMetrics(holdings);
    expect(metrics.totalValueSen).toBe(10 * 100_000 + 5 * 200_000);
    expect(metrics.evaluableValueCount).toBe(2);
    expect(metrics.weightedYieldPercent).toBeNull();
    expect(metrics.costBasisYieldPercent).toBeNull();
    expect(metrics.yieldEvaluableHoldingCount).toBe(0);
  });

  it('無配銘柄(dividendYieldBp=0)は除外せず0として計算に含める', () => {
    const zeroYield: Holding = {
      quantity: 10,
      acquisitionPriceSen: 40_000,
      currentPriceSen: 50_000,
      dividendYieldBp: 0,
      totalScore: 50,
    };
    const otherYield: Holding = {
      quantity: 5,
      acquisitionPriceSen: 80_000,
      currentPriceSen: 100_000,
      dividendYieldBp: 200,
      totalScore: 50,
    };
    const metrics = calculatePortfolioMetrics([zeroYield, otherYield]);
    // 無配銘柄も対象集合に含まれる(2件)。除外されるなら1件になってしまう
    expect(metrics.yieldEvaluableHoldingCount).toBe(2);
    const valueZero = 10 * 50_000;
    const valueOther = 5 * 100_000;
    const expectedWeighted = (valueZero * 0 + valueOther * 200) / (valueZero + valueOther) / 100;
    expect(metrics.weightedYieldPercent).toBe(expectedWeighted);
    const costZero = zeroYield.quantity * zeroYield.acquisitionPriceSen;
    const costOther = otherYield.quantity * otherYield.acquisitionPriceSen;
    const expectedCostBasis = (valueZero * 0 + valueOther * 200) / (costZero + costOther) / 100;
    expect(metrics.costBasisYieldPercent).toBe(expectedCostBasis);
  });

  it('評価額がnullの銘柄1件・非nullの銘柄1件が混在: totalValueSenは非null分のみ', () => {
    const missingPrice: Holding = {
      quantity: 10,
      acquisitionPriceSen: 50_000,
      currentPriceSen: null,
      dividendYieldBp: 100,
      totalScore: 50,
    };
    const hasPrice: Holding = {
      quantity: 5,
      acquisitionPriceSen: 80_000,
      currentPriceSen: 100_000,
      dividendYieldBp: 200,
      totalScore: 50,
    };
    const metrics = calculatePortfolioMetrics([missingPrice, hasPrice]);
    expect(metrics.totalValueSen).toBe(5 * 100_000);
    expect(metrics.evaluableValueCount).toBe(1);
  });

  it('評価損益が負(取得単価>現在株価)', () => {
    const holding: Holding = {
      quantity: 10,
      acquisitionPriceSen: 100_000,
      currentPriceSen: 80_000,
      dividendYieldBp: 100,
      totalScore: 50,
    };
    const metrics = calculatePortfolioMetrics([holding]);
    expect(metrics.unrealizedGainLossSen).toBe(10 * 80_000 - 10 * 100_000);
    expect(metrics.unrealizedGainLossSen).toBeLessThan(0);
  });

  it('評価損益が正(含み益。取得単価<現在株価)', () => {
    const holding: Holding = {
      quantity: 10,
      acquisitionPriceSen: 80_000,
      currentPriceSen: 100_000,
      dividendYieldBp: 100,
      totalScore: 50,
    };
    const metrics = calculatePortfolioMetrics([holding]);
    expect(metrics.unrealizedGainLossSen).toBe(10 * 100_000 - 10 * 80_000);
    expect(metrics.unrealizedGainLossSen).toBeGreaterThan(0);
  });

  it('評価損益がちょうど0(取得単価=現在株価。境界値)', () => {
    const holding: Holding = {
      quantity: 10,
      acquisitionPriceSen: 100_000,
      currentPriceSen: 100_000,
      dividendYieldBp: 100,
      totalScore: 50,
    };
    const metrics = calculatePortfolioMetrics([holding]);
    expect(metrics.unrealizedGainLossSen).toBe(0);
  });

  it('weightedYieldPercentが設計書§3.3の式(素朴な手計算)と一致する', () => {
    const h1: Holding = {
      quantity: 100,
      acquisitionPriceSen: 90_000,
      currentPriceSen: 100_000,
      dividendYieldBp: 400,
      totalScore: 50,
    };
    const h2: Holding = {
      quantity: 50,
      acquisitionPriceSen: 80_000,
      currentPriceSen: 200_000,
      dividendYieldBp: 250,
      totalScore: 50,
    };
    const metrics = calculatePortfolioMetrics([h1, h2]);

    // 設計書§3.3をそのまま素朴に計算する(実装の分子共有ロジックを経由しない)
    const value1 = h1.quantity * (h1.currentPriceSen as number);
    const value2 = h2.quantity * (h2.currentPriceSen as number);
    const numerator =
      value1 * (h1.dividendYieldBp as number) + value2 * (h2.dividendYieldBp as number);
    const denominator = value1 + value2;
    const expected = numerator / denominator / 100;

    expect(expected).toBe(3.25); // 手計算の検算(混入バグ検出用の固定値)
    expect(metrics.weightedYieldPercent).toBe(expected);
  });

  it('costBasisYieldPercentが設計書§3.4の式(素朴な手計算・÷10000を経由)と一致する', () => {
    const h1: Holding = {
      quantity: 100,
      acquisitionPriceSen: 90_000,
      currentPriceSen: 100_000,
      dividendYieldBp: 400,
      totalScore: 50,
    };
    const h2: Holding = {
      quantity: 50,
      acquisitionPriceSen: 80_000,
      currentPriceSen: 200_000,
      dividendYieldBp: 250,
      totalScore: 50,
    };
    const metrics = calculatePortfolioMetrics([h1, h2]);

    // 設計書§3.4をそのまま素朴に計算する: 年間配当ᵢ = 評価額ᵢ×bpᵢ÷10000、分母は取得原価合計
    const value1 = h1.quantity * (h1.currentPriceSen as number);
    const value2 = h2.quantity * (h2.currentPriceSen as number);
    const annualDividend1 = (value1 * (h1.dividendYieldBp as number)) / 10_000;
    const annualDividend2 = (value2 * (h2.dividendYieldBp as number)) / 10_000;
    const cost1 = h1.quantity * h1.acquisitionPriceSen;
    const cost2 = h2.quantity * h2.acquisitionPriceSen;
    const expected = ((annualDividend1 + annualDividend2) / (cost1 + cost2)) * 100;

    expect(expected).toBe(5); // weightedYieldPercent(3.25)とは異なる値。係数取り違えを検出できる
    expect(metrics.costBasisYieldPercent).toBe(expected);
  });

  it('yieldEvaluableHoldingCountは対象銘柄0件でもnullではなく0を返す', () => {
    const missingPrice: Holding = {
      quantity: 10,
      acquisitionPriceSen: 50_000,
      currentPriceSen: null,
      dividendYieldBp: 100,
      totalScore: 50,
    };
    const missingYield: Holding = {
      quantity: 5,
      acquisitionPriceSen: 80_000,
      currentPriceSen: 100_000,
      dividendYieldBp: null,
      totalScore: 50,
    };
    const metrics = calculatePortfolioMetrics([missingPrice, missingYield]);
    expect(metrics.yieldEvaluableHoldingCount).toBe(0);
    expect(metrics.yieldEvaluableHoldingCount).not.toBeNull();
    expect(metrics.weightedYieldPercent).toBeNull();
    expect(metrics.costBasisYieldPercent).toBeNull();
  });

  it('scoreAverageは保有数量で重み付けしない単純平均', () => {
    const huge: Holding = {
      quantity: 1_000,
      acquisitionPriceSen: 100_000,
      currentPriceSen: 100_000,
      dividendYieldBp: 100,
      totalScore: 0,
    };
    const tiny: Holding = {
      quantity: 1,
      acquisitionPriceSen: 100_000,
      currentPriceSen: 100_000,
      dividendYieldBp: 100,
      totalScore: 100,
    };
    const metrics = calculatePortfolioMetrics([huge, tiny]);
    // 数量加重なら0に近い値になるが、単純平均なので50
    expect(metrics.scoreAverage).toBe(50);
  });

  it('保有100件でも正しく合算できる(1回のループ)', () => {
    const holdings: Holding[] = Array.from({ length: 100 }, () => ({
      quantity: 10,
      acquisitionPriceSen: 100_000,
      currentPriceSen: 100_000,
      dividendYieldBp: 200,
      totalScore: 70,
    }));
    const metrics = calculatePortfolioMetrics(holdings);
    expect(metrics.totalValueSen).toBe(100 * 10 * 100_000);
    expect(metrics.evaluableValueCount).toBe(100);
    expect(metrics.unrealizedGainLossSen).toBe(0); // 取得単価=現在株価
    expect(metrics.yieldEvaluableHoldingCount).toBe(100);
    expect(metrics.weightedYieldPercent).toBe(2); // 200bp = 2%。全銘柄同一値なので加重しても同じ
    expect(metrics.costBasisYieldPercent).toBe(2);
    expect(metrics.scoreAverage).toBe(70);
  });

  it('currentPriceSenが不正値(負値・非安全整数)ならnullと同じ扱いになる(防御的ガード)', () => {
    const negative: Holding = {
      quantity: 10,
      acquisitionPriceSen: 50_000,
      currentPriceSen: -1,
      dividendYieldBp: 100,
      totalScore: 50,
    };
    const nonInteger: Holding = {
      quantity: 10,
      acquisitionPriceSen: 50_000,
      currentPriceSen: 1.5,
      dividendYieldBp: 100,
      totalScore: 50,
    };
    const metrics = calculatePortfolioMetrics([negative, nonInteger]);
    // 両方とも「評価額算出不能」としてnullと同じ扱いになり、合計から除外される
    expect(metrics.totalValueSen).toBe(0);
    expect(metrics.evaluableValueCount).toBe(0);
    expect(metrics.unrealizedGainLossSen).toBe(0);
    expect(metrics.weightedYieldPercent).toBeNull();
    expect(metrics.yieldEvaluableHoldingCount).toBe(0);
  });

  it('dividendYieldBpが不正値(非安全整数)ならnullと同じ扱いになる(防御的ガード)', () => {
    const holding: Holding = {
      quantity: 10,
      acquisitionPriceSen: 50_000,
      currentPriceSen: 100_000,
      dividendYieldBp: 1.5,
      totalScore: 50,
    };
    const metrics = calculatePortfolioMetrics([holding]);
    // 評価額自体は算出できる(価格は正常値)。利回り側の対象集合からのみ除外される
    expect(metrics.totalValueSen).toBe(10 * 100_000);
    expect(metrics.evaluableValueCount).toBe(1);
    expect(metrics.yieldEvaluableHoldingCount).toBe(0);
    expect(metrics.weightedYieldPercent).toBeNull();
    expect(metrics.costBasisYieldPercent).toBeNull();
  });

  it('dividendYieldBpが不正値(負値)ならnullと同じ扱いになる(防御的ガード)', () => {
    const holding: Holding = {
      quantity: 10,
      acquisitionPriceSen: 50_000,
      currentPriceSen: 100_000,
      dividendYieldBp: -1,
      totalScore: 50,
    };
    const metrics = calculatePortfolioMetrics([holding]);
    // 評価額自体は算出できる(価格は正常値)。利回り側の対象集合からのみ除外される
    expect(metrics.totalValueSen).toBe(10 * 100_000);
    expect(metrics.evaluableValueCount).toBe(1);
    expect(metrics.yieldEvaluableHoldingCount).toBe(0);
    expect(metrics.weightedYieldPercent).toBeNull();
    expect(metrics.costBasisYieldPercent).toBeNull();
  });

  it('桁あふれ境界: 現実的な最大規模(業務上限MAX_PRICE_SENの株価×大口保有)でも安全整数のまま正しく計算する', () => {
    // MAX_PRICE_SEN(=1億銭=100万円/株)を業務上の株価上限として使い、大口の保有数量と
    // 掛け合わせても Number.isSafeInteger の範囲に収まることを確認する(§2.3のオーバーフロー対策)
    const quantity = 100_000; // 10万株。個人ポートフォリオとしては極端に大きい想定の保有数量
    const currentPriceSen = MAX_PRICE_SEN;
    const acquisitionPriceSen = 50_000_000; // 50万円/株
    const holding: Holding = {
      quantity,
      acquisitionPriceSen,
      currentPriceSen,
      dividendYieldBp: 300,
      totalScore: 50,
    };

    const expectedValue = quantity * currentPriceSen;
    const expectedCost = quantity * acquisitionPriceSen;
    expect(Number.isSafeInteger(expectedValue)).toBe(true);
    expect(Number.isSafeInteger(expectedCost)).toBe(true);

    const metrics = calculatePortfolioMetrics([holding]);
    expect(metrics.totalValueSen).toBe(expectedValue);
    expect(metrics.unrealizedGainLossSen).toBe(expectedValue - expectedCost);
    expect(Number.isSafeInteger(metrics.totalValueSen)).toBe(true);
  });

  it('桁あふれ境界: yieldNumerator(valueSen×dividendYieldBp)も現実的な高配当bp×最大株価×大口保有で安全整数に収まる', () => {
    // yieldNumeratorはtotalValueSenとは別に、valueSen×dividendYieldBpという掛け算を持つため
    // 独立にオーバーフロー境界を確認する必要がある(§5コメント参照)。MAX_PRICE_SENの株価と
    // 高配当bp(1000bp=10%相当)の組み合わせでもNumber.isSafeIntegerの範囲に収まることを確認する
    const quantity = 90_000; // 9万株。yieldNumeratorがMAX_SAFE_INTEGERに迫る規模の大口保有
    const currentPriceSen = MAX_PRICE_SEN;
    const dividendYieldBp = 1000; // 10%相当の高配当bp
    const holding: Holding = {
      quantity,
      acquisitionPriceSen: 50_000_000,
      currentPriceSen,
      dividendYieldBp,
      totalScore: 50,
    };

    const expectedValue = quantity * currentPriceSen;
    const expectedNumerator = expectedValue * dividendYieldBp;
    expect(Number.isSafeInteger(expectedValue)).toBe(true);
    expect(Number.isSafeInteger(expectedNumerator)).toBe(true);

    const metrics = calculatePortfolioMetrics([holding]);
    // 単一銘柄なのでweightedDenominator=valueSen。dividendYieldBp/100に一致するはず
    expect(metrics.weightedYieldPercent).toBe(dividendYieldBp / 100);
  });
});

/**
 * `describeHoldingValuation`（T-103。設計書に無い拡張。`portfolio-metrics.ts` のTODO参照）。
 * `GET /api/portfolios/:id` の `holdings[]` 1件ぶんの評価額・評価損益・配当利回り(%)。
 */
describe('describeHoldingValuation', () => {
  it('価格未取得(currentPriceSen=null): valueSen/unrealizedGainLossSenともnull', () => {
    const holding: Holding = {
      quantity: 100,
      acquisitionPriceSen: 280_000,
      currentPriceSen: null,
      dividendYieldBp: 300,
      totalScore: 62,
    };
    const valuation = describeHoldingValuation(holding);
    expect(valuation.valueSen).toBeNull();
    expect(valuation.unrealizedGainLossSen).toBeNull();
    expect(valuation.dividendYieldPercent).toBe(3);
  });

  it('利回り判定不能(dividendYieldBp=null): dividendYieldPercentのみnull。valueSenは算出される', () => {
    const holding: Holding = {
      quantity: 100,
      acquisitionPriceSen: 280_000,
      currentPriceSen: 314_200,
      dividendYieldBp: null,
      totalScore: 62,
    };
    const valuation = describeHoldingValuation(holding);
    expect(valuation.valueSen).toBe(100 * 314_200);
    expect(valuation.unrealizedGainLossSen).toBe(100 * 314_200 - 100 * 280_000);
    expect(valuation.dividendYieldPercent).toBeNull();
  });

  it('無配(dividendYieldBp=0): nullにせず0%として計算に含める', () => {
    const holding: Holding = {
      quantity: 10,
      acquisitionPriceSen: 100_000,
      currentPriceSen: 100_000,
      dividendYieldBp: 0,
      totalScore: 50,
    };
    const valuation = describeHoldingValuation(holding);
    expect(valuation.dividendYieldPercent).toBe(0);
    expect(valuation.dividendYieldPercent).not.toBeNull();
  });

  it('評価損益が負(含み損): 符号の正規化をしない', () => {
    const holding: Holding = {
      quantity: 100,
      acquisitionPriceSen: 320_000,
      currentPriceSen: 280_000,
      dividendYieldBp: 300,
      totalScore: 50,
    };
    const valuation = describeHoldingValuation(holding);
    expect(valuation.unrealizedGainLossSen).toBe(100 * 280_000 - 100 * 320_000);
    expect(valuation.unrealizedGainLossSen).toBeLessThan(0);
  });

  it('価格・利回りとも不正値(負値・非安全整数)ならnullと同じ扱いになる(防御的ガード)', () => {
    const holding: Holding = {
      quantity: 10,
      acquisitionPriceSen: 50_000,
      currentPriceSen: -1,
      dividendYieldBp: 1.5,
      totalScore: 50,
    };
    const valuation = describeHoldingValuation(holding);
    expect(valuation.valueSen).toBeNull();
    expect(valuation.unrealizedGainLossSen).toBeNull();
    expect(valuation.dividendYieldPercent).toBeNull();
  });

  it('portfolio-api.mdのレスポンス例(トヨタ自動車)と一致する', () => {
    const holding: Holding = {
      quantity: 100,
      acquisitionPriceSen: 280_000,
      currentPriceSen: 314_200,
      dividendYieldBp: 318,
      totalScore: 62,
    };
    const valuation = describeHoldingValuation(holding);
    expect(valuation.valueSen).toBe(31_420_000);
    expect(valuation.unrealizedGainLossSen).toBe(3_420_000);
    expect(valuation.dividendYieldPercent).toBe(3.18);
  });
});
