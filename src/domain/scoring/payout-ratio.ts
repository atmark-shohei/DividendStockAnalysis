/**
 * 指標③ 予想配当性向・実績配当性向。
 *
 * 仕様: `docs/02_design/logic/payout-ratio-scoring.md`
 *
 * ⚠️ **この指標だけ 10段**（他は 11段）。`60〜70% → 2点` に統合した結果、
 * **1点を返す経路が無い**（2026-07-27 決定 / 設計書 §7）。バグではない。
 *
 * 2026-08-06 決定（設計書 §7）: 予想側だけだった入力に**実績側**を追加し、
 * どちらを採点へ採用するかを `useActualForScoring` で切り替えられるようにした。
 * 予想・実績は完全に独立した組として同じ式・同じ区分表・同じ例外規則で判定し、
 * 採点への採用と無関係に**常に両方の判定結果を返す**（画面が両方を表示するため）。
 */

import { type MetricScore, isScored, scored, unavailable } from '../shared/metric-score';
import { type Score, scoreFromValidatedBand } from '../shared/score';
import { isSen } from '../shared/sen';
import { PAYOUT_RATIO_BANDS } from './bands';
import { scoreByBands } from './metric-lookup';

/** 予想・実績どちらの組にも使う片側の入力 */
export interface PayoutRatioSideInput {
  /** その期の1株配当（銭） */
  readonly dividendSen: number | null;
  /** その期の1株利益（銭）。**負（赤字）がありうる** */
  readonly epsSen: number | null;
}

export interface PayoutRatioInput {
  /** 今期予想の組。年度が予想EPSと予想配当で食い違う場合、呼び出し側が null を渡す（ADR-0009） */
  readonly forecast: PayoutRatioSideInput;
  /** 直近実績の組。年度突き合わせの規則は予想側と同じ（設計書 §2 / §6.4.1） */
  readonly actual: PayoutRatioSideInput;
  /** `true` なら実績を採点へ強制採用する（予想へフォールバックしない。設計書 §5.1 決定1） */
  readonly useActualForScoring: boolean;
}

/**
 * ③ の判定結果。
 *
 * **`source` を判別子にした判別可能ユニオン**（⑩ `DividendYieldResult` と同じ発想）。
 * `forecast` / `actual` は採点への採用と無関係に常に判定結果を持つ（表示用。設計書 §2）。
 * トップレベルには `unavailableReason` を持たせない（設計書 §2 の出力表どおり）。
 * 採点用の理由コードが必要な場合は `payoutRatioToMetricScore()` を使う。
 */
export type PayoutRatioResult =
  | {
      readonly score: Score;
      readonly value: number;
      readonly source: 'forecast' | 'actual';
      readonly forecast: MetricScore;
      readonly actual: MetricScore;
    }
  | {
      readonly score: null;
      readonly value: null;
      readonly source: null;
      readonly forecast: MetricScore;
      readonly actual: MetricScore;
    };

/**
 * 配当性向を1組（予想または実績）ぶん判定する。
 *
 * 2つの 0点は原典の欠陥を埋めたもので、いずれも意図的（§0.3 / §0.4）:
 * - **EPS が負（赤字）→ 0点。** 原典のままだと配当性向が負になり
 *   「0%〜25% → 10点」に該当して**赤字企業が満点**を取った
 * - **無配（配当 0）→ 0点。** 配当性向 0% は数値上は最上位区分だが、
 *   高配当銘柄を探す目的に反する
 *
 * EPS が 0 はゼロ除算で**判定不能**。0点と混同しないこと。
 */
function calculateSidePayoutRatio(input: PayoutRatioSideInput): MetricScore {
  const { dividendSen, epsSen } = input;

  if (dividendSen === null || epsSen === null) return unavailable('input-missing');
  if (!isSen(dividendSen) || !isSen(epsSen)) return unavailable('input-invalid');

  // 配当が負になるのは制度上ありえない。データ不良として判定不能にする
  if (dividendSen < 0) return unavailable('input-invalid');

  if (epsSen === 0) return unavailable('division-by-zero');

  const ratioPercent = (dividendSen / epsSen) * 100;

  // §0.3: EPS が赤字なら 0点。区分表を引く前に落とす（負の性向は表外）
  if (epsSen < 0) return scored(scoreFromValidatedBand(0), ratioPercent);

  // §0.4: 無配は 0点。配当性向 0% は表の最上位（10点）に該当してしまうため、
  // 「性向が 0%」ではなく「配当額が 0」で分岐する
  if (dividendSen === 0) return scored(scoreFromValidatedBand(0), 0);

  return scoreByBands(PAYOUT_RATIO_BANDS, ratioPercent);
}

/**
 * 予想・実績それぞれの配当性向を判定し、`useActualForScoring` に従って
 * 採点へ採用する側を選ぶ（設計書 §5.1 のソース選択規則）。
 */
export function calculatePayoutRatio(input: PayoutRatioInput): PayoutRatioResult {
  const forecastResult = calculateSidePayoutRatio(input.forecast);
  const actualResult = calculateSidePayoutRatio(input.actual);

  if (input.useActualForScoring) {
    // 決定1: 実績を明示指定したら強制採用する。実績が判定不能でも
    // 予想へフォールバックしない（ADR-0009「フォールバックしない」原則と同じ考え方）
    if (isScored(actualResult)) {
      return {
        score: actualResult.score,
        value: actualResult.value,
        source: 'actual',
        forecast: forecastResult,
        actual: actualResult,
      };
    }
    return { score: null, value: null, source: null, forecast: forecastResult, actual: actualResult };
  }

  // 決定2: 既定は予想優先
  if (isScored(forecastResult)) {
    return {
      score: forecastResult.score,
      value: forecastResult.value,
      source: 'forecast',
      forecast: forecastResult,
      actual: actualResult,
    };
  }
  // 決定3: 予想が判定不能なら実績にフォールバック
  if (isScored(actualResult)) {
    return {
      score: actualResult.score,
      value: actualResult.value,
      source: 'actual',
      forecast: forecastResult,
      actual: actualResult,
    };
  }
  // 決定4: 両方判定不能
  return { score: null, value: null, source: null, forecast: forecastResult, actual: actualResult };
}

/**
 * ③ の結果を全指標共通の形に変換する。総合点の集計で使う（⑩ `dividendYieldToMetricScore`
 * に相当）。
 *
 * 採用した側があればその値をそのまま使う。両方判定不能の場合の理由コードは、
 * 設計書 §5.1 決定4「`unavailableReason` は予想側の理由を返す」を出発点に、
 * **予想側に理由が無い場合（`useActualForScoring: true` で予想は判定可能・実績が
 * 判定不能なケース）は実績側の理由にフォールバックする**。このケースは設計書が
 * 明示していない拡張だが、Manager 決定（0.2）により採用した解釈で、
 * 「両方判定不能なら理由を返す」という §5.1 の意図を矛盾なく満たす最小の実装。
 * **2026-08-06 ユーザー確認済み**（この解釈のまま実装を維持してよいことを確認済み）。
 */
export function payoutRatioToMetricScore(result: PayoutRatioResult): MetricScore {
  if (result.source !== null) return scored(result.score, result.value);
  return unavailable(
    result.forecast.unavailableReason ?? result.actual.unavailableReason ?? 'input-missing',
  );
}
