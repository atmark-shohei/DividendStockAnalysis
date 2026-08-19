/**
 * `GET /api/companies?q=&sort=&page=&perPage=` のクエリ検証。
 *
 * `useActualForScoringQuery`（`company-input.ts`）や `fiscalYearEndMonthQuery`
 * （`market-data-import.ts`）は**不正なら400**にするが、こちらは違う。
 * `docs/02_design/api/company-api.md` §GET /api/companies が「未知の値・範囲外は
 * 既定値へ倒す（400にしない）」と明記している（検索は誤入力頻度が高いフィールドのため）。
 * `.catch()` を使うため `parse()` は例外を投げない。
 */

import { z } from 'zod';

import {
  COMPANY_SORT_KEYS,
  DEFAULT_COMPANY_LIST_PAGE,
  DEFAULT_COMPANY_LIST_PER_PAGE,
  DEFAULT_COMPANY_SORT,
  MAX_COMPANY_LIST_PER_PAGE,
  MIN_COMPANY_LIST_PER_PAGE,
} from '../../domain/company/company-list-query';

/**
 * `q`/`sort`/`page`/`perPage` の検証。**呼び出し側は `parse()` を使う**
 * （`.catch()` があるため常に成功する。`safeParse` にする必要は無い）。
 *
 * `q` は未指定なら `undefined` → `''`（絞り込まない）へ変換し、前後の空白を取り除く。
 */
export const companyListQuery = z.object({
  q: z
    .string()
    .optional()
    .transform((value) => value?.trim() ?? ''),
  sort: z.enum(COMPANY_SORT_KEYS).catch(DEFAULT_COMPANY_SORT),
  page: z.coerce.number().int().min(1).catch(DEFAULT_COMPANY_LIST_PAGE),
  perPage: z.coerce
    .number()
    .int()
    .min(MIN_COMPANY_LIST_PER_PAGE)
    .max(MAX_COMPANY_LIST_PER_PAGE)
    .catch(DEFAULT_COMPANY_LIST_PER_PAGE),
});
