/**
 * ユースケース: 10指標の区分表を評価基準画面向けに返す（T-099）。
 *
 * `src/domain/scoring/bands.ts` は変更しない（タスクの制約）。この関数は
 * `MetricKey → 区分表定数` の対応表を1回だけ定義し、`METRIC_KEYS`（①〜⑩の順）で
 * ループしてそのまま返す薄い委譲に留める。DB非経由・入力なしの同期関数。
 *
 * `bands.ts` の定数を1つ変えれば、この関数の戻り値も追従して変わる（値を書き写さない。
 * `docs/02_design/ui/pages/criteria-tab.md` §4 が求める「二重管理でない」ことの担保）。
 */

import {
  CONSECUTIVE_YEARS_BANDS,
  DIVIDEND_GROWTH_RATE_BANDS,
  DIVIDEND_SUSTAINABILITY_BANDS,
  DIVIDEND_YIELD_BANDS,
  EPS_CAGR_BANDS,
  MIX_COEFFICIENT_BANDS,
  OPERATING_MARGIN_BANDS,
  PAYOUT_RATIO_BANDS,
  REVENUE_CAGR_BANDS,
  ROE_AVERAGE_BANDS,
} from '../domain/scoring/bands';
import { type ScoreBand } from '../domain/scoring/score-band';
import {
  METRIC_KEYS,
  METRIC_LABEL,
  METRIC_NUMBER,
  METRIC_UNIT,
  type MetricKey,
  type MetricUnit,
} from '../domain/shared/metric-key';

/** `MetricKey` → 区分表定数の対応表。`bands.ts` 自体には `MetricKey` との対応が無いためここで1回だけ定義する */
const BANDS_BY_METRIC: Readonly<Record<MetricKey, readonly ScoreBand[]>> = {
  dividendGrowthRate: DIVIDEND_GROWTH_RATE_BANDS,
  consecutiveYears: CONSECUTIVE_YEARS_BANDS,
  payoutRatio: PAYOUT_RATIO_BANDS,
  epsCagr: EPS_CAGR_BANDS,
  roeAverage: ROE_AVERAGE_BANDS,
  dividendSustainability: DIVIDEND_SUSTAINABILITY_BANDS,
  revenueCagr: REVENUE_CAGR_BANDS,
  operatingMargin: OPERATING_MARGIN_BANDS,
  mixCoefficient: MIX_COEFFICIENT_BANDS,
  dividendYield: DIVIDEND_YIELD_BANDS,
};

/** 1指標分の区分表。usecase内部の戻り値型（DTOはhandler側で別に定義する） */
export interface MetricBands {
  readonly key: MetricKey;
  /** 原典での通し番号（①〜⑩） */
  readonly number: number;
  readonly label: string;
  readonly unit: MetricUnit;
  readonly bands: readonly ScoreBand[];
}

/**
 * 10指標分の区分表を `METRIC_KEYS`（①〜⑩）の順で返す。
 *
 * 段数（③は10段、②は4段）や特殊値（⑤の `minInclusive: null`、⑨の最上位0点）を
 * 揃えたり補完したりしない。`bands.ts` の値をそのまま渡す。
 */
export function getScoringBands(): readonly MetricBands[] {
  return METRIC_KEYS.map((key) => ({
    key,
    number: METRIC_NUMBER[key],
    label: METRIC_LABEL[key],
    unit: METRIC_UNIT[key],
    bands: BANDS_BY_METRIC[key],
  }));
}
