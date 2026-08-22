/**
 * 「満点となる基準値」から区分表をスケーリングする（T-100 / ADR-0012 D-2）。
 *
 * ユーザーが指標ごとに「これ以上で満点」という基準値を1つ指定すると、
 * `bands.ts` のデフォルト区分表を比例縮尺してユーザー専用の区分表を作る。
 *
 * ```
 * scale = 基準値 ÷ デフォルト満点境界
 * 新境界[i] = デフォルト境界[i] × scale   （i は全境界。null はそのまま null）
 * ```
 *
 * `bands.ts` / `score-band.ts` は変更しない（T-100 の制約）。この関数はそれらの
 * 定数・型を読むだけの新規追加である。
 */

import { type DomainError } from '../shared/domain-error';
import { type Result, err, ok } from '../shared/result';
import { type ScoreBand, validateBands } from './score-band';

/**
 * デフォルト区分表から「満点となる基準値（デフォルト満点境界）」を導出する。
 *
 * 最高得点区分（`points` が最大の区分）を探し、その区分がどちら向きに開いているかで
 * 昇順・降順を機械的に判定する:
 * - 昇順（上が開いている。`maxExclusive === null`）→ 満点境界は下限（`minInclusive`）
 * - 降順（③ 予想配当性向。上が閉じている）→ 満点境界は上限（`maxExclusive`）
 *
 * 「向き」を引数で受け取らないのは、`bands.ts` の値をそのまま使い書き写さない
 * （`get-scoring-bands.ts` と同じ）方針を、この関数でも保つため。
 */
export function deriveDefaultBaseline(
  bands: readonly ScoreBand[],
): Result<number, DomainError> {
  if (bands.length === 0) return err({ kind: 'ThresholdEmpty' });

  const topBand = bands.reduce((max, band) => (band.points > max.points ? band : max));

  if (topBand.maxExclusive === null) {
    // 昇順: 最上位区分は上が開いている。下限が満点境界。
    if (topBand.minInclusive === null) {
      // 理論上どの既存10指標にも発生しない防御的分岐（下限・上限とも null は
      // 「全区間が1区分」を意味し、区分表として成立しない）。
      return err({ kind: 'BaselineUndeterminable' });
    }
    return ok(topBand.minInclusive);
  }

  // 降順（③ 予想配当性向）: 最高得点区分は上限で閉じている。上限が満点境界。
  return ok(topBand.maxExclusive);
}

/**
 * デフォルト区分表を「満点となる基準値」でスケーリングする。
 *
 * @param defaultBands `bands.ts` のデフォルト区分表定数（10指標のいずれか）。
 *   **⑨ MIX係数（`MIX_COEFFICIENT_BANDS`）に使用しないこと**（ADR-0012 D-2:
 *   MIX係数はユーザー設定不可）。この制約は型では強制しない。
 *   呼び出し禁止の担保は usecase 層（T-101）の責務。
 * @param baselineValue ユーザーが指定した「満点となる基準値」。正でなければならない
 *   （ADR-0012 D-2 制約1）。⑩ 配当利回りは `bands.ts` と同じ 1/100% 単位の整数で渡すこと。
 * @returns スケール後の区分表。`validateBands()` を必ず経由するため、
 *   丸め誤差で境界が接触・逆転した入力は `ThresholdNotAscending` 等として弾かれる
 */
export function scaleBands(
  defaultBands: readonly ScoreBand[],
  baselineValue: number,
): Result<readonly ScoreBand[], DomainError> {
  // 否定形で書く（`score-band.ts` の `lookupPoints` と同じ理由）。
  // `NaN > 0` は false なので `!(NaN > 0)` は true になり NaN も確実に拒否できる。
  // 肯定形 `baselineValue <= 0` だと `NaN <= 0` も false になり素通りしてしまう。
  if (!(baselineValue > 0)) {
    return err({ kind: 'BaselineNotPositive', value: baselineValue });
  }

  const baselineResult = deriveDefaultBaseline(defaultBands);
  if (!baselineResult.ok) return baselineResult;

  const scale = baselineValue / baselineResult.value;
  const scaledBands = defaultBands.map((band) => ({
    minInclusive: band.minInclusive === null ? null : band.minInclusive * scale,
    maxExclusive: band.maxExclusive === null ? null : band.maxExclusive * scale,
    points: band.points,
  }));

  return validateBands(scaledBands);
}
