/**
 * 年度系列に対する集計。10指標が共有する純粋関数。
 *
 * すべて「必要な年数が揃っていて `null` を含まないこと」を先に検査し、
 * 揃っていなければ計算せずに `null` を返す。欠損を 0 とみなして平均すると
 * 実際より低い値が出て、投資判断が変わる（`scoring-requirements.md` §0.5）。
 */

/**
 * 系列の先頭 `years` 年分を取り出す。`null` を1つでも含む、または年数が足りなければ `null`。
 *
 * 系列は**年度降順**（先頭が直近）で受け取る。並び順は取り込み層の責務であり、
 * ここでは並べ替えない。並べ替えを両方の層でやると、どちらが正か分からなくなる。
 */
export function takeCompleteYears(
  series: readonly (number | null)[],
  years: number,
): number[] | null {
  if (series.length < years) return null;

  const window: number[] = [];
  for (let i = 0; i < years; i++) {
    const value = series[i];
    if (value === null || value === undefined) return null;
    if (!Number.isFinite(value)) return null;
    window.push(value);
  }
  return window;
}

/** 単純平均。空配列は呼び出し側で弾く前提なので `NaN` を返さないよう検査する */
export function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sum = values.reduce((accumulator, value) => accumulator + value, 0);
  const result = sum / values.length;
  return Number.isFinite(result) ? result : null;
}

/**
 * 中央値。偶数個なら中央2つの平均。
 *
 * ④ EPS CAGR が一過性の特別損益をならすために使う（設計書 §3）。
 * 元の配列を破壊しないようコピーしてから並べ替える。
 */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 1) {
    const value = sorted[middle];
    return value === undefined ? null : value;
  }
  const lower = sorted[middle - 1];
  const upper = sorted[middle];
  if (lower === undefined || upper === undefined) return null;
  return (lower + upper) / 2;
}

/**
 * 年平均成長率（%）。`(current / base)^(1/years) - 1` を百分率で返す。
 *
 * `base <= 0` は呼び出し側で弾くこと。ここでは弾かず `null` を返すだけにして、
 * 「ゼロ除算」と「基準が負で成長率を定義できない」を指標側が区別できるようにする。
 *
 * @returns 計算できなければ `null`（`NaN` / `Infinity` を下流に流さない）
 */
export function cagrPercent(current: number, base: number, years: number): number | null {
  if (base <= 0 || years <= 0) return null;
  if (!Number.isFinite(current) || !Number.isFinite(base)) return null;
  // current が負なら実数の冪根が定義できない。0 は 0^(1/n)=0 で -100% になる
  if (current < 0) return null;

  const ratio = current / base;
  const growth = Math.pow(ratio, 1 / years) - 1;
  if (!Number.isFinite(growth)) return null;
  return growth * 100;
}
