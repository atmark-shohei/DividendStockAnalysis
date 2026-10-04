import { describe, expect, it } from 'vitest';

import { PAYOUT_RATIO_BANDS } from '@/domain/scoring/bands';
import {
  type PayoutRatioInput,
  type PayoutRatioSideInput,
  calculatePayoutRatio,
  payoutRatioToMetricScore,
} from '@/domain/scoring/payout-ratio';
import { type ScoreBand } from '@/domain/scoring/score-band';
import { sen, senOrNull } from '../../helpers/sen';

/**
 * 指標③ 予想配当性向・実績配当性向。
 * 仕様: docs/02_design/logic/payout-ratio-scoring.md
 *
 * この指標だけ 10段（1点を返す経路が無い）。原典の欠陥（赤字企業が満点）を
 * §0.3 / §0.4 で塞いである。
 *
 * 2026-08-06 決定（§7）: 実績側の追加とソース選択（`useActualForScoring`）。
 * §6.1〜6.4 は予想・実績どちらの組でも成立することを検証するため、
 * 実績側を空（値・年度すべて null）にしたまま `forecast` 側で
 * 従来どおりのアサーションを行う（actual 側を空にしておけば、フォールバック無しで
 * 予想側の結果がそのまま採点に採用される）。
 *
 * 2026-09-23（T-108 / §10）: 入力に年度が加わった。§6.1〜6.6 の既存ケースは年度の食い違いを
 * 作らないよう、配当・EPS に同じ年度（`FY`）を渡す（期待値は T-108 前から変えていない）。
 */

/** EPS 10,000 銭（100円）に対する配当から性向を作る。1% = 100 銭 */
const EPS_SEN = 10_000;

/** 既存ケースで配当・EPS の両方に渡す決算年度（食い違いを作らない） */
const FY = 2026;

const EMPTY_SIDE = {
  dividendSen: null,
  dividendFiscalYear: null,
  epsSen: null,
  epsFiscalYear: null,
};

const scoreAt = (dividendSen: number, epsSen = EPS_SEN) =>
  calculatePayoutRatio({
    forecast: {
      dividendSen: sen(dividendSen),
      dividendFiscalYear: FY,
      epsSen: sen(epsSen),
      epsFiscalYear: FY,
    },
    actual: EMPTY_SIDE,
    useActualForScoring: false,
  }).forecast.metric.score;

describe('③ 予想配当性向 — 6.1 境界値ちょうど', () => {
  it.each([
    { percent: 0.01, points: 10 },
    { percent: 25, points: 9 },
    { percent: 30, points: 8 },
    { percent: 35, points: 7 },
    { percent: 40, points: 6 },
    { percent: 45, points: 5 },
    { percent: 50, points: 4 },
    { percent: 55, points: 3 },
    { percent: 60, points: 2 },
    { percent: 70, points: 0 },
  ])('配当性向 $percent% ちょうどは $points 点', ({ percent, points }) => {
    expect(scoreAt(Math.round((EPS_SEN * percent) / 100))).toBe(points);
  });

  it('25% ちょうどは 9点。24.99% は 10点', () => {
    expect(scoreAt(2_500)).toBe(9);
    expect(scoreAt(2_499)).toBe(10);
  });

  it('69.99% は 2点。この指標に 1点の行は無い（意図的 / 設計書 §7）', () => {
    expect(scoreAt(6_999)).toBe(2);
    expect(scoreAt(7_000)).toBe(0);
  });

  it('どの入力でも 1点は返らない', () => {
    for (let dividendSen = 0; dividendSen <= 12_000; dividendSen += 7) {
      expect(scoreAt(dividendSen)).not.toBe(1);
    }
  });
});

describe('③ 予想配当性向 — 6.2 負の値', () => {
  it('EPS が負（赤字）なら 0点。原典のままだと満点を取った（§0.3）', () => {
    const result = calculatePayoutRatio({
      forecast: {
        dividendSen: sen(2_000),
        dividendFiscalYear: FY,
        epsSen: sen(-10_000),
        epsFiscalYear: FY,
      },
      actual: EMPTY_SIDE,
      useActualForScoring: false,
    });
    expect(result.forecast.metric.score).toBe(0);
    expect(result.forecast.metric.unavailableReason).toBeNull();
  });

  it('赤字でも判定不能にはしない。0点であることに意味がある', () => {
    const result = calculatePayoutRatio({
      forecast: {
        dividendSen: sen(2_000),
        dividendFiscalYear: FY,
        epsSen: sen(-1),
        epsFiscalYear: FY,
      },
      actual: EMPTY_SIDE,
      useActualForScoring: false,
    });
    expect(result.forecast.metric.score).toBe(0);
  });

  it('配当が負は制度上ありえないのでデータ不良として判定不能', () => {
    const result = calculatePayoutRatio({
      forecast: {
        dividendSen: sen(-100),
        dividendFiscalYear: FY,
        epsSen: sen(EPS_SEN),
        epsFiscalYear: FY,
      },
      actual: EMPTY_SIDE,
      useActualForScoring: false,
    });
    expect(result.forecast.metric.score).toBeNull();
    expect(result.forecast.metric.unavailableReason).toBe('input-invalid');
  });

  it('実績側でも同じ規則が成立する（§6.2「予想・実績どちらの組でも成立すること」）', () => {
    const result = calculatePayoutRatio({
      forecast: EMPTY_SIDE,
      actual: {
        dividendSen: sen(2_000),
        dividendFiscalYear: FY,
        epsSen: sen(-10_000),
        epsFiscalYear: FY,
      },
      useActualForScoring: true,
    });
    expect(result.actual.metric.score).toBe(0);
    expect(result.actual.metric.unavailableReason).toBeNull();
  });
});

describe('③ 予想配当性向 — 6.3 無配・0', () => {
  it('無配（配当 0）は 0点（§0.4）。性向 0% は数値上は最上位区分だが採らない', () => {
    const result = calculatePayoutRatio({
      forecast: {
        dividendSen: sen(0),
        dividendFiscalYear: FY,
        epsSen: sen(EPS_SEN),
        epsFiscalYear: FY,
      },
      actual: EMPTY_SIDE,
      useActualForScoring: false,
    });
    expect(result.forecast.metric.score).toBe(0);
    expect(result.forecast.metric.value).toBe(0);
    expect(result.forecast.metric.unavailableReason).toBeNull();
  });

  it('配当が正で性向がほぼ 0% なら 10点。無配とは区別する', () => {
    // EPS が極端に大きい会社。性向 0.00001% でも「無配」ではない
    const result = calculatePayoutRatio({
      forecast: {
        dividendSen: sen(1),
        dividendFiscalYear: FY,
        epsSen: sen(1_000_000_000),
        epsFiscalYear: FY,
      },
      actual: EMPTY_SIDE,
      useActualForScoring: false,
    });
    expect(result.forecast.metric.score).toBe(10);
  });

  it('EPS が 0 はゼロ除算で判定不能。0点ではない', () => {
    const result = calculatePayoutRatio({
      forecast: {
        dividendSen: sen(2_000),
        dividendFiscalYear: FY,
        epsSen: sen(0),
        epsFiscalYear: FY,
      },
      actual: EMPTY_SIDE,
      useActualForScoring: false,
    });
    expect(result.forecast.metric.score).toBeNull();
    expect(result.forecast.metric.unavailableReason).toBe('division-by-zero');
  });

  it('実績側でも同じ規則が成立する', () => {
    const result = calculatePayoutRatio({
      forecast: EMPTY_SIDE,
      actual: {
        dividendSen: sen(0),
        dividendFiscalYear: FY,
        epsSen: sen(EPS_SEN),
        epsFiscalYear: FY,
      },
      useActualForScoring: true,
    });
    expect(result.actual.metric.score).toBe(0);
    expect(result.actual.metric.value).toBe(0);
  });
});

describe('③ 予想配当性向 — 6.4 データ欠損', () => {
  it.each([
    { label: '配当が null', dividend: null, eps: EPS_SEN },
    { label: 'EPS が null', dividend: 2_000, eps: null },
  ])('$label なら判定不能。0 を返さない', ({ dividend, eps }) => {
    const result = calculatePayoutRatio({
      forecast: {
        dividendSen: dividend === null ? null : sen(dividend),
        dividendFiscalYear: FY,
        epsSen: eps === null ? null : sen(eps),
        epsFiscalYear: FY,
      },
      actual: EMPTY_SIDE,
      useActualForScoring: false,
    });
    expect(result.forecast.metric.score).toBeNull();
    expect(result.forecast.metric.value).toBeNull();
    expect(result.forecast.metric.unavailableReason).toBe('input-missing');
  });

  it('予想の年度と実績の年度が異なっていても、両方が独立に判定できる（片方の欠損が他方に影響しない）', () => {
    const result = calculatePayoutRatio({
      forecast: EMPTY_SIDE,
      actual: {
        dividendSen: sen(2_000),
        dividendFiscalYear: FY,
        epsSen: sen(EPS_SEN),
        epsFiscalYear: FY,
      },
      useActualForScoring: false,
    });
    expect(result.forecast.metric.unavailableReason).toBe('input-missing');
    expect(result.actual.metric.score).not.toBeNull();
  });
});

describe('③ 予想配当性向 — 6.5 ソース選択', () => {
  it('useActualForScoring: false かつ予想が判定可能なら予想を採用する', () => {
    const result = calculatePayoutRatio({
      forecast: {
        dividendSen: sen(2_000),
        dividendFiscalYear: FY,
        epsSen: sen(EPS_SEN),
        epsFiscalYear: FY,
      },
      actual: {
        dividendSen: sen(4_000),
        dividendFiscalYear: FY,
        epsSen: sen(EPS_SEN),
        epsFiscalYear: FY,
      },
      useActualForScoring: false,
    });
    expect(result.source).toBe('forecast');
    expect(result.score).toBe(result.forecast.metric.score);
    expect(result.value).toBe(result.forecast.metric.value);
  });

  it('useActualForScoring: false かつ予想が判定不能・実績が判定可能なら実績にフォールバックする', () => {
    const result = calculatePayoutRatio({
      forecast: EMPTY_SIDE,
      actual: {
        dividendSen: sen(4_000),
        dividendFiscalYear: FY,
        epsSen: sen(EPS_SEN),
        epsFiscalYear: FY,
      },
      useActualForScoring: false,
    });
    expect(result.source).toBe('actual');
    expect(result.score).toBe(result.actual.metric.score);
    expect(result.value).toBe(result.actual.metric.value);
  });

  it('useActualForScoring: false かつ両方が判定不能なら score/value/source すべて null', () => {
    const result = calculatePayoutRatio({
      forecast: EMPTY_SIDE,
      actual: EMPTY_SIDE,
      useActualForScoring: false,
    });
    expect(result.score).toBeNull();
    expect(result.value).toBeNull();
    expect(result.source).toBeNull();
  });

  it('useActualForScoring: true なら実績を強制採用する（予想も判定可能でも）', () => {
    const result = calculatePayoutRatio({
      forecast: {
        dividendSen: sen(2_000),
        dividendFiscalYear: FY,
        epsSen: sen(EPS_SEN),
        epsFiscalYear: FY,
      },
      actual: {
        dividendSen: sen(4_000),
        dividendFiscalYear: FY,
        epsSen: sen(EPS_SEN),
        epsFiscalYear: FY,
      },
      useActualForScoring: true,
    });
    expect(result.source).toBe('actual');
    expect(result.score).toBe(result.actual.metric.score);
    expect(result.value).toBe(result.actual.metric.value);
  });

  it('useActualForScoring: true かつ実績が判定不能なら score/source は null（予想へフォールバックしない）', () => {
    const result = calculatePayoutRatio({
      forecast: {
        dividendSen: sen(2_000),
        dividendFiscalYear: FY,
        epsSen: sen(EPS_SEN),
        epsFiscalYear: FY,
      },
      actual: EMPTY_SIDE,
      useActualForScoring: true,
    });
    expect(result.score).toBeNull();
    expect(result.value).toBeNull();
    expect(result.source).toBeNull();
    // 予想側は判定できているが、採用されていないことを確認する
    expect(result.forecast.metric.score).not.toBeNull();
  });
});

describe('③ 予想配当性向 — 6.6 表示用の内訳', () => {
  it('採用元と無関係に forecast/actual 両方が常に判定結果を持つ', () => {
    const result = calculatePayoutRatio({
      forecast: {
        dividendSen: sen(2_000),
        dividendFiscalYear: FY,
        epsSen: sen(EPS_SEN),
        epsFiscalYear: FY,
      },
      actual: {
        dividendSen: sen(4_000),
        dividendFiscalYear: FY,
        epsSen: sen(EPS_SEN),
        epsFiscalYear: FY,
      },
      useActualForScoring: false,
    });
    expect(result.forecast.metric.score).not.toBeNull();
    expect(result.actual.metric.score).not.toBeNull();
  });

  it('予想が判定不能でも actual には実績側の判定結果が入る', () => {
    const result = calculatePayoutRatio({
      forecast: EMPTY_SIDE,
      actual: {
        dividendSen: sen(4_000),
        dividendFiscalYear: FY,
        epsSen: sen(EPS_SEN),
        epsFiscalYear: FY,
      },
      useActualForScoring: false,
    });
    expect(result.forecast.metric.unavailableReason).toBe('input-missing');
    expect(result.actual.metric.score).not.toBeNull();
  });

  it('実績が判定不能でも forecast には予想側の判定結果が入る', () => {
    const result = calculatePayoutRatio({
      forecast: {
        dividendSen: sen(2_000),
        dividendFiscalYear: FY,
        epsSen: sen(EPS_SEN),
        epsFiscalYear: FY,
      },
      actual: EMPTY_SIDE,
      useActualForScoring: true,
    });
    expect(result.forecast.metric.score).not.toBeNull();
    expect(result.actual.metric.unavailableReason).toBe('input-missing');
  });
});

describe('③ payoutRatioToMetricScore — 採点集計用の変換', () => {
  it('source が forecast のとき採用値をそのまま MetricScore にする', () => {
    const result = calculatePayoutRatio({
      forecast: {
        dividendSen: sen(2_000),
        dividendFiscalYear: FY,
        epsSen: sen(EPS_SEN),
        epsFiscalYear: FY,
      },
      actual: EMPTY_SIDE,
      useActualForScoring: false,
    });
    const metric = payoutRatioToMetricScore(result);
    expect(metric.score).toBe(result.score);
    expect(metric.value).toBe(result.value);
    expect(metric.unavailableReason).toBeNull();
  });

  it('source が actual のとき採用値をそのまま MetricScore にする', () => {
    const result = calculatePayoutRatio({
      forecast: EMPTY_SIDE,
      actual: {
        dividendSen: sen(4_000),
        dividendFiscalYear: FY,
        epsSen: sen(EPS_SEN),
        epsFiscalYear: FY,
      },
      useActualForScoring: true,
    });
    const metric = payoutRatioToMetricScore(result);
    expect(metric.score).toBe(result.score);
    expect(metric.value).toBe(result.value);
    expect(metric.unavailableReason).toBeNull();
  });

  it('両方判定不能のとき、予想側に理由があれば予想側の理由を使う（§0.2 の解釈 / 設計書 §5.1 決定4）', () => {
    const result = calculatePayoutRatio({
      forecast: {
        dividendSen: sen(2_000),
        dividendFiscalYear: FY,
        epsSen: sen(0),
        epsFiscalYear: FY,
      }, // division-by-zero
      actual: { dividendSen: null, dividendFiscalYear: null, epsSen: null, epsFiscalYear: null }, // input-missing
      useActualForScoring: false,
    });
    const metric = payoutRatioToMetricScore(result);
    expect(metric.score).toBeNull();
    expect(metric.unavailableReason).toBe('division-by-zero');
  });

  it(
    'useActualForScoring: true で予想は判定可能・実績が判定不能のとき、実績側の理由に' +
      'フォールバックする（設計書に明示が無い拡張。§0.2 の Manager 決定どおりの実装）',
    () => {
      const result = calculatePayoutRatio({
        forecast: {
          dividendSen: sen(2_000),
          dividendFiscalYear: FY,
          epsSen: sen(EPS_SEN),
          epsFiscalYear: FY,
        }, // 判定可能（理由なし）
        actual: {
          dividendSen: sen(2_000),
          dividendFiscalYear: FY,
          epsSen: sen(0),
          epsFiscalYear: FY,
        }, // division-by-zero
        useActualForScoring: true,
      });
      const metric = payoutRatioToMetricScore(result);
      expect(metric.score).toBeNull();
      expect(metric.unavailableReason).toBe('division-by-zero');
    },
  );
});

describe('③ 予想配当性向 — カスタム bands（T-101 指標カスタマイズ）', () => {
  const ALWAYS_SEVEN: readonly ScoreBand[] = [
    { minInclusive: null, maxExclusive: null, points: 7 },
  ];

  it('省略時はデフォルト定数で判定する（25%ちょうどは9点）', () => {
    expect(scoreAt(2_500)).toBe(9);
  });

  it('カスタム bands は予想・実績の両側に同じ表を渡す（デフォルトなら9点になる入力が7点になる）', () => {
    const result = calculatePayoutRatio(
      {
        forecast: {
          dividendSen: sen(2_500),
          dividendFiscalYear: FY,
          epsSen: sen(EPS_SEN),
          epsFiscalYear: FY,
        },
        actual: {
          dividendSen: sen(2_500),
          dividendFiscalYear: FY,
          epsSen: sen(EPS_SEN),
          epsFiscalYear: FY,
        },
        useActualForScoring: false,
      },
      ALWAYS_SEVEN,
    );
    expect(result.forecast.metric.score).toBe(7);
    expect(result.actual.metric.score).toBe(7);
    expect(result.score).toBe(7);
  });
});

// ---------------------------------------------------------------------------
// T-108（設計書 §10 / §6.4.1）: 計算根拠・年度突き合わせの内包・採点に使った区分表
// ---------------------------------------------------------------------------

/** 片側の入力を作る。年度は既定で両方 `FY`（食い違いなし） */
function side(
  dividendSen: number | null,
  epsSen: number | null,
  years: { dividend?: number | null; eps?: number | null } = {},
): PayoutRatioSideInput {
  return {
    dividendSen: senOrNull(dividendSen),
    dividendFiscalYear: years.dividend === undefined ? FY : years.dividend,
    epsSen: senOrNull(epsSen),
    epsFiscalYear: years.eps === undefined ? FY : years.eps,
  };
}

const SIDES = ['forecast', 'actual'] as const;
type Side = (typeof SIDES)[number];

/** 指定した側だけに入力を置き、もう片側は空にして判定する */
function judgeOn(sideName: Side, input: PayoutRatioSideInput, bands?: readonly ScoreBand[]) {
  const payload: PayoutRatioInput = {
    forecast: sideName === 'forecast' ? input : EMPTY_SIDE,
    actual: sideName === 'actual' ? input : EMPTY_SIDE,
    useActualForScoring: sideName === 'actual',
  };
  const result =
    bands === undefined ? calculatePayoutRatio(payload) : calculatePayoutRatio(payload, bands);
  return { result, sideResult: result[sideName] };
}

describe('③ §10 matchedBandIndex — 境界値ちょうど（点数と同じルックアップ）', () => {
  const cases = [
    {
      name: '性向ほぼ 0%（配当 1 銭・EPS 10億銭）→ 10点・添字0',
      dividend: 1,
      eps: 1_000_000_000,
      points: 10,
      index: 0,
    },
    { name: '24.99% → 10点・添字0', dividend: 2_499, eps: EPS_SEN, points: 10, index: 0 },
    { name: '25.0% ちょうど → 9点・添字1', dividend: 2_500, eps: EPS_SEN, points: 9, index: 1 },
    { name: '60.0% ちょうど → 2点・添字8', dividend: 6_000, eps: EPS_SEN, points: 2, index: 8 },
    { name: '69.99% → 2点・添字8', dividend: 6_999, eps: EPS_SEN, points: 2, index: 8 },
    {
      name: '70.0% ちょうど → 0点・zeroScoreRule null・最下位区分の添字',
      dividend: 7_000,
      eps: EPS_SEN,
      points: 0,
      index: PAYOUT_RATIO_BANDS.length - 1,
    },
  ];

  for (const sideName of SIDES) {
    it.each(cases)(`${sideName}: $name`, ({ dividend, eps, points, index }) => {
      const { result, sideResult } = judgeOn(sideName, side(dividend, eps));
      expect(sideResult.metric.score).toBe(points);
      expect(sideResult.matchedBandIndex).toBe(index);
      expect(result.bands[index]?.points).toBe(sideResult.metric.score);
      expect(sideResult.zeroScoreRule).toBeNull();
      expect(sideResult.fiscalYearMismatch).toBe(false);
    });
  }
});

describe('③ §10 bands — 採点に使った区分表をそのまま返す', () => {
  const ALWAYS_SEVEN: readonly ScoreBand[] = [
    { minInclusive: null, maxExclusive: null, points: 7 },
  ];

  it('省略時は PAYOUT_RATIO_BANDS そのもの（組み立て直さない）', () => {
    const result = calculatePayoutRatio({
      forecast: side(2_500, EPS_SEN),
      actual: EMPTY_SIDE,
      useActualForScoring: false,
    });
    expect(result.bands).toBe(PAYOUT_RATIO_BANDS);
  });

  it('上書き表を渡すと bands はその表の参照で、matchedBandIndex もその表の添字（両側）', () => {
    const result = calculatePayoutRatio(
      { forecast: side(2_500, EPS_SEN), actual: side(4_000, EPS_SEN), useActualForScoring: false },
      ALWAYS_SEVEN,
    );
    expect(result.bands).toBe(ALWAYS_SEVEN);
    expect(result.forecast.matchedBandIndex).toBe(0);
    expect(result.actual.matchedBandIndex).toBe(0);
    expect(result.forecast.metric.score).toBe(7);
  });

  it('両側とも判定不能でも bands は返る', () => {
    const result = calculatePayoutRatio(
      { forecast: EMPTY_SIDE, actual: EMPTY_SIDE, useActualForScoring: false },
      ALWAYS_SEVEN,
    );
    expect(result.source).toBeNull();
    expect(result.bands).toBe(ALWAYS_SEVEN);
  });
});

describe('③ §10 zeroScoreRule — 負の値・無配', () => {
  for (const sideName of SIDES) {
    it(`${sideName}: 赤字（EPS<0）→ 0点・negative-eps・添字 null・evidence の EPS は負のまま`, () => {
      const { sideResult } = judgeOn(sideName, side(2_000, -10_000));
      expect(sideResult.metric.score).toBe(0);
      expect(sideResult.metric.unavailableReason).toBeNull();
      expect(sideResult.zeroScoreRule).toBe('negative-eps');
      expect(sideResult.matchedBandIndex).toBeNull();
      expect(sideResult.evidence.epsSen).toBe(-10_000);
      expect(sideResult.evidence.dividendSen).toBe(2_000);
    });

    it(`${sideName}: 無配（配当 0・EPS>0）→ 0点・no-dividend・添字 null・evidence の配当は 0（null ではない）`, () => {
      const { sideResult } = judgeOn(sideName, side(0, EPS_SEN));
      expect(sideResult.metric.score).toBe(0);
      expect(sideResult.metric.value).toBe(0);
      expect(sideResult.zeroScoreRule).toBe('no-dividend');
      expect(sideResult.matchedBandIndex).toBeNull();
      expect(sideResult.evidence.dividendSen).toBe(0);
    });

    it(`${sideName}: 赤字かつ無配 → 赤字を優先して negative-eps（Y2）`, () => {
      const { sideResult } = judgeOn(sideName, side(0, -10_000));
      expect(sideResult.metric.score).toBe(0);
      // value は現行どおり 0 / 負 * 100 = -0。挙動は変えないので toBe(0) では比べない
      expect(sideResult.metric.value).toEqual(-0);
      expect(sideResult.zeroScoreRule).toBe('negative-eps');
      expect(sideResult.matchedBandIndex).toBeNull();
    });

    it(`${sideName}: 配当が負 → input-invalid・zeroScoreRule null・添字 null・evidence は値・年度のまま（Y2）`, () => {
      const { sideResult } = judgeOn(sideName, side(-100, EPS_SEN));
      expect(sideResult.metric.score).toBeNull();
      expect(sideResult.metric.value).toBeNull();
      expect(sideResult.metric.unavailableReason).toBe('input-invalid');
      expect(sideResult.zeroScoreRule).toBeNull();
      expect(sideResult.matchedBandIndex).toBeNull();
      expect(sideResult.evidence).toEqual({
        dividendSen: -100,
        dividendFiscalYear: FY,
        epsSen: EPS_SEN,
        epsFiscalYear: FY,
      });
    });
  }
});

describe('③ §10 evidence — ゼロ除算・欠損', () => {
  for (const sideName of SIDES) {
    it(`${sideName}: EPS 0 → division-by-zero。evidence の EPS は 0、配当は値のまま`, () => {
      const { sideResult } = judgeOn(sideName, side(2_000, 0));
      expect(sideResult.metric.unavailableReason).toBe('division-by-zero');
      expect(sideResult.metric.score).toBeNull();
      expect(sideResult.evidence.epsSen).toBe(0);
      expect(sideResult.evidence.dividendSen).toBe(2_000);
      expect(sideResult.matchedBandIndex).toBeNull();
      expect(sideResult.zeroScoreRule).toBeNull();
    });

    it(`${sideName}: EPS レコード無し → input-missing・食い違いなし・配当と年度は値のまま`, () => {
      const { sideResult } = judgeOn(sideName, side(2_000, null, { eps: null }));
      expect(sideResult.metric.score).toBeNull();
      expect(sideResult.metric.unavailableReason).toBe('input-missing');
      expect(sideResult.fiscalYearMismatch).toBe(false);
      expect(sideResult.evidence).toEqual({
        dividendSen: 2_000,
        dividendFiscalYear: FY,
        epsSen: null,
        epsFiscalYear: null,
      });
    });

    it(`${sideName}: 配当レコード無し → input-missing・食い違いなし・EPS と年度は値のまま`, () => {
      const { sideResult } = judgeOn(sideName, side(null, EPS_SEN, { dividend: null }));
      expect(sideResult.metric.unavailableReason).toBe('input-missing');
      expect(sideResult.fiscalYearMismatch).toBe(false);
      expect(sideResult.evidence).toEqual({
        dividendSen: null,
        dividendFiscalYear: null,
        epsSen: EPS_SEN,
        epsFiscalYear: FY,
      });
    });
  }

  it('通常判定の evidence は入力の値・年度をそのまま写す', () => {
    const { sideResult } = judgeOn('forecast', side(2_500, EPS_SEN));
    expect(sideResult.evidence).toEqual({
      dividendSen: 2_500,
      dividendFiscalYear: FY,
      epsSen: EPS_SEN,
      epsFiscalYear: FY,
    });
  });
});

describe('③ §6.4.1 年度突き合わせ（期末日跨ぎ相当）— calculatePayoutRatio の内部で判定する', () => {
  const cases = [
    {
      name: '予想 EPS FY2027・予想配当 FY2026',
      sideName: 'forecast',
      dividendYear: 2026,
      epsYear: 2027,
    },
    {
      name: '実績 EPS FY2026・実績配当 FY2025（配当が古い）',
      sideName: 'actual',
      dividendYear: 2025,
      epsYear: 2026,
    },
    {
      name: '実績配当 FY2026・実績 EPS FY2025（EPS が古い）',
      sideName: 'actual',
      dividendYear: 2026,
      epsYear: 2025,
    },
  ] as const;

  it.each(cases)(
    '$name → input-missing・fiscalYearMismatch true・evidence 4 値は null にならない',
    ({ sideName, dividendYear, epsYear }) => {
      const { result, sideResult } = judgeOn(
        sideName,
        side(2_500, EPS_SEN, { dividend: dividendYear, eps: epsYear }),
      );
      expect(sideResult.fiscalYearMismatch).toBe(true);
      expect(sideResult.metric.score).toBeNull();
      expect(sideResult.metric.value).toBeNull();
      expect(sideResult.metric.unavailableReason).toBe('input-missing');
      expect(sideResult.matchedBandIndex).toBeNull();
      expect(sideResult.zeroScoreRule).toBeNull();
      expect(sideResult.evidence).toEqual({
        dividendSen: 2_500,
        dividendFiscalYear: dividendYear,
        epsSen: EPS_SEN,
        epsFiscalYear: epsYear,
      });
      expect(result.source).toBeNull();
    },
  );

  it('実績 EPS・配当が同年度（FY2026）なら判定可能・fiscalYearMismatch false', () => {
    const { sideResult } = judgeOn('actual', side(3_000, EPS_SEN, { dividend: 2026, eps: 2026 }));
    expect(sideResult.fiscalYearMismatch).toBe(false);
    expect(sideResult.metric.score).toBe(8);
  });

  it('予想は揃い・実績は食い違い → 予想だけ判定可能。食い違いは実績側にだけ立つ', () => {
    const forecast = side(2_500, EPS_SEN, { dividend: 2027, eps: 2027 });
    const actual = side(3_000, EPS_SEN, { dividend: 2025, eps: 2026 });

    const byDefault = calculatePayoutRatio({ forecast, actual, useActualForScoring: false });
    expect(byDefault.forecast.fiscalYearMismatch).toBe(false);
    expect(byDefault.forecast.metric.score).toBe(9);
    expect(byDefault.actual.fiscalYearMismatch).toBe(true);
    expect(byDefault.actual.metric.unavailableReason).toBe('input-missing');
    expect(byDefault.source).toBe('forecast');

    // 実績を強制採用すると、食い違った実績は判定不能のまま予想へフォールバックしない
    const forcedActual = calculatePayoutRatio({ forecast, actual, useActualForScoring: true });
    expect(forcedActual.source).toBeNull();
    expect(forcedActual.forecast.metric.score).toBe(9);
  });

  it('予想は食い違い・実績は揃い → 実績だけ判定可能。食い違いは予想側にだけ立つ', () => {
    const forecast = side(2_500, EPS_SEN, { dividend: 2026, eps: 2027 });
    const actual = side(3_000, EPS_SEN, { dividend: 2026, eps: 2026 });

    const byDefault = calculatePayoutRatio({ forecast, actual, useActualForScoring: false });
    expect(byDefault.forecast.fiscalYearMismatch).toBe(true);
    expect(byDefault.forecast.metric.unavailableReason).toBe('input-missing');
    expect(byDefault.actual.fiscalYearMismatch).toBe(false);
    expect(byDefault.source).toBe('actual');
    expect(byDefault.score).toBe(8);

    const forcedActual = calculatePayoutRatio({ forecast, actual, useActualForScoring: true });
    expect(forcedActual.source).toBe('actual');
    expect(forcedActual.score).toBe(8);
  });

  for (const sideName of SIDES) {
    it(`${sideName}: 年度の食い違いは他のどの検査より先: 配当が負でも input-missing（input-invalid ではない）`, () => {
      const { sideResult } = judgeOn(sideName, side(-100, EPS_SEN, { dividend: 2026, eps: 2027 }));
      expect(sideResult.metric.unavailableReason).toBe('input-missing');
      expect(sideResult.fiscalYearMismatch).toBe(true);
    });

    it(`${sideName}: 年度の食い違いは他のどの検査より先: EPS 0 でも input-missing（division-by-zero ではない）`, () => {
      const { sideResult } = judgeOn(sideName, side(2_000, 0, { dividend: 2026, eps: 2027 }));
      expect(sideResult.metric.unavailableReason).toBe('input-missing');
    });

    it(`${sideName}: 年度の食い違いは他のどの検査より先: 赤字・無配でも 0点ではなく input-missing`, () => {
      const missing = { score: null, value: null, unavailableReason: 'input-missing' };
      expect(
        judgeOn(sideName, side(2_000, -10_000, { dividend: 2026, eps: 2027 })).sideResult.metric,
      ).toEqual(missing);
      expect(
        judgeOn(sideName, side(0, EPS_SEN, { dividend: 2026, eps: 2027 })).sideResult.metric,
      ).toEqual(missing);
    });
  }

  it.each([
    { name: '配当の年度だけ null', years: { dividend: null } },
    { name: 'EPS の年度だけ null', years: { eps: null } },
  ])('値はあるが $name → 食い違いとして扱わず通常判定', ({ years }) => {
    const { sideResult } = judgeOn('forecast', side(2_500, EPS_SEN, years));
    expect(sideResult.fiscalYearMismatch).toBe(false);
    expect(sideResult.metric.score).toBe(9);
    expect(sideResult.matchedBandIndex).toBe(1);
  });
});
