import { describe, expect, it } from 'vitest';

import { type DividendRecord } from '@/domain/company/dividend-record';
import {
  CONSECUTIVE_LOOKBACK_YEARS,
  calculateConsecutiveYears,
  describeConsecutiveYearRows,
} from '@/domain/scoring/consecutive-years';
import { type ScoreBand } from '@/domain/scoring/score-band';
import { senOrNull } from '../../helpers/sen';

/**
 * 指標② 連続非減配年数。
 * 仕様: docs/02_design/logic/consecutive-years-scoring.md
 *
 * **「増配」ではなく「非減配」。** 横ばいを継続に含める（設計書 §7 の決定）。
 */

/**
 * 「n年連続で非減配」の履歴を作る。年度降順。
 *
 * n 年ぶんの比較が成立するには n+1 個の値が要る。n 年目の1つ前で減配させて
 * 連続を打ち切る。
 */
function streak(years: number): (number | null)[] {
  const history: number[] = [];
  for (let i = 0; i <= years; i++) history.push(1_000 - i); // 降順＝過去ほど小さい＝非減配
  history.push(10_000); // ここで減配（過去のほうが大きい）→ 連続はここで止まる
  return history;
}

const scoreOf = (history: (number | null)[]) =>
  calculateConsecutiveYears({ dividendHistory: history.map(senOrNull) });

describe('② 連続非減配年数 — 6.1 境界値ちょうど', () => {
  it.each([
    { years: 18, points: 10 },
    { years: 17, points: 10 },
    { years: 16, points: 5 },
    { years: 10, points: 5 },
    { years: 9, points: 3 },
    { years: 5, points: 3 },
    { years: 4, points: 0 },
    { years: 0, points: 0 },
  ])('$years 年は $points 点', ({ years, points }) => {
    const result = scoreOf(streak(years));
    expect(result.value).toBe(years);
    expect(result.score).toBe(points);
  });
});

describe('② 連続非減配年数 — 数え方', () => {
  it('横ばいは継続とみなす（増配でなくてよい）', () => {
    const flat = Array.from({ length: 19 }, () => 1_000);
    expect(scoreOf(flat).value).toBe(18);
  });

  it('直近が減配なら 0年。0点であって判定不能ではない', () => {
    const result = scoreOf([500, 1_000, 1_000, 1_000]);
    expect(result.value).toBe(0);
    expect(result.score).toBe(0);
    expect(result.unavailableReason).toBeNull();
  });

  it('18年より前は見ない（遡及上限）', () => {
    // 19年分すべて非減配なら 18年で頭打ち
    const long = Array.from({ length: 40 }, (_, i) => 1_000 - i);
    expect(scoreOf(long).value).toBe(CONSECUTIVE_LOOKBACK_YEARS);
  });
});

describe('② 連続非減配年数 — カスタム bands（T-101 指標カスタマイズ）', () => {
  const ALWAYS_SEVEN: readonly ScoreBand[] = [{ minInclusive: null, maxExclusive: null, points: 7 }];

  it('省略時はデフォルト定数で判定する（17年は10点）', () => {
    expect(scoreOf(streak(17)).score).toBe(10);
  });

  it('カスタム bands を渡すと、デフォルトなら10点になる入力でも渡した bands の点数になる', () => {
    const result = calculateConsecutiveYears(
      { dividendHistory: streak(17).map(senOrNull) },
      ALWAYS_SEVEN,
    );
    expect(result.score).toBe(7);
  });
});

describe('② 連続非減配年数 — 6.2 負の値', () => {
  it('年数は 0 以上なので負にならない。該当なし', () => {
    expect(scoreOf(streak(0)).value).toBe(0);
  });
});

describe('② 連続非減配年数 — 6.3 無配・0', () => {
  it('配当 0 が続いても「減配していない」ので継続扱い', () => {
    const zeros = Array.from({ length: 19 }, () => 0);
    expect(scoreOf(zeros).value).toBe(18);
  });

  it('無配へ転落した年で打ち切られる', () => {
    expect(scoreOf([0, 1_000, 1_000]).value).toBe(0);
  });
});

describe('② 連続非減配年数 — 6.4 データ欠損', () => {
  it('履歴が空なら判定不能。0 を返さない', () => {
    const result = scoreOf([]);
    expect(result.score).toBeNull();
    expect(result.value).toBeNull();
    expect(result.unavailableReason).toBe('input-missing');
  });

  it('直近が null なら判定不能', () => {
    expect(scoreOf([null, 1_000, 1_000]).score).toBeNull();
  });

  it('判定範囲内に null があれば判定不能。欠損を 0 とみなして「減配」にしない', () => {
    const result = scoreOf([1_000, 900, null, 800]);
    expect(result.score).toBeNull();
    expect(result.unavailableReason).toBe('input-missing');
  });

  it('減配で打ち切られた後ろの null は結果に影響しない（§6.4「判定範囲内」）', () => {
    // 直近で減配して 0年確定。その先の欠損は判定に使わない
    const result = scoreOf([500, 1_000, null, null]);
    expect(result.value).toBe(0);
    expect(result.score).toBe(0);
  });
});

/**
 * ② 連続非減配年数の年次リスト（指標詳細ダイアログ、T-098）。
 *
 * `calculateConsecutiveYears` と**同一のデータソース**（実績限定・欠落年を
 * null でフレーム化）を使うことを確認する（`be-plan.md` §1 の推奨案）。
 */
describe('describeConsecutiveYearRows — 年次リスト', () => {
  function actualRecord(fiscalYear: number, annualAmountSen: number | null): DividendRecord {
    return { fiscalYear, kind: 'actual', annualAmountSen };
  }

  /**
   * `amountsAscending[i]` を fiscalYear = `baseYear + i` の実績配当として組み立てる
   * （時系列昇順の並びでテストデータを書けるようにするヘルパー）。
   */
  function buildRecords(baseYear: number, amountsAscending: readonly number[]): DividendRecord[] {
    return amountsAscending.map((amountSen, i) => actualRecord(baseYear + i, amountSen));
  }

  describe('境界値ちょうど（19年分と、20年目の打ち切り）', () => {
    it('19年分ちょうどなら切り詰めが発生せず、最古年まで含めて全件が返る', () => {
      // 2007〜2025年の19年分（ウィンドウサイズと同じ）。1年ごとに+10（非減配）
      const baseYear = 2007;
      const amounts = Array.from({ length: 19 }, (_, i) => 1_000 + i * 10);
      const records = buildRecords(baseYear, amounts);

      const rows = describeConsecutiveYearRows(records);

      // 19件すべてが返り、最古年（baseYear）も打ち切られずに含まれる
      expect(rows).toHaveLength(CONSECUTIVE_LOOKBACK_YEARS + 1);
      expect(rows.at(0)).toEqual({
        fiscalYear: baseYear,
        amountSen: 1_000,
        diffSen: null,
        state: null,
      });
      expect(rows.at(-1)?.fiscalYear).toBe(baseYear + 18);
      expect(rows.some((row) => row.fiscalYear === baseYear)).toBe(true);
    });

    it('20年分のデータがあっても、直近19年分（先頭行1件+比較18行）だけが返る', () => {
      // 2006〜2025年の20年分。1年ごとに+10（非減配）だが、2016年だけ据置（flat）にする
      const baseYear = 2006;
      let previousAmount = 1_000;
      const amounts: number[] = [previousAmount];
      for (let i = 1; i < 20; i++) {
        const amount = i === 10 ? previousAmount : previousAmount + 10; // i=10 → fiscalYear 2016 が据置
        amounts.push(amount);
        previousAmount = amount;
      }
      const records = buildRecords(baseYear, amounts);

      const rows = describeConsecutiveYearRows(records);

      // 2006年（20年目・最も古い年）は打ち切られて含まれない
      expect(rows).toHaveLength(CONSECUTIVE_LOOKBACK_YEARS + 1);
      expect(rows.at(0)).toEqual({
        fiscalYear: 2007,
        amountSen: 1_010,
        diffSen: null,
        state: null,
      });
      expect(rows.at(-1)?.fiscalYear).toBe(2025);
      expect(rows.some((row) => row.fiscalYear === 2006)).toBe(false);

      // 先頭行のみ判定不能（前年比較ができない）。以降は据置1件を除きすべて増配
      expect(rows.at(0)?.state).toBeNull();
      const flatRow = rows.find((row) => row.fiscalYear === 2016);
      expect(flatRow).toEqual({ fiscalYear: 2016, amountSen: 1_090, diffSen: 0, state: 'flat' });
      const increaseRows = rows.slice(1).filter((row) => row.fiscalYear !== 2016);
      expect(increaseRows.every((row) => row.state === 'increase' && row.diffSen === 10)).toBe(
        true,
      );
    });
  });

  describe('負の値（減配。diffSen が負になるケース）', () => {
    it('減配した年は diffSen が負・state: decrease', () => {
      const records = [
        actualRecord(2023, 1_000),
        actualRecord(2024, 1_000),
        actualRecord(2025, 800),
      ];
      const rows = describeConsecutiveYearRows(records);
      expect(rows).toEqual([
        { fiscalYear: 2023, amountSen: 1_000, diffSen: null, state: null },
        { fiscalYear: 2024, amountSen: 1_000, diffSen: 0, state: 'flat' },
        { fiscalYear: 2025, amountSen: 800, diffSen: -200, state: 'decrease' },
      ]);
    });
  });

  describe('無配・0円', () => {
    it('0円が続く年は減配ではないので flat（据置）', () => {
      const records = [actualRecord(2023, 0), actualRecord(2024, 0), actualRecord(2025, 0)];
      const rows = describeConsecutiveYearRows(records);
      expect(rows[1]).toEqual({ fiscalYear: 2024, amountSen: 0, diffSen: 0, state: 'flat' });
      expect(rows[2]).toEqual({ fiscalYear: 2025, amountSen: 0, diffSen: 0, state: 'flat' });
    });

    it('非0円 → 0円（無配へ転落）は減配', () => {
      const records = [actualRecord(2024, 1_000), actualRecord(2025, 0)];
      const rows = describeConsecutiveYearRows(records);
      expect(rows[1]).toEqual({
        fiscalYear: 2025,
        amountSen: 0,
        diffSen: -1_000,
        state: 'decrease',
      });
    });
  });

  describe('欠損', () => {
    it('履歴が空なら空配列を返す（判定不能を 0 に丸めない）', () => {
      expect(describeConsecutiveYearRows([])).toEqual([]);
    });

    it('ウィンドウ内に欠落年（null フレーム）があると、その行と次の行の両方が判定不能になる', () => {
      // 2024年のデータが欠けている（記録自体が無い）→ actualDividendSeriesWithYear が
      // amountSen: null でフレーム化する
      const records = [actualRecord(2023, 1_000), actualRecord(2025, 1_200)];
      const rows = describeConsecutiveYearRows(records);

      expect(rows).toEqual([
        { fiscalYear: 2023, amountSen: 1_000, diffSen: null, state: null }, // 先頭行
        { fiscalYear: 2024, amountSen: null, diffSen: null, state: null }, // 欠落年そのもの
        // 前年(2024)が null なので diffSen/state は判定不能。ただし当年の値(1,200)自体は
        // 分かっているので amountSen を 0 やダミー値に丸めない
        { fiscalYear: 2025, amountSen: 1_200, diffSen: null, state: null },
      ]);
    });

    it('annualAmountSen: null の実績レコード（年度の枠はあるが値が無い）でも同様に判定不能になる', () => {
      const records = [actualRecord(2024, 1_000), actualRecord(2025, null)];
      const rows = describeConsecutiveYearRows(records);
      expect(rows[1]).toEqual({ fiscalYear: 2025, amountSen: null, diffSen: null, state: null });
    });
  });
});
