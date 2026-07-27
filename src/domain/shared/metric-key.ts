/**
 * 指標の識別子。①〜⑩（`docs/01_requirements/scoring-requirements.md`）。
 *
 * 画面・保存・集計が指標を横断して扱うための唯一の語彙。ここに無い指標は存在しない。
 * 総合点の分母を 100点に固定する（§0.5）ため、**要素数が 10 であること**を
 * テストで固定する。
 */

export const METRIC_KEYS = [
  'dividendGrowthRate', // ① 直近5年間の増配率（CAGR）
  'consecutiveYears', // ② 連続非減配年数
  'payoutRatio', // ③ 予想配当性向
  'epsCagr', // ④ EPS の5年 CAGR
  'roeAverage', // ⑤ ROE の5年平均
  'dividendSustainability', // ⑥ 配当維持可能年数
  'revenueCagr', // ⑦ 売上高の5年 CAGR
  'operatingMargin', // ⑧ 営業利益率の5年平均
  'mixCoefficient', // ⑨ MIX係数（PER × PBR）
  'dividendYield', // ⑩ 配当利回り
] as const;

export type MetricKey = (typeof METRIC_KEYS)[number];

/** 原典での通し番号（①〜⑩）。画面の並び順と見出しに使う */
export const METRIC_NUMBER: Readonly<Record<MetricKey, number>> = {
  dividendGrowthRate: 1,
  consecutiveYears: 2,
  payoutRatio: 3,
  epsCagr: 4,
  roeAverage: 5,
  dividendSustainability: 6,
  revenueCagr: 7,
  operatingMargin: 8,
  mixCoefficient: 9,
  dividendYield: 10,
};

/** 画面見出し。表示専用の文字列をドメインに置くのはここだけに留める */
export const METRIC_LABEL: Readonly<Record<MetricKey, string>> = {
  dividendGrowthRate: '増配率（5年CAGR）',
  consecutiveYears: '連続非減配年数',
  payoutRatio: '予想配当性向',
  epsCagr: 'EPSの5年CAGR',
  roeAverage: 'ROEの5年平均',
  dividendSustainability: '配当維持可能年数',
  revenueCagr: '売上高の5年CAGR',
  operatingMargin: '営業利益率の5年平均',
  mixCoefficient: 'MIX係数',
  dividendYield: '配当利回り',
};

/** 表示の単位。`%` / `倍` / `年` の3種 */
export const METRIC_UNIT: Readonly<Record<MetricKey, '%' | '倍' | '年'>> = {
  dividendGrowthRate: '%',
  consecutiveYears: '年',
  payoutRatio: '%',
  epsCagr: '%',
  roeAverage: '%',
  dividendSustainability: '年',
  revenueCagr: '%',
  operatingMargin: '%',
  mixCoefficient: '倍',
  dividendYield: '%',
};
