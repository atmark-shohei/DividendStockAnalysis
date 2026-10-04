import { describe, expect, it } from 'vitest';

import { describeDomainError } from '@/domain/shared/domain-error';
import { METRIC_KEYS, METRIC_LABEL, METRIC_NUMBER, METRIC_UNIT } from '@/domain/shared/metric-key';
import { isScored, scored, unavailable } from '@/domain/shared/metric-score';
import { MAX_SCORE, MIN_SCORE, createScore, scoreFromValidatedBand } from '@/domain/shared/score';
import { createSen, isSen, senFromYen } from '@/domain/shared/sen';
import { type Result, err, ok, unwrapOr } from '@/domain/shared/result';

/**
 * 共有カーネル（T-048）。残り9指標の雛形になるので、ここが崩れると全指標に波及する。
 */

describe('Result', () => {
  it('成功と失敗を型で分ける', () => {
    expect(ok(1)).toEqual({ ok: true, value: 1 });
    expect(err('x')).toEqual({ ok: false, error: 'x' });
  });

  it('unwrapOr は失敗のとき既定値を返す', () => {
    const success: Result<number, string> = ok(5);
    const failure: Result<number, string> = err('x');
    expect(unwrapOr(success, 0)).toBe(5);
    expect(unwrapOr(failure, 0)).toBe(0);
  });
});

describe('Score', () => {
  it('0〜10 の整数を受け入れる（用語集の「1〜10」は誤り。§0.3/§0.4/§0.5 が 0点を要求する）', () => {
    for (let value = MIN_SCORE; value <= MAX_SCORE; value++) {
      const result = createScore(value);
      expect(result.ok).toBe(true);
    }
  });

  it.each([-1, 11, 1.5, Number.NaN, Number.POSITIVE_INFINITY])('%s は作れない', (value) => {
    const result = createScore(value);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('ScoreOutOfRange');
  });

  it('0 が作れる。作れないと採点が成立しない', () => {
    expect(unwrapOr(createScore(0), -1 as never)).toBe(0);
  });

  it('区分表の定数から作る経路は、範囲外なら黙って通さず落ちる', () => {
    expect(() => scoreFromValidatedBand(11)).toThrow();
    expect(scoreFromValidatedBand(10)).toBe(10);
  });
});

describe('Sen', () => {
  it.each([0, 1, -1, Number.MAX_SAFE_INTEGER])('安全整数 %s は銭になる', (value) => {
    expect(isSen(value)).toBe(true);
  });

  it.each([1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 2])(
    '%s は銭にならない',
    (value) => {
      expect(isSen(value)).toBe(false);
      expect(createSen(value).ok).toBe(false);
    },
  );

  it('-0 を返さない（Object.is(-0, 0) が false で比較が事故る）', () => {
    const result = createSen(-0);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.is(result.value, -0)).toBe(false);
  });

  it('円から銭は 100 倍', () => {
    expect(unwrapOr(senFromYen(12.34), 0 as never)).toBe(1234);
  });
});

describe('MetricScore', () => {
  it('判定できたときは理由が null', () => {
    const metric = scored(scoreFromValidatedBand(7), 12.5);
    expect(metric.unavailableReason).toBeNull();
    expect(isScored(metric)).toBe(true);
    if (!isScored(metric)) return;
    expect(metric.score).toBe(7);
    expect(metric.value).toBe(12.5);
  });

  it('判定不能なら score も value も null。0 を返さない', () => {
    const metric = unavailable('input-missing');
    expect(metric.score).toBeNull();
    expect(metric.value).toBeNull();
    expect(isScored(metric)).toBe(false);
  });

  it('「点数あり」と「理由あり」が同時に立つ値は作れない（型で禁止）', () => {
    // @ts-expect-error score と unavailableReason は排他。両立する形は型エラーになる
    const invalid: ReturnType<typeof unavailable> = { score: 5, value: 5, unavailableReason: 'x' };
    expect(invalid).toBeDefined();
  });

  it('「何も分からない」値も作れない（score:null かつ reason:null）', () => {
    // @ts-expect-error T-048 の中心。この形が型で作れないことが移行の目的
    const invalid: ReturnType<typeof unavailable> = {
      score: null,
      value: null,
      unavailableReason: null,
    };
    expect(invalid).toBeDefined();
  });
});

describe('MetricKey', () => {
  it('指標はちょうど10個。総合点の分母 100 の根拠になる（§0.5）', () => {
    expect(METRIC_KEYS).toHaveLength(10);
  });

  it('①〜⑩ の通し番号に重複も欠落もない', () => {
    const numbers = METRIC_KEYS.map((key) => METRIC_NUMBER[key]).sort((a, b) => a - b);
    expect(numbers).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('全指標に見出しと単位がある', () => {
    for (const key of METRIC_KEYS) {
      expect(METRIC_LABEL[key]).toBeTruthy();
      expect(['%', '倍', '年']).toContain(METRIC_UNIT[key]);
    }
  });
});

describe('DomainError', () => {
  it('kind ごとに説明を返す（画面には出さない。ログとテスト用）', () => {
    expect(describeDomainError({ kind: 'ThresholdEmpty' })).toContain('empty');
    expect(describeDomainError({ kind: 'ScoreOutOfRange', value: 42 })).toContain('42');
  });

  it('BaselineNotPositive（T-100: 基準値が0以下）の説明を返す', () => {
    expect(describeDomainError({ kind: 'BaselineNotPositive', value: -10 })).toContain('-10');
  });

  it('BaselineUndeterminable（T-100: 区分表から満点境界を判定できない防御的分岐）の説明を返す', () => {
    expect(describeDomainError({ kind: 'BaselineUndeterminable' })).toContain('baseline');
  });
});
