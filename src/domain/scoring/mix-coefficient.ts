/**
 * 指標⑨ MIX係数（PER × PBR）。
 *
 * 仕様: `docs/02_design/logic/mix-coefficient-scoring.md`
 * **旧実装には無い新規指標。** 前例が無いので設計書だけが根拠になる。
 */

import { type MetricScore, scored, unavailable } from '../shared/metric-score';
import { scoreFromValidatedBand } from '../shared/score';
import { MIX_COEFFICIENT_BANDS } from './bands';
import { scoreByBands } from './metric-lookup';

export interface MixCoefficientInput {
  /** PER（会社予想）。倍。**負（赤字）がありうる** */
  readonly per: number | null;
  /** PBR（実績）。倍 */
  readonly pbr: number | null;
}

/**
 * MIX係数を採点する。**低いほど高得点**。
 *
 * **PER か PBR が負なら 0点**（§0.3）。負×負で MIX係数が正になると
 * 「0倍〜10倍 → 10点」に該当し、**赤字かつ債務超過の企業が満点**を取る。
 * ③ と構造的に同一の欠陥なので、同じ形で塞ぐ。
 *
 * MIX係数ちょうど 0（PER か PBR が 0）は最上位区分に該当して 10点。
 * 現実にはほぼ異常値だが、設計書 §5 が明示しているとおりに扱う。
 */
export function calculateMixCoefficient(input: MixCoefficientInput): MetricScore {
  const { per, pbr } = input;

  if (per === null || pbr === null) return unavailable('input-missing');
  if (!Number.isFinite(per) || !Number.isFinite(pbr)) return unavailable('input-invalid');

  const mix = per * pbr;
  if (!Number.isFinite(mix)) return unavailable('input-invalid');

  // 負の入力は、積が正に戻る前に落とす
  if (per < 0 || pbr < 0) return scored(scoreFromValidatedBand(0), mix);

  return scoreByBands(MIX_COEFFICIENT_BANDS, mix);
}
