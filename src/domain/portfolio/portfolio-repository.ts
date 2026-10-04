/**
 * ポートフォリオの永続化インターフェース。**定義はドメイン側に置く**（`.claude/CLAUDE.md`）。
 *
 * 実装は `src/infra/d1/portfolio-repository.ts`。依存の向きは `infra -> domain` であり、
 * ドメインは D1 も Drizzle も知らない。
 */

import { type Portfolio, type PortfolioSummary } from './portfolio';
import { type PortfolioHoldingRecord } from './portfolio-holding';
import { type Result } from '../shared/result';

/**
 * 保有銘柄1行ぶんの JOIN 結果（`companies`/`score_cards`/`transformed_metrics(dividendYield)`
 * を結合したもの）。`GET /api/portfolios/:id` の応答組み立て・`calculatePortfolioMetrics` の
 * 入力（`Holding`）の両方の元になる。
 *
 * `totalScore`/`effectiveMetricCount` は `score_cards` に対応行が無い（LEFT JOIN が null）場合、
 * `company-repository.ts` の `listSummaries()` と同じ防御（`?? 0`）をインフラ実装側で適用する
 * （通常運用では到達しない分岐。CR-7と同型）。
 */
export interface PortfolioHoldingJoinRow {
  readonly companyCode: string;
  readonly companyName: string;
  /** 株。必須入力なので常に非null */
  readonly quantity: number;
  /** 銭/株（取得単価）。必須入力なので常に非null */
  readonly acquisitionPriceSen: number;
  /** 銭/株（現在株価）。`companies.price_sen` 未入力なら `null` */
  readonly currentPriceSen: number | null;
  /** bp（1bp=0.01%）。⑩ 配当利回りが判定不能なら `null` */
  readonly dividendYieldBp: number | null;
  /** 0〜100。`score_cards` 未生成（防御的分岐）なら `0` */
  readonly totalScore: number;
  /** 判定できた指標の数。`score_cards` 未生成（防御的分岐）なら `0` */
  readonly effectiveMetricCount: number;
}

/** `GET /api/portfolios/:id` の元データ。portfolio 本体1件＋保有銘柄のJOIN結果 */
export interface PortfolioDetail {
  readonly portfolio: Portfolio;
  readonly holdings: readonly PortfolioHoldingJoinRow[];
}

/** `updateHolding` の部分更新入力。`quantity`/`acquisitionPriceSen` のどちらか片方でもよい */
export interface HoldingPatch {
  readonly quantity?: number;
  readonly acquisitionPriceSen?: number;
  /** UTC ISO 8601。usecase 側で注入した現在時刻をそのまま渡す */
  readonly updatedAt: string;
}

export interface PortfolioRepository {
  /** ポートフォリオ作成前の上限チェック（`isPortfolioLimitReached`）に使う */
  countByUserId(userId: number): Promise<number>;
  /**
   * `GET /api/portfolios` 用の要約一覧。1クエリ（`LEFT JOIN portfolio_holdings` +
   * `GROUP BY` + `COUNT`）で取る。N+1 を作らない（`.claude/rules/backend.md`）。
   */
  listSummariesByUserId(userId: number): Promise<readonly PortfolioSummary[]>;
  /**
   * `portfolios.id` の一意制約違反時は `id-conflict` を返す（例外を投げない）。
   * 呼び出し側（`createPortfolio` usecase）がIDを生成し直してリトライする（BEレビュー CR-2）。
   */
  insert(portfolio: Portfolio): Promise<Result<void, { readonly kind: 'id-conflict' }>>;
  findById(id: string): Promise<Portfolio | null>;
  /**
   * ポートフォリオ本体と保有銘柄を連鎖削除する。`portfolio_holdings.portfolio_id` は
   * `ON DELETE CASCADE` だが、D1 は既定で外部キー制約が有効とは限らないため
   * （`company-repository.ts` の `deleteByCode` と同じ理由）、明示的に holdings→portfolios
   * の順で削除する実装にすること。
   */
  deleteById(id: string): Promise<void>;
  /**
   * `GET /api/portfolios/:id` 用。portfolio行1件＋保有銘柄のJOIN行をまとめて返す
   * （計2クエリ。保有銘柄ごとの個別クエリは発行しない）。存在しなければ `null`
   */
  getDetail(id: string): Promise<PortfolioDetail | null>;
  /** 保有銘柄数の上限チェック（`isHoldingLimitReached`）に使う */
  countHoldings(portfolioId: string): Promise<number>;
  /** 重複追加チェック（409）用の軽量存在確認 */
  findHolding(portfolioId: string, companyCode: string): Promise<boolean>;
  /** 追加・更新後の応答組み立て用。対象1行だけのJOIN（N+1には該当しない） */
  findHoldingRow(portfolioId: string, companyCode: string): Promise<PortfolioHoldingJoinRow | null>;
  insertHolding(holding: PortfolioHoldingRecord): Promise<void>;
  updateHolding(portfolioId: string, companyCode: string, patch: HoldingPatch): Promise<void>;
  /** 冪等。対象が無くても成功する（`portfolio-api.md` の `DELETE .../holdings/:code`） */
  deleteHolding(portfolioId: string, companyCode: string): Promise<void>;
  /**
   * `DELETE /api/companies/:code` の409判定用。**D1のFK制約（`ON DELETE RESTRICT`）を
   * 信頼しない。** アプリ層でこの件数を明示的に確認してから削除を許可・拒否する
   * （`company-repository.ts:405-406` の既存注記どおり、D1は既定でFK制約が有効とは限らない）。
   */
  countHoldingsByCompanyCode(companyCode: string): Promise<number>;
}
