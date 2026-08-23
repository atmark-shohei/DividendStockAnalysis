import type { ScoringBandsResponse } from '../api';

/**
 * `MetricKey`（`src/domain/shared/metric-key.ts`）を frontend からランタイム import しない
 * （ADR-0008 の allowlist は `src/domain/company/` の副作用なし関数限定で `shared/` は対象外）。
 * BE DTO（`ScoringBandsResponse`）が既に持つ型から type alias として取り出す
 * （`frontend/pages/criteria-content.ts` と同じ手法。二重定義しない）。
 */
export type MetricKey = ScoringBandsResponse['metrics'][number]['key'];

/** `MetricUnit`（`src/domain/shared/metric-key.ts`）の type alias。理由は `MetricKey` と同じ */
export type MetricUnit = ScoringBandsResponse['metrics'][number]['unit'];

export interface IndicatorConstraint {
  readonly step: number;
  readonly min: number;
  readonly max: number;
}

/**
 * 指標カスタマイズ画面（`docs/02_design/ui/pages/indicator-custom-page.md` §3）の制約表。
 *
 * **意図的なFEローカル再定義**（`frontend/routes.ts` の `COMPANY_SORT_KEYS` と同じ理由。
 * ADR-0008 により `src/domain/shared/metric-key.ts` をランタイム import できないため）。
 * §3 の表が変わったら手動で追従させること。UIの `min` はここが正で、§4 の
 * 「基準値 > 0」追加ガードは `basisValueErrorText`（`indicator-custom-logic.ts`）が別途行う。
 * ⑨MIX係数は設定不可のため `null`（derived）。
 */
export const INDICATOR_CONSTRAINTS: Readonly<Record<MetricKey, IndicatorConstraint | null>> = {
  dividendGrowthRate: { step: 0.1, min: 0, max: 50 },
  consecutiveYears: { step: 1, min: 0, max: 50 },
  payoutRatio: { step: 1, min: -100, max: 500 },
  epsCagr: { step: 0.1, min: 0, max: 50 },
  roeAverage: { step: 0.1, min: 0, max: 100 },
  dividendSustainability: { step: 1, min: -100, max: 100 },
  revenueCagr: { step: 1, min: 0, max: 100 },
  operatingMargin: { step: 0.1, min: 0, max: 50 },
  mixCoefficient: null,
  dividendYield: { step: 0.1, min: 0, max: 50 },
};

/**
 * ③予想配当性向だけ区分表が降順（値が小さいほど高得点）。基準値の意味が「この値未満で満点」
 * になる（`indicator-custom-page.md` §4.0）。ADR-0008 により `bands.ts` から機械的に
 * 向きを判定できないため、キー名の決め打ちで判定する（`ListPage.tsx` の
 * `activeMetric.key === 'dividendGrowthRate'` と同型の既存イディオム）。
 * 10指標の構成が変わらない限り固定の事実（決定事項。fe-plan.md §0-C）。
 */
export const REVERSED_DIRECTION_KEYS: ReadonlySet<MetricKey> = new Set(['payoutRatio']);

/** ③の行に表示する注記（`indicator-custom-page.md` §4.0・§8受入基準） */
export const PAYOUT_RATIO_DIRECTION_NOTE =
  '配当性向はこの値未満で満点になります（他の指標と逆向きです）。';
