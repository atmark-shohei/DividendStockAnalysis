/**
 * ユースケース: 保存済みの会社を読む。
 *
 * 一覧は**専用の read model**（`CompanySummary`）を使う。1000社規模で
 * 明細まで取ると画面が開かない（`.claude/CLAUDE.md`）。
 */

import { type CompanyListQuery } from '../domain/company/company-list-query';
import {
  type CompanyListResult,
  type CompanyRepository,
} from '../domain/company/company-repository';
import { type DividendHistoryYear, dividendHistoryByYear } from '../domain/company/dividend-record';
import { type PortfolioRepository } from '../domain/portfolio/portfolio-repository';
import {
  type ConsecutiveYearRow,
  describeConsecutiveYearRows,
} from '../domain/scoring/consecutive-years';
import { type UserIndicatorSettingsRepository } from '../domain/scoring/user-indicator-settings-repository';
import { type Result, err, ok } from '../domain/shared/result';
import { resolveScoringBands } from './resolve-scoring-bands';
import { type CompanyScoring, scoreCompany } from './score-company';

/**
 * 一覧。保存済みの総合点をそのまま返す（再計算しない）。
 *
 * `query` は handler 側で既に既定値へ丸め込み済み（不正値・未知値は既に既定値化されている）。
 * ドメイン計算は無いのでそのまま repository へ委譲する（薄い委譲。`getCompanyScoring` と異なり
 * ここではデフォルト値を持たせない。既定値は handler 側の zod スキーマ1箇所に集約する）。
 */
export async function listCompanies(
  repository: CompanyRepository,
  query: CompanyListQuery,
): Promise<CompanyListResult> {
  return repository.listSummaries(query);
}

/**
 * 1社の詳細。**保存済みの生データから採点し直して返す。**
 *
 * 整形データも保存してあるが、詳細表示では再計算する。ロジックを直したあとに
 * 古い整形データを表示すると、画面と現在の実装が食い違う。保存済みの整形データは
 * 再監査（いつどのバージョンでいくつだったか）のために残してある。
 *
 * @param userIndicatorSettingsRepository 指標カスタマイズ（T-101）の設定を読む窓口。
 *   `userId` の解決に必要な区分表を `resolveScoringBands` 経由で組み立てる
 * @param userId ログイン中ユーザーのID。**未ログイン（guest）は `null`**。
 *   `null` は「全10指標選択・`bands.ts` のデフォルト区分表」という既定応答になる
 *   （BE計画 §5。`GET /api/companies/:code` は無認証でも閲覧できる既存仕様を変えない）
 */
export async function getCompanyScoring(
  repository: CompanyRepository,
  userIndicatorSettingsRepository: UserIndicatorSettingsRepository,
  code: string,
  userId: number | null,
  useActualForScoring = false,
): Promise<CompanyScoring | null> {
  const company = await repository.findByCode(code);
  if (company === null) return null;
  const resolvedBands = await resolveScoringBands(
    { userIndicatorSettingsRepository },
    userId,
  );
  return scoreCompany(company, useActualForScoring, resolvedBands);
}

/**
 * `getCompanyDividendHistory()` の戻り値。①配当推移の折れ線グラフ用データと、
 * ②連続非減配年数の年次リストを両方持つ（`GET /api/companies/:code/dividends`）。
 *
 * ②は①とデータソースが異なる（`describeConsecutiveYearRows` の docコメント参照）。
 * 呼び出し元が誤って①のデータを②の判定に流用しないよう、型で分けて持たせる。
 */
export interface CompanyDividendHistoryResult {
  readonly dividends: readonly DividendHistoryYear[];
  readonly consecutiveYearRows: readonly ConsecutiveYearRow[];
}

/**
 * 1社の配当履歴（年度ごとに1件へ集約済み）と、②連続非減配年数の年次リスト。
 * ①配当推移の折れ線グラフ・②連続非減配年数のリストが使う
 * （`GET /api/companies/:code/dividends`）。
 *
 * 集約・判定ロジックは domain（`dividendHistoryByYear` / `describeConsecutiveYearRows`）に
 * 置き、ここでは `company.dividends`（1回のリポジトリ呼び出し）から両方を呼ぶ
 * 薄い委譲に留める（`getCompanyScoring` と同型）。
 */
export async function getCompanyDividendHistory(
  repository: CompanyRepository,
  code: string,
): Promise<CompanyDividendHistoryResult | null> {
  const company = await repository.findByCode(code);
  if (company === null) return null;
  return {
    dividends: dividendHistoryByYear(company.dividends),
    consecutiveYearRows: describeConsecutiveYearRows(company.dividends),
  };
}

export type DeleteCompanyError = { readonly kind: 'held-in-portfolio' };

/**
 * 銘柄を削除する。**D1 の `ON DELETE RESTRICT`（`portfolio_holdings.company_code`）を
 * 信頼しない。** D1 は既定で外部キー制約が有効とは限らないため（`company-repository.ts:405-406`
 * の既存注記）、削除前にアプリ層で明示的に保有件数を確認し、1件でもあれば409相当のドメイン
 * エラーを返す（`schema.md` §portfolio_holdings の注記、`portfolio-api.md` の409）。
 */
export async function deleteCompany(
  repository: CompanyRepository,
  portfolioRepository: PortfolioRepository,
  code: string,
): Promise<Result<void, DeleteCompanyError>> {
  const heldCount = await portfolioRepository.countHoldingsByCompanyCode(code);
  if (heldCount > 0) return err({ kind: 'held-in-portfolio' });

  await repository.deleteByCode(code);
  return ok(undefined);
}
