/**
 * ユースケース: 会社データを採点して保存する。
 *
 * 1ユースケース = 1関数（`.claude/CLAUDE.md`）。リポジトリは**インターフェース越し**に
 * 受け取り、D1 も Hono も知らない。
 */

import { type Company } from '../domain/company/company';
import {
  type CompanyRepository,
  type StoredMetric,
  type StoredScoring,
} from '../domain/company/company-repository';
import { METRIC_KEYS } from '../domain/shared/metric-key';
import { type CompanyScoring, scoreCompany } from './score-company';

/**
 * 計算ロジックのバージョン。**閾値・計算式を変えたら必ず上げる。**
 *
 * 保存済みの整形指標がどのロジックで計算されたかを後から追えるようにするため
 * （`.claude/CLAUDE.md`「再監査目的で計算時点の値と計算バージョンを保存する」）。
 * これを上げ忘れると、古い値と新しい値が同じバージョンで混在して監査できなくなる。
 */
export const SCORING_CALC_VERSION = '2026-08-06.1';

/** スコアカードを保存形式へ落とす。`null` を 0 に丸めない（§0.5） */
function toStoredScoring(scoring: CompanyScoring, calculatedAt: string): StoredScoring {
  const metrics: StoredMetric[] = METRIC_KEYS.map((key) => {
    const metric = scoring.card.metrics[key];
    return {
      metricKey: key,
      score: metric.score,
      value: metric.value,
      unavailableReason: metric.unavailableReason,
    };
  });

  return {
    totalScore: scoring.card.totalScore,
    effectiveMetricCount: scoring.card.effectiveMetricCount,
    metrics,
    calcVersion: SCORING_CALC_VERSION,
    calculatedAt,
  };
}

/**
 * 採点して保存し、結果を返す。
 *
 * 保存に失敗したら**採点結果も返さない**。画面に出た値が保存されていない状態を作ると、
 * 次に開いたときに違う値が出て原因が追えなくなる。
 */
export async function analyzeCompany(
  repository: CompanyRepository,
  company: Company,
  now: () => Date = () => new Date(),
  useActualForScoring = false,
): Promise<CompanyScoring> {
  const scoring = scoreCompany(company, useActualForScoring);
  await repository.save(company, toStoredScoring(scoring, now().toISOString()));
  return scoring;
}
