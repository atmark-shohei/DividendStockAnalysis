/**
 * CAGR の境界値テスト用ヘルパー。
 *
 * 成長率は `(終値/始値)^(1/年数) - 1` なので、閾値ちょうどの入力は一般に整数にならない。
 * 銭は整数なので「閾値ちょうど」は**1銭刻みで表現できる最も近い点**として作る。
 * 単一の値を当てるより、閾値をまたぐ 1 銭差の対を見るほうが強い検査になる。
 *
 * ⚠️ `Math.pow(x, 5)` と `Math.pow(y, 1/5)` は浮動小数点では厳密な逆関数にならない。
 * 逆算した値をそのまま使うと、閾値をわずかに下回って区分が1つずれる。
 * そのため**逆算した候補を順方向の式で検算し、条件を満たすまで1銭ずつ動かす**。
 * 呼び出し側は返ってきた値の実際の成長率も併せて検証すること。
 */

/** 基準額（銭）。丸め誤差が閾値の刻み（2%）より十分小さくなる大きさ */
export const CAGR_BASE_SEN = 1_000_000_000;

/** 本番実装と同じ形で成長率（%）を求める。ヘルパーの検算用 */
export function growthPercentOf(current: number, base: number, years = 5): number {
  return (Math.pow(current / base, 1 / years) - 1) * 100;
}

/** 成長率が `percent` 以上になる最小の終値（銭） */
export function atLeastGrowth(percent: number, years = 5, base = CAGR_BASE_SEN): number {
  let candidate = Math.ceil(base * Math.pow(1 + percent / 100, years));
  // 逆算の誤差はたかだか数 ulp なので数回で収束する。無限ループを避けるため上限を置く
  for (let i = 0; i < 100 && growthPercentOf(candidate, base, years) < percent; i++) {
    candidate++;
  }
  return candidate;
}

/** 成長率が `percent` を確実に下回る終値（銭） */
export function justUnderGrowth(percent: number, years = 5, base = CAGR_BASE_SEN): number {
  let candidate = Math.floor(base * Math.pow(1 + percent / 100, years)) - 1;
  for (let i = 0; i < 100 && growthPercentOf(candidate, base, years) >= percent; i++) {
    candidate--;
  }
  return candidate;
}
