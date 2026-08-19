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
 */
export async function getCompanyScoring(
  repository: CompanyRepository,
  code: string,
  useActualForScoring = false,
): Promise<CompanyScoring | null> {
  const company = await repository.findByCode(code);
  if (company === null) return null;
  return scoreCompany(company, useActualForScoring);
}

export async function deleteCompany(repository: CompanyRepository, code: string): Promise<void> {
  await repository.deleteByCode(code);
}
