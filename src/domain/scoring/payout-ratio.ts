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
 *
 * 2026-09-23（T-108 / 設計書 §10）: 解析ダイアログの③詳細のため、各組に**計算根拠**
 * （選ばれた配当・EPS とその年度、年度の食い違い、0点規則、該当区分の添字）を、
 * 結果全体に**採点に使った区分表**を出力する。あわせて年度の突き合わせ（ADR-0009 の
 * 結合規則）を呼び出し側（`score-company.ts`）からこのファイルの内部へ移した。
 * 年度が食い違っても入力を `null` 化せずに受け取るので、画面へ値を参考表示できる。
 * **点数の判定結果は変えていない。**
 */

import { type MetricScore, isScored, scored, unavailable } from '../shared/metric-score';
import { type Score, scoreFromValidatedBand } from '../shared/score';
import { isSen } from '../shared/sen';
import { PAYOUT_RATIO_BANDS } from './bands';
import { scoreByBandsWithIndex } from './metric-lookup';
import { type ScoreBand } from './score-band';

/**
 * 予想・実績どちらの組にも使う片側の入力。
 *
 * 呼び出し側は選んだレコードの値と年度を**そのまま**渡す。年度が食い違っても
 * `null` にしない（年度の比較はこの関数群の内部で行う。設計書 §2 R1）。
 */
export interface PayoutRatioSideInput {
  /** その期の1株配当（銭） */
  readonly dividendSen: number | null;
  /** 上記配当の決算年度。配当レコードが無ければ `null` */
  readonly dividendFiscalYear: number | null;
  /** その期の1株利益（銭）。**負（赤字）がありうる** */
  readonly epsSen: number | null;
  /** 上記 EPS の決算年度。業績レコードが無ければ `null` */
  readonly epsFiscalYear: number | null;
}

export interface PayoutRatioInput {
  /** 今期予想の組。年度の比較は `calculatePayoutRatio` の内部で行う（T-108 / 設計書 §2 R1） */
  readonly forecast: PayoutRatioSideInput;
  /** 直近実績の組。年度突き合わせの規則は予想側と同じ（設計書 §2 / §6.4.1） */
  readonly actual: PayoutRatioSideInput;
  /** `true` なら実績を採点へ強制採用する（予想へフォールバックしない。設計書 §5.1 決定1） */
  readonly useActualForScoring: boolean;
}

/**
 * ③ の片側（予想または実績）の判定結果と計算根拠（設計書 §10.1）。
 *
 * 全指標共通の `MetricScore` は拡張せず、`metric` にそのままネストする
 * （③専用のフィールドを共通型に漏らさないため）。
 */
export interface PayoutRatioSideResult {
  /** 判定そのもの。score / value / unavailableReason */
  readonly metric: MetricScore;
  /** 選ばれたレコードの値と年度。年度が食い違っても `null` にしない（表示用） */
  readonly evidence: {
    readonly dividendSen: number | null;
    readonly dividendFiscalYear: number | null;
    readonly epsSen: number | null;
    readonly epsFiscalYear: number | null;
  };
  /** 配当と EPS の年度がどちらも非 null で、かつ異なるとき `true`（このとき判定は input-missing） */
  readonly fiscalYearMismatch: boolean;
  /** §0.3（赤字）/ §0.4（無配）の規則で 0点にしたときの規則。区分表で 0点になった場合は `null` */
  readonly zeroScoreRule: 'negative-eps' | 'no-dividend' | null;
  /** 区分表の何番目に当たったか（0始まり）。判定不能・`zeroScoreRule` が非 `null` なら `null` */
  readonly matchedBandIndex: number | null;
}

/**
 * ③ の判定結果。
 *
 * **`source` を判別子にした判別可能ユニオン**（⑩ `DividendYieldResult` と同じ発想）。
 * `forecast` / `actual` は採点への採用と無関係に常に判定結果を持つ（表示用。設計書 §2）。
 * トップレベルには `unavailableReason` を持たせない（設計書 §2 の出力表どおり）。
 * 採点用の理由コードが必要な場合は `payoutRatioToMetricScore()` を使う。
 *
 * `bands` は**この採点に実際に使った区分表**（設計書 §10.1 Y1）。引数で受け取った表を
 * そのまま返し、組み立て直さない。
 */
export type PayoutRatioResult =
  | {
      readonly score: Score;
      readonly value: number;
      readonly source: 'forecast' | 'actual';
      readonly forecast: PayoutRatioSideResult;
      readonly actual: PayoutRatioSideResult;
      readonly bands: readonly ScoreBand[];
    }
  | {
      readonly score: null;
      readonly value: null;
      readonly source: null;
      readonly forecast: PayoutRatioSideResult;
      readonly actual: PayoutRatioSideResult;
      readonly bands: readonly ScoreBand[];
    };

/** 判定の内訳（`metric` / `zeroScoreRule` / `matchedBandIndex`）。evidence 類は呼び出し側で足す */
type SideJudgement = Pick<PayoutRatioSideResult, 'metric' | 'zeroScoreRule' | 'matchedBandIndex'>;

function withoutBand(metric: MetricScore): SideJudgement {
  return { metric, zeroScoreRule: null, matchedBandIndex: null };
}

/**
 * 値だけで配当性向を判定する（年度の比較は済んでいる前提）。
 *
 * 2つの 0点は原典の欠陥を埋めたもので、いずれも意図的（§0.3 / §0.4）:
 * - **EPS が負（赤字）→ 0点。** 原典のままだと配当性向が負になり
 *   「0%〜25% → 10点」に該当して**赤字企業が満点**を取った
 * - **無配（配当 0）→ 0点。** 配当性向 0% は数値上は最上位区分だが、
 *   高配当銘柄を探す目的に反する
 *
 * EPS が 0 はゼロ除算で**判定不能**。0点と混同しないこと。
 */
function judgeSideValues(
  dividendSen: number | null,
  epsSen: number | null,
  bands: readonly ScoreBand[],
): SideJudgement {
  if (dividendSen === null || epsSen === null) return withoutBand(unavailable('input-missing'));
  if (!isSen(dividendSen) || !isSen(epsSen)) return withoutBand(unavailable('input-invalid'));

  // 配当が負になるのは制度上ありえない。データ不良として判定不能にする
  if (dividendSen < 0) return withoutBand(unavailable('input-invalid'));

  if (epsSen === 0) return withoutBand(unavailable('division-by-zero'));

  const ratioPercent = (dividendSen / epsSen) * 100;

  // §0.3: EPS が赤字なら 0点。区分表を引く前に落とす（負の性向は表外）。
  // 配当 0 かつ赤字もここに来る（赤字を優先する。設計書 §10.3 Y2）
  if (epsSen < 0) {
    return {
      metric: scored(scoreFromValidatedBand(0), ratioPercent),
      zeroScoreRule: 'negative-eps',
      matchedBandIndex: null,
    };
  }

  // §0.4: 無配は 0点。配当性向 0% は表の最上位（10点）に該当してしまうため、
  // 「性向が 0%」ではなく「配当額が 0」で分岐する
  if (dividendSen === 0) {
    return {
      metric: scored(scoreFromValidatedBand(0), 0),
      zeroScoreRule: 'no-dividend',
      matchedBandIndex: null,
    };
  }

  // 点数と添字を同じルックアップから得る（設計書 §10.2。70%以上の 0点もここ）
  const { metric, bandIndex } = scoreByBandsWithIndex(bands, ratioPercent);
  return { metric, zeroScoreRule: null, matchedBandIndex: bandIndex };
}

/**
 * 配当性向を1組（予想または実績）ぶん判定し、計算根拠を添えて返す。
 *
 * **年度の食い違いを他のどの検査よりも先に判定する。** 旧実装では呼び出し側が
 * 年度不一致のとき両方を `null` にして渡していたため、年度不一致なら配当が負でも
 * EPS が 0 でも `input-missing` になっていた。この順序を崩すと判定結果が変わる。
 *
 * @param bands 判定に使う区分表
 */
function calculateSidePayoutRatio(
  input: PayoutRatioSideInput,
  bands: readonly ScoreBand[],
): PayoutRatioSideResult {
  const { dividendSen, dividendFiscalYear, epsSen, epsFiscalYear } = input;
  const evidence = { dividendSen, dividendFiscalYear, epsSen, epsFiscalYear };
  // 年度の一方が null（値あり・年度不明）は食い違いとして扱わない（設計書 §10.1 の字義どおり）
  const fiscalYearMismatch =
    dividendFiscalYear !== null && epsFiscalYear !== null && dividendFiscalYear !== epsFiscalYear;

  // ADR-0009 の結合規則: 最新の年度で両方が揃わなければ判定不能。古い年度へ寄せない
  const judgement = fiscalYearMismatch
    ? withoutBand(unavailable('input-missing'))
    : judgeSideValues(dividendSen, epsSen, bands);

  return { ...judgement, evidence, fiscalYearMismatch };
}

/**
 * 予想・実績それぞれの配当性向を判定し、`useActualForScoring` に従って
 * 採点へ採用する側を選ぶ（設計書 §5.1 のソース選択規則）。
 *
 * 年度の突き合わせ（ADR-0009 の結合規則）はここ（`calculateSidePayoutRatio`）で行う。
 * 呼び出し側は年度を比較しない（T-108）。
 *
 * @param bands 判定に使う区分表。省略時は `bands.ts` のデフォルト定数（T-101で追加）。
 *   予想・実績の両側に**同じ区分表**を渡す（異なる区分表を使う理由が無いため）。
 *   結果の `bands` にはこの表がそのまま入る
 */
export function calculatePayoutRatio(
  input: PayoutRatioInput,
  bands: readonly ScoreBand[] = PAYOUT_RATIO_BANDS,
): PayoutRatioResult {
  const forecast = calculateSidePayoutRatio(input.forecast, bands);
  const actual = calculateSidePayoutRatio(input.actual, bands);
  const unscored = { score: null, value: null, source: null, forecast, actual, bands } as const;

  if (input.useActualForScoring) {
    // 決定1: 実績を明示指定したら強制採用する。実績が判定不能でも
    // 予想へフォールバックしない（ADR-0009「フォールバックしない」原則と同じ考え方）
    if (isScored(actual.metric)) {
      return {
        score: actual.metric.score,
        value: actual.metric.value,
        source: 'actual',
        forecast,
        actual,
        bands,
      };
    }
    return unscored;
  }

  // 決定2: 既定は予想優先
  if (isScored(forecast.metric)) {
    return {
      score: forecast.metric.score,
      value: forecast.metric.value,
      source: 'forecast',
      forecast,
      actual,
      bands,
    };
  }
  // 決定3: 予想が判定不能なら実績にフォールバック
  if (isScored(actual.metric)) {
    return {
      score: actual.metric.score,
      value: actual.metric.value,
      source: 'actual',
      forecast,
      actual,
      bands,
    };
  }
  // 決定4: 両方判定不能
  return unscored;
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
    result.forecast.metric.unavailableReason ??
      result.actual.metric.unavailableReason ??
      'input-missing',
  );
}
