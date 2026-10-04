/**
 * `GET /api/companies` の検索・ソート・サーバサイドページングのクエリ（read model の入力）。
 *
 * `docs/02_design/api/company-api.md` §GET /api/companies が「未知の値・範囲外は
 * 既定値へ丸める（400にしない）」と定めているため、ここにドメインエラーは作らない。
 * 丸め込みは handler 側の zod（`handler/dto/company-list-query.ts`）が担う
 * （`src/domain/shared/metric-key.ts` の `as const` 配列 + 派生型パターンを踏襲）。
 */

export const COMPANY_SORT_KEYS = ['created_desc', 'score_desc', 'score_asc', 'code_asc'] as const;
export type CompanySortKey = (typeof COMPANY_SORT_KEYS)[number];

export const DEFAULT_COMPANY_SORT: CompanySortKey = 'created_desc';
export const DEFAULT_COMPANY_LIST_PAGE = 1;
export const DEFAULT_COMPANY_LIST_PER_PAGE = 15;
export const MIN_COMPANY_LIST_PER_PAGE = 1;
export const MAX_COMPANY_LIST_PER_PAGE = 100;

/**
 * 一覧検索クエリ。**この時点で既に既定値へ丸め込み済み**（handler が保証する）。
 * usecase / infra はこれ以上の検証をしない。
 *
 * **この型自身は不変条件を強制しない**（`page >= 1`・`MIN〜MAX_COMPANY_LIST_PER_PAGE` の
 * 範囲チェックは型では表現していない。DDD実装規約の「値オブジェクトはファクトリで守る」ではなく
 * DTO として扱う。CR-4）。安全性は `handler/dto/company-list-query.ts` の zod スキーマが
 * 唯一の生成経路であることに依存する契約であり、handler を経由しない呼び出し（内部バッチ処理等）を
 * 追加する場合は、呼び出し元が同等の検証を行うこと。
 */
export interface CompanyListQuery {
  /** 空文字なら絞り込まない。銘柄コード・銘柄名の部分一致（大文字小文字を区別しない） */
  readonly q: string;
  readonly sort: CompanySortKey;
  /** 1以上の整数 */
  readonly page: number;
  /** `MIN_COMPANY_LIST_PER_PAGE`〜`MAX_COMPANY_LIST_PER_PAGE` の整数 */
  readonly perPage: number;
}
