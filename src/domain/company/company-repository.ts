/**
 * 会社の永続化インターフェース。**定義はドメイン側に置く**（`.claude/CLAUDE.md`）。
 *
 * 実装は `src/infra/d1/`。依存の向きは `infra -> domain` であり、
 * ドメインは D1 も Drizzle も知らない。ここに `D1Database` が現れたら設計を間違えている。
 */

import { type Company } from './company';

/** 一覧表示用の要約。1000社規模を想定し、明細は含めない（read model） */
export interface CompanySummary {
  readonly code: string;
  readonly name: string;
  readonly totalScore: number;
  readonly maxTotalScore: number;
  readonly effectiveMetricCount: number;
  readonly totalMetricCount: number;
  /** 入力（解析）した日時。UTC の ISO 8601 文字列 */
  readonly fetchedAt: string;
}

/** 保存する整形指標。再監査のため計算時点の値と計算バージョンを持つ */
export interface StoredMetric {
  readonly metricKey: string;
  readonly score: number | null;
  readonly value: number | null;
  readonly unavailableReason: string | null;
}

export interface StoredScoring {
  readonly totalScore: number;
  readonly effectiveMetricCount: number;
  readonly metrics: readonly StoredMetric[];
  /** 計算ロジックのバージョン。閾値や計算式を変えたら上げる */
  readonly calcVersion: string;
  /** 計算した日時。UTC の ISO 8601 文字列 */
  readonly calculatedAt: string;
}

export interface CompanyRepository {
  /**
   * 会社と、その時点の整形指標を保存する。
   *
   * **生データ（`Company`）と整形データ（`StoredScoring`）を両方保存する**
   * （`.claude/CLAUDE.md`）。整形データは再計算可能だが、再監査のために
   * 計算時点の値と計算バージョンを残す。
   */
  save(company: Company, scoring: StoredScoring): Promise<void>;
  findByCode(code: string): Promise<Company | null>;
  /** 一覧。N+1 を作らないため要約だけを1クエリで取る */
  listSummaries(): Promise<readonly CompanySummary[]>;
  deleteByCode(code: string): Promise<void>;
}
