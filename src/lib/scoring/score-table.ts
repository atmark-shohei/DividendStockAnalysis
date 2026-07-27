/**
 * 全指標が共有する区分表のルックアップ。
 *
 * 区分の解釈は `scoring-requirements.md` §0.1 の規約に従い
 * **「下限以上、上限未満」**。最上位行のみ「下限以上」で上が開いている。
 *
 * T-014 の決定により、各指標の区分表は定数として1箇所に切り出す。
 * 出典の議論が再燃したときに、判定ロジックではなく定数だけを差し替えられるようにする。
 */

export interface ScoreBand {
  /** 下限。この値を含む。`null` は下限なし */
  readonly minInclusive: number | null;
  /** 上限。この値を含まない。`null` は上限なし（最上位区分） */
  readonly maxExclusive: number | null;
  /** 0〜10 */
  readonly points: number;
}

/**
 * 区分表から点数を引く。
 *
 * 判定値そのものではなく**比較関数**を受け取るのは、浮動小数点を経由せずに
 * 判定するため。たとえば配当利回りは `配当 / 株価 * 100` だが、この割り算を
 * 実際に行うと丸め誤差で境界の判定が変わる。呼び出し側が
 * `配当 * 10000 - 閾値 * 株価` のような整数式を渡せば、除算なしで厳密に比較できる。
 *
 * 判定は**肯定形**で書いてある。「該当しなければ次へ」という否定形にすると、
 * `compare` が `NaN` を返したときに両方の否定が false になって
 * **先頭の区分（＝最高点）に落ちる**。壊れたデータが満点を取るのが最悪の壊れ方なので、
 * 「条件を満たしたときだけ返す」形にして未知の入力は `null` へ倒す。
 *
 * @param compare `判定値 - threshold` と同じ符号を返す関数。大きさは使わない
 * @returns 該当する区分の点数。どの区分にも該当しなければ `null`
 *   （「計算できたが区分の外」であり、最低点とは区別する）
 */
export function lookupPoints(
  bands: readonly ScoreBand[],
  compare: (threshold: number) => number,
): number | null {
  for (const band of bands) {
    const atOrAboveMin = band.minInclusive === null || compare(band.minInclusive) >= 0;
    const belowMax = band.maxExclusive === null || compare(band.maxExclusive) < 0;
    if (atOrAboveMin && belowMax) return band.points;
  }
  return null;
}

/**
 * 区分表に穴も重複もないことを検証する。
 *
 * 原典のスコア表には実際に穴があった（§0.2 の ① の 1〜2%）。同じ事故を
 * 再発させないよう、各指標の区分表定数をこれに通すテストを必ず書くこと。
 *
 * ライブラリの読み込み時ではなくテストで呼ぶ。モジュールの副作用として throw すると、
 * 画面から import したときにビルド時・実行時のエラーになり原因が追いにくい。
 *
 * @throws 穴・重複がある場合、または最上位区分に上限がある場合
 */
export function assertContiguous(bands: readonly ScoreBand[]): void {
  if (bands.length === 0) throw new Error('区分表が空です');

  // 下限 null（下限なし）は最下段とみなす。null が複数あっても比較が NaN にならないよう
  // 数値へ寄せずに三値で返す。
  const sorted = [...bands].sort((a, b) => {
    if (a.minInclusive === b.minInclusive) return 0;
    if (a.minInclusive === null) return -1;
    if (b.minInclusive === null) return 1;
    return a.minInclusive - b.minInclusive;
  });

  const top = sorted[sorted.length - 1];
  if (top === undefined || top.maxExclusive !== null) {
    throw new Error(
      `区分表の最上位に上限があります（maxExclusive=${String(top?.maxExclusive)}）。` +
        '最上位は「下限以上」で開いている必要があります',
    );
  }

  for (let i = 0; i < sorted.length - 1; i++) {
    const lower = sorted[i];
    const upper = sorted[i + 1];
    if (lower === undefined || upper === undefined) continue;
    if (lower.maxExclusive !== upper.minInclusive) {
      throw new Error(
        `区分表に穴または重複があります: ${lower.points}点の上限 ${String(lower.maxExclusive)} と ` +
          `${upper.points}点の下限 ${String(upper.minInclusive)} が一致しません`,
      );
    }
  }
}
