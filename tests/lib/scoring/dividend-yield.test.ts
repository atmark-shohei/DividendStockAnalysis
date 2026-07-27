import { describe, expect, it } from 'vitest';

import { parsePriceInput } from '@/lib/input/parse-price';
import {
  DIVIDEND_YIELD_BANDS,
  calculateDividendYield,
  selectAnnualDividend,
} from '@/lib/scoring/dividend-yield';

/**
 * 指標⑩ 配当利回り。
 * 仕様: docs/02_design/logic/dividend-yield-scoring.md
 * 区分の解釈: scoring-requirements.md §0.1（下限以上・上限未満）
 *
 * 金額はすべて銭単位の整数。1000 円 = 100000 銭。
 */

const YEN = 100; // 1 円 = 100 銭

/** 株価と配当（円）から入力を組み立てる。テストの意図を読みやすくするため。 */
function input(priceYen: number | null, dividendYen: number | null) {
  return {
    priceSen: priceYen === null ? null : Math.round(priceYen * YEN),
    dividend:
      dividendYen === null
        ? null
        : { amountSen: Math.round(dividendYen * YEN), source: 'forecast' as const },
  };
}

/** 株価 10,000 円。配当 1 銭 = 利回り 0.0001% になるので境界を狙いやすい。 */
const PRICE_10K_YEN_SEN = 1_000_000;

function scoreAtDividendSen(dividendSen: number): number | null {
  return calculateDividendYield({
    priceSen: PRICE_10K_YEN_SEN,
    dividend: { amountSen: dividendSen, source: 'forecast' },
  }).score;
}

describe('⑩ 配当利回り — 6.1 境界値ちょうど', () => {
  // 「下限以上・上限未満」なので、各区分の下限ちょうどはその区分の点数になる。
  it.each([
    { pct: 5.5, points: 10 },
    { pct: 5.25, points: 9 },
    { pct: 5.0, points: 8 },
    { pct: 4.75, points: 7 },
    { pct: 4.5, points: 6 },
    { pct: 4.25, points: 5 },
    { pct: 4.0, points: 4 },
    { pct: 3.75, points: 3 },
    { pct: 3.5, points: 2 },
    { pct: 3.25, points: 1 },
    { pct: 0, points: 0 },
  ])('利回り $pct% ちょうどは $points 点', ({ pct, points }) => {
    // 株価 1000 円に対する配当を逆算すれば、利回りは厳密にその値になる
    expect(calculateDividendYield(input(1000, (1000 * pct) / 100)).score).toBe(points);
  });

  // 上限側も全区分ぶん踏む。下限だけだとオフバイワンの片側しか検出できない。
  it.each([
    { threshold: 550, points: 9 },
    { threshold: 525, points: 8 },
    { threshold: 500, points: 7 },
    { threshold: 475, points: 6 },
    { threshold: 450, points: 5 },
    { threshold: 425, points: 4 },
    { threshold: 400, points: 3 },
    { threshold: 375, points: 2 },
    { threshold: 350, points: 1 },
    { threshold: 325, points: 0 },
  ])('$threshold/100% を 1 銭でも下回ると $points 点に落ちる', ({ threshold, points }) => {
    expect(scoreAtDividendSen(threshold * 100)).toBe(points + 1);
    expect(scoreAtDividendSen(threshold * 100 - 1)).toBe(points);
  });

  it('丸めた表示が 5.50% でも、判定は生値で行う（5.4951% → 9 点）', () => {
    // §2.2: 判定に丸め値を使うと境界でスコアが変わる。判定は生値、表示のみ丸め。
    const result = calculateDividendYield(input(10000, 549.51));
    expect(result.yieldHundredthsPercent).toBe(550); // 表示は 5.50%
    expect(result.score).toBe(9); // だが 10 点ではない
  });

  it('区分表に穴も重複もない（0% 以上を隙間なく覆う）', () => {
    const sorted = [...DIVIDEND_YIELD_BANDS].sort(
      (a, b) => (a.minInclusive ?? 0) - (b.minInclusive ?? 0),
    );
    expect(sorted[0]?.minInclusive).toBe(0);
    expect(sorted.at(-1)?.maxExclusive).toBeNull();
    for (let i = 0; i < sorted.length - 1; i++) {
      expect(sorted[i]?.maxExclusive).toBe(sorted[i + 1]?.minInclusive);
    }
  });
});

describe('⑩ 配当利回り — 6.2 負の値', () => {
  it('株価が負なら判定不能。0 点ではない', () => {
    const result = calculateDividendYield(input(-1000, 50));
    expect(result.score).toBeNull();
    expect(result.unavailableReason).toBe('price-negative');
  });

  it('株価 0 と株価が負は別の理由になる（§4 は別のメッセージを出す）', () => {
    expect(calculateDividendYield(input(0, 50)).unavailableReason).toBe('price-zero');
    expect(calculateDividendYield(input(-1000, 50)).unavailableReason).toBe('price-negative');
  });

  it('配当が負なら判定不能。0 点にすると無配と区別できなくなる', () => {
    const result = calculateDividendYield(input(1000, -50));
    expect(result.score).toBeNull();
    expect(result.unavailableReason).toBe('dividend-invalid');
  });
});

describe('⑩ 配当利回り — 6.3 無配・0', () => {
  it('無配（配当 0 円・株価あり）は 0.00% で 0 点。null ではない', () => {
    const result = calculateDividendYield(input(1000, 0));
    expect(result.score).toBe(0);
    expect(result.yieldHundredthsPercent).toBe(0);
    expect(result.unavailableReason).toBeNull();
  });

  it('株価 0 はゼロ除算なので判定不能。0 点ではない', () => {
    const result = calculateDividendYield(input(0, 50));
    expect(result.score).toBeNull();
    expect(result.unavailableReason).toBe('price-zero');
  });
});

describe('⑩ 配当利回り — 6.4 データ欠損', () => {
  it('株価が未入力なら判定不能', () => {
    const result = calculateDividendYield(input(null, 50));
    expect(result.score).toBeNull();
    expect(result.unavailableReason).toBe('price-missing');
  });

  it('配当データが1件もなければ判定不能', () => {
    const result = calculateDividendYield(input(1000, null));
    expect(result.score).toBeNull();
    expect(result.unavailableReason).toBe('dividend-missing');
  });

  it('判定不能なら利回りも null。0 を返さない', () => {
    for (const bad of [input(null, 50), input(0, 50), input(1000, null)]) {
      const result = calculateDividendYield(bad);
      expect(result.score).toBeNull();
      expect(result.yieldHundredthsPercent).toBeNull();
    }
  });
});

describe('⑩ 配当利回り — 壊れた数値は満点にしない', () => {
  // NaN は「< 0」も「>= 0」も false なので、素朴に書くと全ガードを素通りして
  // 先頭の区分（＝10 点）に落ちる。破損データが最上位に浮上するのが最悪の壊れ方。
  it.each([
    { label: 'NaN', value: Number.NaN },
    { label: 'Infinity', value: Number.POSITIVE_INFINITY },
    { label: '-Infinity', value: Number.NEGATIVE_INFINITY },
    { label: '非整数', value: 1000.5 },
    { label: '安全整数超', value: Number.MAX_SAFE_INTEGER + 2 },
  ])('株価が $label なら判定不能', ({ value }) => {
    const result = calculateDividendYield({
      priceSen: value,
      dividend: { amountSen: 50_000, source: 'forecast' },
    });
    expect(result.score).toBeNull();
    expect(result.unavailableReason).toBe('price-invalid');
  });

  it.each([
    { label: 'NaN', value: Number.NaN },
    { label: 'Infinity', value: Number.POSITIVE_INFINITY },
    { label: '-Infinity', value: Number.NEGATIVE_INFINITY },
    { label: '非整数', value: 50_000.5 },
  ])('配当が $label なら判定不能', ({ value }) => {
    const result = calculateDividendYield({
      priceSen: PRICE_10K_YEN_SEN,
      dividend: { amountSen: value, source: 'forecast' },
    });
    expect(result.score).toBeNull();
    expect(result.unavailableReason).toBe('dividend-invalid');
  });
});

describe('⑩ 配当利回り — 積が安全整数を外れる入力を弾く', () => {
  // オペランドが安全整数でも、判定式が計算する積はそうとは限らない。
  // 株価 9007199254740991 銭（安全整数ちょうど）は isSafeInteger を通るが、
  // 550 * それ は 2^53 を超え、float64 の丸めで比較の符号が反転していた。
  // 実測では 5.25% の判定が 9点、BigInt による厳密計算では 8点だった。
  const MAX_PRICE_SEN = Math.floor(Number.MAX_SAFE_INTEGER / 550);
  const MAX_DIVIDEND_SEN = Math.floor(Number.MAX_SAFE_INTEGER / 10_000);

  it('安全整数ではあるが積が溢れる株価は判定不能', () => {
    const result = calculateDividendYield({
      priceSen: Number.MAX_SAFE_INTEGER,
      dividend: { amountSen: 472_877_960_873_902, source: 'forecast' },
    });
    expect(result.score).toBeNull();
    expect(result.unavailableReason).toBe('price-invalid');
  });

  it('上限ちょうどの株価は通り、1 銭超えると弾かれる', () => {
    const at = (priceSen: number) =>
      calculateDividendYield({
        priceSen,
        dividend: { amountSen: 1_000, source: 'forecast' },
      }).unavailableReason;
    expect(at(MAX_PRICE_SEN)).toBeNull();
    expect(at(MAX_PRICE_SEN + 1)).toBe('price-invalid');
  });

  it('上限ちょうどの配当は通り、1 銭超えると弾かれる', () => {
    // 株価側は余裕のある整数に固定し、配当側の上限だけを見る
    const at = (amountSen: number) =>
      calculateDividendYield({
        priceSen: PRICE_10K_YEN_SEN,
        dividend: { amountSen, source: 'forecast' },
      }).unavailableReason;
    expect(at(MAX_DIVIDEND_SEN)).toBeNull();
    expect(at(MAX_DIVIDEND_SEN + 1)).toBe('dividend-invalid');
  });

  it('通った入力では全閾値の境界で判定が厳密になる（BigInt と一致する）', () => {
    // 上限付近でも、float の丸めで区分がずれないこと。
    // 実装と同じ規約（下限以上・上限未満）を BigInt で組み直して正解とする。
    const exactPoints = (amountSen: number, priceSen: number): number | null => {
      const lhs = BigInt(amountSen) * 10_000n;
      for (const band of DIVIDEND_YIELD_BANDS) {
        const atOrAboveMin =
          band.minInclusive === null || lhs >= BigInt(band.minInclusive) * BigInt(priceSen);
        const belowMax =
          band.maxExclusive === null || lhs < BigInt(band.maxExclusive) * BigInt(priceSen);
        if (atOrAboveMin && belowMax) return band.points;
      }
      return null;
    };

    const thresholds = DIVIDEND_YIELD_BANDS.map((band) => band.minInclusive).filter(
      (t): t is number => t !== null && t > 0,
    );

    for (const priceSen of [PRICE_10K_YEN_SEN, 12_345_600, MAX_PRICE_SEN]) {
      for (const threshold of thresholds) {
        const atThreshold = Math.floor((priceSen * threshold) / 10_000);
        for (const amountSen of [atThreshold - 1, atThreshold, atThreshold + 1]) {
          // 上限を超える組み合わせは実装が意図的に弾くので照合対象から外す
          if (amountSen < 0 || amountSen > MAX_DIVIDEND_SEN) continue;
          expect(
            calculateDividendYield({ priceSen, dividend: { amountSen, source: 'forecast' } }).score,
          ).toBe(exactPoints(amountSen, priceSen));
        }
      }
    }
  });
});

describe('⑩ 配当利回り — 判定不能時の戻り値', () => {
  it('判定不能なら dividendSource も null にする', () => {
    // 中途半端に埋まった結果を返さない。画面が「実績」とだけ出すのを防ぐ
    const result = calculateDividendYield({
      priceSen: null,
      dividend: { amountSen: 5_000, source: 'actual' },
    });
    expect(result.score).toBeNull();
    expect(result.dividendSource).toBeNull();
  });
});

describe('⑩ 配当利回り — 採用した配当の出所', () => {
  // §2.1: 最新の「予想（または修正）」を優先し、無ければ最新の「実績」。
  const actual2023 = { fiscalYear: 2023, kind: 'actual' as const, annualAmountSen: 4000 };
  const actual2024 = { fiscalYear: 2024, kind: 'actual' as const, annualAmountSen: 4500 };
  const forecast2025 = { fiscalYear: 2025, kind: 'forecast' as const, annualAmountSen: 5000 };
  const revised2025 = { fiscalYear: 2025, kind: 'revised' as const, annualAmountSen: 5200 };

  it('予想と実績の両方があれば予想を採用する', () => {
    expect(selectAnnualDividend([actual2023, actual2024, forecast2025])).toEqual({
      amountSen: 5000,
      source: 'forecast',
    });
  });

  it('修正があれば修正を優先する（修正も「予想」として扱う）', () => {
    expect(selectAnnualDividend([actual2024, forecast2025, revised2025])).toEqual({
      amountSen: 5200,
      source: 'forecast',
    });
  });

  it('配列の並び順で結果が変わらない', () => {
    expect(selectAnnualDividend([revised2025, forecast2025, actual2024])).toEqual({
      amountSen: 5200,
      source: 'forecast',
    });
  });

  it('実績しかなければ最新の実績を採用し、その旨を返す', () => {
    expect(selectAnnualDividend([actual2023, actual2024])).toEqual({
      amountSen: 4500,
      source: 'actual',
    });
  });

  it('採用した出所は計算結果にも載る', () => {
    const picked = selectAnnualDividend([actual2023, actual2024]);
    expect(calculateDividendYield({ priceSen: 100_000, dividend: picked }).dividendSource).toBe(
      'actual',
    );
  });

  it('金額が null のレコードは採用しない', () => {
    expect(
      selectAnnualDividend([
        actual2024,
        { fiscalYear: 2025, kind: 'forecast', annualAmountSen: null },
      ]),
    ).toEqual({ amountSen: 4500, source: 'actual' });
  });

  it('レコードが空なら null', () => {
    expect(selectAnnualDividend([])).toBeNull();
  });
});

describe('⑩ 配当利回り — 入力欄からスコアまで通しで動く', () => {
  // §5 のテスト観点「全角数字での株価入力 → 半角に正規化されて計算される」は
  // パース単体では満たせない。入力欄の文字列からスコアまで結線して検証する。
  it('全角で入力した株価がスコアまで届く', () => {
    const parsed = parsePriceInput('１，０００'); // 全角の 1,000 円
    expect(parsed.kind).toBe('ok');
    if (parsed.kind !== 'ok') return;

    const result = calculateDividendYield({
      priceSen: parsed.sen,
      dividend: { amountSen: 5_500, source: 'forecast' }, // 55 円 → 5.50%
    });
    expect(result.yieldHundredthsPercent).toBe(550);
    expect(result.score).toBe(10);
  });

  it('未入力はスコア側でも「未入力」として扱われる', () => {
    const parsed = parsePriceInput('');
    expect(parsed.kind).toBe('empty');
    const result = calculateDividendYield({
      priceSen: null,
      dividend: { amountSen: 5_500, source: 'forecast' },
    });
    expect(result.unavailableReason).toBe('price-missing');
  });
});

describe('⑩ 配当利回り — 浮動小数点を経由しない', () => {
  it('高額配当でも桁落ちしない', () => {
    // 判定を dividend*10000 と threshold*price の整数比較で行っていれば、
    // 1 銭差でも 10 点と 9 点を取り違えない。
    const price = 12_345_600; // 123,456 円
    const atThreshold = Math.ceil((price * 550) / 10_000); // 5.50% ちょうど以上の最小配当
    const at = (amountSen: number) =>
      calculateDividendYield({ priceSen: price, dividend: { amountSen, source: 'forecast' } })
        .score;
    expect(at(atThreshold)).toBe(10);
    expect(at(atThreshold - 1)).toBe(9);
  });
});
