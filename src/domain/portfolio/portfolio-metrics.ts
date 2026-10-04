/**
 * ポートフォリオ集計ロジック。
 *
 * 仕様: `docs/02_design/logic/portfolio-metrics.md`
 *
 * 1ポートフォリオ（保有銘柄の集合）から、評価額合計・評価損益・2種の平均利回り・
 * スコア平均の5つの集計値を算出する**純粋関数**。DB・HTTP に触らない。
 *
 * 個々の指標のスコア判定（①〜⑩）は対象外。ここでは「既に算出済みの総合点・
 * 配当利回り（bp）」を入力として受け取り、それらを合算するだけ。
 *
 * **`Sen` branded type は使わない。** 既存の集計ドメインサービス
 * （`consecutive-years.ts` の `ConsecutiveYearRow.amountSen`、`dividend-yield.ts` 等）に
 * 倣い、金額系フィールドは素の `number`（コメントで単位「銭」を明記）で持つ。`isSen()` は
 * 「安全整数か」を確かめるガードとしてのみ使う。
 *
 * **`Result<T, E>` でラップしない。** ゼロ除算は例外ではなく `null` で表現する設計
 * （設計書 §3.3・§3.4・§4）であり、`quantity`/`acquisitionPriceSen` の妥当性検証は
 * 「この関数の対象外」（設計書 §4）と明記されているため、`buildScoreCard` と同型の
 * 「例外なし純粋関数、直接値を返す」パターンを採る。新規 `DomainError` kind も追加しない。
 */

import { isSen } from '../shared/sen';

/** 保有銘柄1件（設計書 §2.1） */
export interface Holding {
  /**
   * 株。正の整数が前提だが、0以下の検証は呼び出し側（画面・登録API）の責務
   * （設計書 §4「この関数の対象外」）。ここでは追加のガードを入れない
   */
  readonly quantity: number;
  /**
   * 銭/株（取得単価）。正の整数が前提だが、`quantity` と同様にこの関数の対象外
   * （設計書 §4）
   */
  readonly acquisitionPriceSen: number;
  /** 銭/株（現在株価）。株価が未取得の銘柄は `null` */
  readonly currentPriceSen: number | null;
  /** bp（1bp=0.01%。⑩と同じ表現）。⑩が判定不能な銘柄は `null` */
  readonly dividendYieldBp: number | null;
  /** 点（0〜`maxTotalScore`）。保存済み銘柄の総合点は常に確定値（`null` は無い） */
  readonly totalScore: number;
}

/** ポートフォリオ集計結果（設計書 §2.3） */
export interface PortfolioMetrics {
  /** 評価額合計（銭）。保有0件・価格全欠損なら `0`（`null` にしない） */
  readonly totalValueSen: number;
  /** `totalValueSen`/`unrealizedGainLossSen` の内訳を示す有効件数（§3.1） */
  readonly evaluableValueCount: number;
  /** 評価損益合計（銭）。`evaluableValueCount` と同じ母数。`totalValueSen` と同様 `0` を返しうる */
  readonly unrealizedGainLossSen: number;
  /** 平均利回り（評価額加重、%）。対象銘柄が0件（評価額合計が0）なら `null` */
  readonly weightedYieldPercent: number | null;
  /** 取得単価利回り（%）。対象銘柄が0件（取得原価合計が0）なら `null` */
  readonly costBasisYieldPercent: number | null;
  /**
   * `weightedYieldPercent`/`costBasisYieldPercent` 共通の母数（評価額・利回りとも非nullの
   * 銘柄数）。`evaluableValueCount`（§3.1）とは別の集合。両利回りが `null` でも `null` に
   * せず `0` を返す（対象件数が「0件」という事実として返す。設計書 §3.3 末尾）
   */
  readonly yieldEvaluableHoldingCount: number;
  /** 総合点の単純平均（保有数量で重み付けしない）。保有0件なら `null` */
  readonly scoreAverage: number | null;
}

/**
 * `currentPriceSen` の防御的ガード。
 *
 * DB由来で `null`（株価未取得）を許容する設計だが、非 `null` の不正値（負値・非安全整数）
 * については設計書に記載が無い。「未検証の入力を信用しない」原則
 * （`.claude/rules/backend.md`）を適用し、不正値は `null`（＝該当集計から除外）と
 * 同じ扱いにする。
 *
 * TODO: 設計書 `portfolio-metrics.md` は「非null不正値」ケースを明記していない拡張実装。
 * 推測根拠: タスク指示（非null不正値への防御的ガードを実装する）に基づく。設計書へ
 * 追記するかは別途確認が必要（実装計画 §6-b）。
 */
function normalizeCurrentPriceSen(value: number | null): number | null {
  if (value === null) return null;
  if (!isSen(value) || value < 0) return null;
  return value;
}

/**
 * `dividendYieldBp` の防御的ガード。非安全整数・負値は `null`（＝該当集計から除外）と同じ
 * 扱いにする。配当利回り（bp）は負にはなり得ない値のため、`normalizeCurrentPriceSen` と
 * 同じ形（非安全整数 かつ 負値もガード）に揃える。同じ理由・同じ拡張（TODO 参照）
 */
function normalizeDividendYieldBp(value: number | null): number | null {
  if (value === null) return null;
  if (!Number.isSafeInteger(value) || value < 0) return null;
  return value;
}

/**
 * ポートフォリオ集計。
 *
 * 1回の `for` ループで全出力を積み上げる（`buildScoreCard` と同じ構造。設計書 §5
 * 「100件の保有銘柄でも1回のループで完了する」を満たす）。
 *
 * **`weightedYieldPercent`（§3.3）と `costBasisYieldPercent`（§3.4）は同じ分子
 * `Σ(評価額×bp)` を共有できる**（代数的に等価。以下の式変形を参照）。分母だけが違う
 * （§3.3=対象集合の評価額合計、§3.4=対象集合の取得原価合計）。
 *
 * - §3.3: `weightedYieldPercent = Σ(評価額×bp) / Σ評価額 / 100`
 * - §3.4: `costBasisYieldPercent = (Σ(評価額×bp)/10000) / Σ取得原価 × 100
 *   = Σ(評価額×bp) / Σ取得原価 / 100`
 * - 両者とも最終的に `/100` に帰着する（§3.3 の bp→% 変換、§3.4 の
 *   bp→円(÷10000)→%(×100) の二段変換が相殺される）
 *
 * ただし「分子共有」は実装上の最適化であり、**正しさの担保はテスト**（`weightedYieldPercent`
 * と `costBasisYieldPercent` を、設計書の式をそのまま素朴に計算した期待値と独立に
 * 突き合わせる。T-088 で係数〈÷100 と ÷10000〉の取り違えが指摘された箇所のため）。
 *
 * **オーバーフローについて**: `quantity × currentPriceSen`（評価額）・
 * `quantity × acquisitionPriceSen`（取得原価）の積は理論上 `Number.isSafeInteger` の
 * 範囲を超えうる。実運用値（保有100件上限・現実的な株価と保有株数）では安全域に収まる
 * 想定のため、ここでは追加の上限定数は設けず、テスト側で安全域に収まることを確認する
 * （実装計画 §2.3・§6-c）。
 */
export function calculatePortfolioMetrics(holdings: readonly Holding[]): PortfolioMetrics {
  let totalValueSen = 0;
  let evaluableValueCount = 0;
  let unrealizedGainLossSen = 0;
  let yieldEvaluableHoldingCount = 0;
  // §3.3・§3.4 共通の分子。Σ(評価額×bp)（対象集合のみ）
  let yieldNumerator = 0;
  // §3.3 の分母。Σ評価額（対象集合のみ）
  let weightedDenominator = 0;
  // §3.4 の分母。Σ取得原価（対象集合と同じ銘柄のみ）
  let costBasisDenominator = 0;
  let scoreSum = 0;

  for (const holding of holdings) {
    // 取得原価は必須入力（quantity・acquisitionPriceSen）なので常に算出可能（§3.2）
    const costSen = holding.quantity * holding.acquisitionPriceSen;

    const currentPriceSen = normalizeCurrentPriceSen(holding.currentPriceSen);
    const valueSen = currentPriceSen === null ? null : holding.quantity * currentPriceSen;

    if (valueSen !== null) {
      // 価格未取得（または不正値）の銘柄は合計から除外する。0円として合算しない（§3.1）
      totalValueSen += valueSen;
      evaluableValueCount += 1;
      unrealizedGainLossSen += valueSen - costSen;
    }

    const dividendYieldBp = normalizeDividendYieldBp(holding.dividendYieldBp);

    if (valueSen !== null && dividendYieldBp !== null) {
      // 評価額・利回りの両方が非nullの銘柄だけを対象にする（§3.3・§3.4 共通の対象集合）。
      // 無配（dividendYieldBp === 0）はここに含まれる＝0として計算に含める（除外しない）
      yieldEvaluableHoldingCount += 1;
      yieldNumerator += valueSen * dividendYieldBp;
      weightedDenominator += valueSen;
      costBasisDenominator += costSen;
    }

    // totalScore は常に確定値（§2.1）。null除外は不要
    scoreSum += holding.totalScore;
  }

  // 分母0（対象銘柄が1件も無い）は null。0% にしない（「利回り0%」と「計算不能」は別物）
  const weightedYieldPercent =
    weightedDenominator === 0 ? null : yieldNumerator / weightedDenominator / 100;
  const costBasisYieldPercent =
    costBasisDenominator === 0 ? null : yieldNumerator / costBasisDenominator / 100;
  // 保有数量で重み付けしない単純平均。保有0件のときだけ null（0点にしない）
  const scoreAverage = holdings.length === 0 ? null : scoreSum / holdings.length;

  return {
    totalValueSen,
    evaluableValueCount,
    unrealizedGainLossSen,
    weightedYieldPercent,
    costBasisYieldPercent,
    yieldEvaluableHoldingCount,
    scoreAverage,
  };
}

/** 保有銘柄1件ぶんの評価額・評価損益・配当利回り（%）。設計書に無い拡張（下記TODO参照） */
export interface HoldingValuation {
  /** 銭。`currentPriceSen` が算出不能（null・不正値）なら `null` */
  readonly valueSen: number | null;
  /** 銭。`valueSen` が `null` なら `null` */
  readonly unrealizedGainLossSen: number | null;
  /** %。`dividendYieldBp` が算出不能（null・不正値）なら `null` */
  readonly dividendYieldPercent: number | null;
}

/**
 * 保有銘柄1件の評価額・評価損益・配当利回り（%）を算出する。
 *
 * TODO(be-developer, 2026-08-23): 推測実装。`docs/02_design/logic/portfolio-metrics.md` は
 * ポートフォリオ「集計」の5値（§2.3）しか定義しておらず、`portfolio-api.md` のレスポンス例
 * （`GET /api/portfolios/:id` の `holdings[]`）にある保有銘柄1行ぶんの `valueSen`/
 * `unrealizedGainLossSen`/`dividendYieldPercent` の算出式を明記した文書が無い。
 * 推測根拠: `calculatePortfolioMetrics` の §3.1（評価額=quantity×currentPriceSen）・
 * §3.2（評価損益=評価額−取得原価）・§3.3（bp→%は÷100）の式を、集計せず1件だけに適用した
 * ものと解釈した。`normalizeCurrentPriceSen`/`normalizeDividendYieldBp`（同一ファイル内。
 * 非safe-integer・負値は `null` と同じ扱い）も集計と同じガードを再利用する。
 * `portfolio-metrics.md` への正式な追記が必要（実装計画 §6-a・Manager承認済み。完了報告で明示）。
 */
export function describeHoldingValuation(holding: Holding): HoldingValuation {
  const costSen = holding.quantity * holding.acquisitionPriceSen;

  const currentPriceSen = normalizeCurrentPriceSen(holding.currentPriceSen);
  const valueSen = currentPriceSen === null ? null : holding.quantity * currentPriceSen;
  const unrealizedGainLossSen = valueSen === null ? null : valueSen - costSen;

  const dividendYieldBp = normalizeDividendYieldBp(holding.dividendYieldBp);
  const dividendYieldPercent = dividendYieldBp === null ? null : dividendYieldBp / 100;

  return { valueSen, unrealizedGainLossSen, dividendYieldPercent };
}
