/**
 * ユースケース: 指標カスタマイズ設定を全置換保存する（PUT /api/indicator-settings）。
 *
 * 仕様: `docs/02_design/api/portfolio-api.md` §指標カスタマイズ、
 * `docs/02_design/ui/pages/indicator-custom-page.md` §3・§4（基準値の追加ガード）。
 * zod境界の外側の検証（件数・基準値の範囲・ドメイン検証）をすべてここに集約する
 * （BE計画 §3）。
 */

import { scaleBands } from '../domain/scoring/band-scaling';
import {
  type BasisValueKey,
  type UserIndicatorSettings,
} from '../domain/scoring/user-indicator-settings';
import { type UserIndicatorSettingsRepository } from '../domain/scoring/user-indicator-settings-repository';
import { type DomainError } from '../domain/shared/domain-error';
import { type MetricKey } from '../domain/shared/metric-key';
import { type Result, err, ok } from '../domain/shared/result';
import { BANDS_BY_METRIC } from './get-scoring-bands';

const MIN_SELECTED_COUNT = 5;
const MAX_SELECTED_COUNT = 10;

interface BasisValueConstraint {
  readonly step: number;
  readonly min: number;
  readonly max: number;
}

/**
 * 指標ごとの基準値の きざみ・下限・上限（`indicator-custom-page.md` §3 の制約表）。
 *
 * ③予想配当性向・⑥配当維持可能年数は表の `min` が `-100` だが、
 * [ADR-0012](../../docs/adr/0012-indicator-customization-scaling-and-denominator.md) §4 の
 * 「基準値は常に正」制約により実効下限は0より大きい値になる。この表の `min` はUIの
 * 表示値をそのまま転記したもので、正であることの検証は別ステップ（`checkPositive`）で行う。
 */
const BASIS_VALUE_CONSTRAINTS: Readonly<Record<BasisValueKey, BasisValueConstraint>> = {
  dividendGrowthRate: { step: 0.1, min: 0, max: 50 },
  consecutiveYears: { step: 1, min: 0, max: 50 },
  payoutRatio: { step: 1, min: -100, max: 500 },
  epsCagr: { step: 0.1, min: 0, max: 50 },
  roeAverage: { step: 0.1, min: 0, max: 100 },
  dividendSustainability: { step: 1, min: -100, max: 100 },
  revenueCagr: { step: 1, min: 0, max: 100 },
  operatingMargin: { step: 0.1, min: 0, max: 50 },
  dividendYield: { step: 0.1, min: 0, max: 50 },
};

export type SaveIndicatorSettingsError =
  | { readonly kind: 'selected-count-out-of-range'; readonly count: number }
  | { readonly kind: 'mix-coefficient-basis-value-present' }
  | { readonly kind: 'basis-value-missing'; readonly key: BasisValueKey }
  | {
      readonly kind: 'basis-value-not-positive';
      readonly key: BasisValueKey;
      readonly value: number;
    }
  | {
      readonly kind: 'basis-value-out-of-range';
      readonly key: BasisValueKey;
      readonly value: number;
    }
  | {
      readonly kind: 'invalid-bands';
      readonly key: BasisValueKey;
      readonly domainError: DomainError;
    };

/**
 * PUTリクエストの入力。zod境界（`dto/indicator-settings.ts`）を通過した直後の形。
 *
 * `basisValues` のキーはまだ `BasisValueKey` に絞らない。⑨MIX係数キーの有無を
 * ここで明示的に検査し、専用のエラーメッセージ
 * （`{ "error": "MIX係数の基準値は指定できません" }`）を返すため
 * （`portfolio-api.md` §指標カスタマイズ。zodの型で構造的に弾くと、汎用の
 * zod issue形式になってしまい、この専用メッセージを出せない）。
 */
export interface SaveIndicatorSettingsRequest {
  readonly selected: readonly MetricKey[];
  readonly basisValues: Readonly<Record<string, number>>;
}

/** 値が `step` の倍数か（浮動小数点誤差を許容） */
function isMultipleOfStep(value: number, step: number): boolean {
  const scaled = value / step;
  return Math.abs(scaled - Math.round(scaled)) < 1e-6;
}

/** ⑩配当利回りの基準値単位変換。`%` 小数 → 1/100%整数（`resolve-scoring-bands.ts` と同じ変換） */
function toDividendYieldBaselineHundredths(basisValuePercent: number): number {
  return Math.round(basisValuePercent * 100);
}

/**
 * 指標カスタマイズ設定を検証して全置換保存する。
 *
 * 検証順序（`portfolio-api.md` §指標カスタマイズの表、上から順に）:
 * 1. `selected` の件数が 5〜10 の範囲外 → `selected-count-out-of-range`
 * 2. `basisValues` に⑨MIX係数キーが含まれる → `mix-coefficient-basis-value-present`
 * 3. `selected`（MIX係数を除く）の各キーが `basisValues` に存在するか →
 *    欠けていれば `basis-value-missing`
 * 4. 基準値が0以下 → `basis-value-not-positive`（ADR-0012 §4。全昇順・降順指標に共通）
 * 5. §3の `min`/`max`（きざみ含む）範囲外 → `basis-value-out-of-range`
 * 6. 1〜5を通過した値で `scaleBands()` → `validateBands()` 相当のドメイン検証を通す
 *    （理論上到達しない防御的分岐。基準値>0・範囲内チェック済みのため）→ `invalid-bands`
 *
 * 3〜6は選択した指標を1つずつ検査する（複数指標が同時に不正な場合、`selected` の
 * 並び順で最初に見つかった指標のエラーを返す。仕様が複数エラーの同時報告を
 * 求めていないための単純化）。
 */
export async function saveIndicatorSettings(
  repository: UserIndicatorSettingsRepository,
  userId: number,
  request: SaveIndicatorSettingsRequest,
): Promise<Result<UserIndicatorSettings, SaveIndicatorSettingsError>> {
  // 重複キーを除去してから件数を数える（同じ指標を2回選ぶ操作はUIには無いが、
  // 外から直接叩かれた場合に DB の複合PK違反を起こさないための防御）
  const selectedKeys = [...new Set(request.selected)];

  if (selectedKeys.length < MIN_SELECTED_COUNT || selectedKeys.length > MAX_SELECTED_COUNT) {
    return err({ kind: 'selected-count-out-of-range', count: selectedKeys.length });
  }

  if (Object.prototype.hasOwnProperty.call(request.basisValues, 'mixCoefficient')) {
    return err({ kind: 'mix-coefficient-basis-value-present' });
  }

  const selectedBasisKeys = selectedKeys.filter(
    (key): key is BasisValueKey => key !== 'mixCoefficient',
  );

  const resolvedBasisValues: Partial<Record<BasisValueKey, number>> = {};
  for (const key of selectedBasisKeys) {
    const value = request.basisValues[key];
    if (value === undefined) return err({ kind: 'basis-value-missing', key });
    if (!(value > 0)) return err({ kind: 'basis-value-not-positive', key, value });

    const constraint = BASIS_VALUE_CONSTRAINTS[key];
    if (
      value < constraint.min ||
      value > constraint.max ||
      !isMultipleOfStep(value, constraint.step)
    ) {
      return err({ kind: 'basis-value-out-of-range', key, value });
    }

    const baselineValue = key === 'dividendYield' ? toDividendYieldBaselineHundredths(value) : value;
    const scaled = scaleBands(BANDS_BY_METRIC[key], baselineValue);
    if (!scaled.ok) return err({ kind: 'invalid-bands', key, domainError: scaled.error });

    resolvedBasisValues[key] = value;
  }

  const settings: UserIndicatorSettings = { selectedKeys, basisValues: resolvedBasisValues };
  await repository.replaceAll(userId, settings);
  return ok(settings);
}
