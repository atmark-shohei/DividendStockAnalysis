import { describe, expect, it } from 'vitest';

import { calculatePayoutRatio, payoutRatioToMetricScore } from '@/domain/scoring/payout-ratio';
import { type ScoreBand } from '@/domain/scoring/score-band';
import { sen } from '../../helpers/sen';

/**
 * 指標③ 予想配当性向・実績配当性向。
 * 仕様: docs/02_design/logic/payout-ratio-scoring.md
 *
 * この指標だけ 10段（1点を返す経路が無い）。原典の欠陥（赤字企業が満点）を
 * §0.3 / §0.4 で塞いである。
 *
 * 2026-08-06 決定（§7）: 実績側の追加とソース選択（`useActualForScoring`）。
 * §6.1〜6.4 は予想・実績どちらの組でも成立することを検証するため、
 * 実績側を空（`{ dividendSen: null, epsSen: null }`）にしたまま `forecast` 側で
 * 従来どおりのアサーションを行う（actual 側を空にしておけば、フォールバック無しで
 * 予想側の結果がそのまま採点に採用される）。
 */

/** EPS 10,000 銭（100円）に対する配当から性向を作る。1% = 100 銭 */
const EPS_SEN = 10_000;

const EMPTY_SIDE = { dividendSen: null, epsSen: null };

const scoreAt = (dividendSen: number, epsSen = EPS_SEN) =>
  calculatePayoutRatio({
    forecast: { dividendSen: sen(dividendSen), epsSen: sen(epsSen) },
    actual: EMPTY_SIDE,
    useActualForScoring: false,
  }).forecast.score;

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
      forecast: { dividendSen: sen(2_000), epsSen: sen(-10_000) },
      actual: EMPTY_SIDE,
      useActualForScoring: false,
    });
    expect(result.forecast.score).toBe(0);
    expect(result.forecast.unavailableReason).toBeNull();
  });

  it('赤字でも判定不能にはしない。0点であることに意味がある', () => {
    const result = calculatePayoutRatio({
      forecast: { dividendSen: sen(2_000), epsSen: sen(-1) },
      actual: EMPTY_SIDE,
      useActualForScoring: false,
    });
    expect(result.forecast.score).toBe(0);
  });

  it('配当が負は制度上ありえないのでデータ不良として判定不能', () => {
    const result = calculatePayoutRatio({
      forecast: { dividendSen: sen(-100), epsSen: sen(EPS_SEN) },
      actual: EMPTY_SIDE,
      useActualForScoring: false,
    });
    expect(result.forecast.score).toBeNull();
    expect(result.forecast.unavailableReason).toBe('input-invalid');
  });

  it('実績側でも同じ規則が成立する（§6.2「予想・実績どちらの組でも成立すること」）', () => {
    const result = calculatePayoutRatio({
      forecast: EMPTY_SIDE,
      actual: { dividendSen: sen(2_000), epsSen: sen(-10_000) },
      useActualForScoring: true,
    });
    expect(result.actual.score).toBe(0);
    expect(result.actual.unavailableReason).toBeNull();
  });
});

describe('③ 予想配当性向 — 6.3 無配・0', () => {
  it('無配（配当 0）は 0点（§0.4）。性向 0% は数値上は最上位区分だが採らない', () => {
    const result = calculatePayoutRatio({
      forecast: { dividendSen: sen(0), epsSen: sen(EPS_SEN) },
      actual: EMPTY_SIDE,
      useActualForScoring: false,
    });
    expect(result.forecast.score).toBe(0);
    expect(result.forecast.value).toBe(0);
    expect(result.forecast.unavailableReason).toBeNull();
  });

  it('配当が正で性向がほぼ 0% なら 10点。無配とは区別する', () => {
    // EPS が極端に大きい会社。性向 0.00001% でも「無配」ではない
    const result = calculatePayoutRatio({
      forecast: { dividendSen: sen(1), epsSen: sen(1_000_000_000) },
      actual: EMPTY_SIDE,
      useActualForScoring: false,
    });
    expect(result.forecast.score).toBe(10);
  });

  it('EPS が 0 はゼロ除算で判定不能。0点ではない', () => {
    const result = calculatePayoutRatio({
      forecast: { dividendSen: sen(2_000), epsSen: sen(0) },
      actual: EMPTY_SIDE,
      useActualForScoring: false,
    });
    expect(result.forecast.score).toBeNull();
    expect(result.forecast.unavailableReason).toBe('division-by-zero');
  });

  it('実績側でも同じ規則が成立する', () => {
    const result = calculatePayoutRatio({
      forecast: EMPTY_SIDE,
      actual: { dividendSen: sen(0), epsSen: sen(EPS_SEN) },
      useActualForScoring: true,
    });
    expect(result.actual.score).toBe(0);
    expect(result.actual.value).toBe(0);
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
        epsSen: eps === null ? null : sen(eps),
      },
      actual: EMPTY_SIDE,
      useActualForScoring: false,
    });
    expect(result.forecast.score).toBeNull();
    expect(result.forecast.value).toBeNull();
    expect(result.forecast.unavailableReason).toBe('input-missing');
  });

  it('予想の年度と実績の年度が異なっていても、両方が独立に判定できる（片方の欠損が他方に影響しない）', () => {
    const result = calculatePayoutRatio({
      forecast: EMPTY_SIDE,
      actual: { dividendSen: sen(2_000), epsSen: sen(EPS_SEN) },
      useActualForScoring: false,
    });
    expect(result.forecast.unavailableReason).toBe('input-missing');
    expect(result.actual.score).not.toBeNull();
  });
});

describe('③ 予想配当性向 — 6.5 ソース選択', () => {
  it('useActualForScoring: false かつ予想が判定可能なら予想を採用する', () => {
    const result = calculatePayoutRatio({
      forecast: { dividendSen: sen(2_000), epsSen: sen(EPS_SEN) },
      actual: { dividendSen: sen(4_000), epsSen: sen(EPS_SEN) },
      useActualForScoring: false,
    });
    expect(result.source).toBe('forecast');
    expect(result.score).toBe(result.forecast.score);
    expect(result.value).toBe(result.forecast.value);
  });

  it('useActualForScoring: false かつ予想が判定不能・実績が判定可能なら実績にフォールバックする', () => {
    const result = calculatePayoutRatio({
      forecast: EMPTY_SIDE,
      actual: { dividendSen: sen(4_000), epsSen: sen(EPS_SEN) },
      useActualForScoring: false,
    });
    expect(result.source).toBe('actual');
    expect(result.score).toBe(result.actual.score);
    expect(result.value).toBe(result.actual.value);
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
      forecast: { dividendSen: sen(2_000), epsSen: sen(EPS_SEN) },
      actual: { dividendSen: sen(4_000), epsSen: sen(EPS_SEN) },
      useActualForScoring: true,
    });
    expect(result.source).toBe('actual');
    expect(result.score).toBe(result.actual.score);
    expect(result.value).toBe(result.actual.value);
  });

  it('useActualForScoring: true かつ実績が判定不能なら score/source は null（予想へフォールバックしない）', () => {
    const result = calculatePayoutRatio({
      forecast: { dividendSen: sen(2_000), epsSen: sen(EPS_SEN) },
      actual: EMPTY_SIDE,
      useActualForScoring: true,
    });
    expect(result.score).toBeNull();
    expect(result.value).toBeNull();
    expect(result.source).toBeNull();
    // 予想側は判定できているが、採用されていないことを確認する
    expect(result.forecast.score).not.toBeNull();
  });
});

describe('③ 予想配当性向 — 6.6 表示用の内訳', () => {
  it('採用元と無関係に forecast/actual 両方が常に判定結果を持つ', () => {
    const result = calculatePayoutRatio({
      forecast: { dividendSen: sen(2_000), epsSen: sen(EPS_SEN) },
      actual: { dividendSen: sen(4_000), epsSen: sen(EPS_SEN) },
      useActualForScoring: false,
    });
    expect(result.forecast.score).not.toBeNull();
    expect(result.actual.score).not.toBeNull();
  });

  it('予想が判定不能でも actual には実績側の判定結果が入る', () => {
    const result = calculatePayoutRatio({
      forecast: EMPTY_SIDE,
      actual: { dividendSen: sen(4_000), epsSen: sen(EPS_SEN) },
      useActualForScoring: false,
    });
    expect(result.forecast.unavailableReason).toBe('input-missing');
    expect(result.actual.score).not.toBeNull();
  });

  it('実績が判定不能でも forecast には予想側の判定結果が入る', () => {
    const result = calculatePayoutRatio({
      forecast: { dividendSen: sen(2_000), epsSen: sen(EPS_SEN) },
      actual: EMPTY_SIDE,
      useActualForScoring: true,
    });
    expect(result.forecast.score).not.toBeNull();
    expect(result.actual.unavailableReason).toBe('input-missing');
  });
});

describe('③ payoutRatioToMetricScore — 採点集計用の変換', () => {
  it('source が forecast のとき採用値をそのまま MetricScore にする', () => {
    const result = calculatePayoutRatio({
      forecast: { dividendSen: sen(2_000), epsSen: sen(EPS_SEN) },
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
      actual: { dividendSen: sen(4_000), epsSen: sen(EPS_SEN) },
      useActualForScoring: true,
    });
    const metric = payoutRatioToMetricScore(result);
    expect(metric.score).toBe(result.score);
    expect(metric.value).toBe(result.value);
    expect(metric.unavailableReason).toBeNull();
  });

  it('両方判定不能のとき、予想側に理由があれば予想側の理由を使う（§0.2 の解釈 / 設計書 §5.1 決定4）', () => {
    const result = calculatePayoutRatio({
      forecast: { dividendSen: sen(2_000), epsSen: sen(0) }, // division-by-zero
      actual: { dividendSen: null, epsSen: null }, // input-missing
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
        forecast: { dividendSen: sen(2_000), epsSen: sen(EPS_SEN) }, // 判定可能（理由なし）
        actual: { dividendSen: sen(2_000), epsSen: sen(0) }, // division-by-zero
        useActualForScoring: true,
      });
      const metric = payoutRatioToMetricScore(result);
      expect(metric.score).toBeNull();
      expect(metric.unavailableReason).toBe('division-by-zero');
    },
  );
});

describe('③ 予想配当性向 — カスタム bands（T-101 指標カスタマイズ）', () => {
  const ALWAYS_SEVEN: readonly ScoreBand[] = [{ minInclusive: null, maxExclusive: null, points: 7 }];

  it('省略時はデフォルト定数で判定する（25%ちょうどは9点）', () => {
    expect(scoreAt(2_500)).toBe(9);
  });

  it('カスタム bands は予想・実績の両側に同じ表を渡す（デフォルトなら9点になる入力が7点になる）', () => {
    const result = calculatePayoutRatio(
      {
        forecast: { dividendSen: sen(2_500), epsSen: sen(EPS_SEN) },
        actual: { dividendSen: sen(2_500), epsSen: sen(EPS_SEN) },
        useActualForScoring: false,
      },
      ALWAYS_SEVEN,
    );
    expect(result.forecast.score).toBe(7);
    expect(result.actual.score).toBe(7);
    expect(result.score).toBe(7);
  });
});
