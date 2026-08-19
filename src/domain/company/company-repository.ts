/**
 * 会社の永続化インターフェース。**定義はドメイン側に置く**（`.claude/CLAUDE.md`）。
 *
 * 実装は `src/infra/d1/`。依存の向きは `infra -> domain` であり、
 * ドメインは D1 も Drizzle も知らない。ここに `D1Database` が現れたら設計を間違えている。
 */

import { type Company } from './company';
import { type CompanyListQuery } from './company-list-query';

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
  /** 銭。株価が未入力なら `null` */
  readonly priceSen: number | null;
  /** 1/100%（500 = 5.00%）。⑩ 配当利回りが判定不能なら `null` */
  readonly dividendYieldValue: number | null;
  /** %（そのまま%として読む）。③ 予想配当性向が判定不能なら `null` */
  readonly payoutRatioValue: number | null;
}

/** `CompanyRepository.listSummaries()` の戻り値。`total` はフィルタ（`q`）適用後の総件数 */
export interface CompanyListResult {
  readonly items: readonly CompanySummary[];
  readonly total: number;
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
  /**
   * 一覧。N+1 を作らないため要約だけを1クエリ（JOIN）で取る。
   *
   * `query` は既に既定値へ丸め込み済みの完全な `CompanyListQuery`（handler が保証する契約。
   * `CompanyListQuery` 自体は型で不変条件を強制しないため、handler 以外から呼ぶ場合は
   * 呼び出し元で `page >= 1`・`perPage` の範囲を検証すること。CR-4）。
   */
  listSummaries(query: CompanyListQuery): Promise<CompanyListResult>;
  deleteByCode(code: string): Promise<void>;
  /**
   * 登録済み企業の決算月一覧（重複無し）。EDINET docIDインデックスの日次バッチ
   * （`refresh-edinet-document-index`）が走査対象期間を絞り込むために使う
   * （`docs/02_design/logic/edinet-history-import.md` §4.4）。
   *
   * TODO(be-developer, 2026-08-08): **推測実装。** `companies` テーブルに決算月を
   * 保存する列が現状無い（IRバンク取り込みが返す `fiscalYearEndMonth` は画面へ返すだけで
   * 永続化していない）。決算月を保存する経路（`AnalyzeCompanyRequest` への追加等）は
   * 本タスクの指示範囲外（Manager指示は `epsHistoryRestated`/`revenueHistoryRestated` の
   * 追加のみ）のため、この実装は**安全側に倒し、常に1〜12月すべてを返す**
   * （`D1CompanyRepository` 参照）。「登録済み企業の決算月に絞り込んで走査を減らす」効果は
   * 出ないが、**どの決算月の企業も取りこぼさない**という正しさは保つ。
   * 決算月を永続化する設計が決まり次第、実際の一覧を返す実装に差し替えること。
   */
  listFiscalYearEndMonths(): Promise<readonly number[]>;
}
