/**
 * 値オブジェクト: ユーザーの指標カスタマイズ設定（T-101）。
 *
 * 仕様: `docs/02_design/api/portfolio-api.md` §指標カスタマイズ、
 * `docs/02_design/database/schema.md` §user_indicator_settings、
 * `docs/adr/0012-indicator-customization-scaling-and-denominator.md`。
 *
 * 「選択している」は `selectedKeys` に含まれることで表す（DB側は行の存在で表現する。
 * `src/infra/d1/user-indicator-settings-repository.ts` が変換する）。
 *
 * 5〜10件・基準値の範囲・⑨MIX係数の基準値除外といった業務規則は、この型自体には
 * 持たせない。**永続化前の検証はすべて usecase 層（`save-indicator-settings.ts`）が行う**
 * （zod境界の外側の検証を1箇所に集約する方針。BE計画 §3）。この型は「検証済みの
 * 設定」を運ぶだけの読み取りモデルであり、`ScoreCard`/`MetricBands` と同じ位置づけ。
 */

import { type MetricKey } from '../shared/metric-key';

/** ⑨MIX係数を除く、基準値を持てる指標のキー */
export type BasisValueKey = Exclude<MetricKey, 'mixCoefficient'>;

export interface UserIndicatorSettings {
  /** 選択中の指標。5〜10件（検証は usecase 層） */
  readonly selectedKeys: readonly MetricKey[];
  /** 選択した指標のうち、基準値を持つもの。⑨MIX係数のキーは持たない（設定不可のため） */
  readonly basisValues: Readonly<Partial<Record<BasisValueKey, number>>>;
}
