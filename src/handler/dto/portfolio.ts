/**
 * ポートフォリオ API の入出力 DTO と zod スキーマ（T-103）。
 * 仕様: `docs/02_design/api/portfolio-api.md`。**zod は handler の境界でだけ使う。**
 */

import { z } from 'zod';

import { MAX_PRICE_SEN } from '../../domain/company/dividend-record';
import { type Portfolio, type PortfolioSummary } from '../../domain/portfolio/portfolio';
import { MAX_HOLDING_QUANTITY } from '../../domain/portfolio/portfolio-holding';
import { type AddHoldingError } from '../../usecase/add-holding';
import { type CreatePortfolioError } from '../../usecase/create-portfolio';
import { type ListPortfoliosResult } from '../../usecase/list-portfolios';
import { type PortfolioDetailResult, type PortfolioHoldingDetail } from '../../usecase/get-portfolio-detail';
import { type UpdateHoldingError } from '../../usecase/update-holding';
import { COMPANY_CODE_PATTERN } from './company-code';

export const createPortfolioRequest = z.object({
  name: z.string().min(1, 'ポートフォリオ名を入力してください').max(50, 'ポートフォリオ名は50文字以内で入力してください'),
});
export type CreatePortfolioRequest = z.infer<typeof createPortfolioRequest>;

export const addHoldingRequest = z.object({
  code: z.string().regex(COMPANY_CODE_PATTERN, '銘柄コードの形式が不正です'),
  quantity: z.number().int().positive().max(MAX_HOLDING_QUANTITY, `保有株数は${MAX_HOLDING_QUANTITY}株以下で入力してください`),
  acquisitionPriceSen: z
    .number()
    .int()
    .positive()
    .max(MAX_PRICE_SEN, '取得単価が上限を超えています'),
});
export type AddHoldingRequest = z.infer<typeof addHoldingRequest>;

/**
 * 両方省略（`{}`）は許さない。**最低1フィールド必須**（実装計画 §6-e・Manager承認済み）。
 * `portfolio-api.md` は「両方または片方だけの更新を許す」としか書いておらず、
 * 両方省略時の挙動は明記していない。空更新（何も変えない）を許すのは
 * 不自然なリクエストのため、handler 境界で弾く。
 */
export const updateHoldingRequest = z
  .object({
    quantity: z
      .number()
      .int()
      .positive()
      .max(MAX_HOLDING_QUANTITY, `保有株数は${MAX_HOLDING_QUANTITY}株以下で入力してください`)
      .optional(),
    acquisitionPriceSen: z
      .number()
      .int()
      .positive()
      .max(MAX_PRICE_SEN, '取得単価が上限を超えています')
      .optional(),
  })
  .refine((value) => value.quantity !== undefined || value.acquisitionPriceSen !== undefined, {
    message: 'quantity または acquisitionPriceSen のいずれかを指定してください',
  });
export type UpdateHoldingRequest = z.infer<typeof updateHoldingRequest>;

export interface PortfolioListResponse {
  readonly portfolios: readonly PortfolioSummary[];
  readonly maxPortfolios: number;
}

export function toPortfolioListResponse(result: ListPortfoliosResult): PortfolioListResponse {
  return { portfolios: result.portfolios, maxPortfolios: result.maxPortfolios };
}

export interface PortfolioResponse {
  readonly id: string;
  readonly name: string;
}

export function toPortfolioResponse(portfolio: Portfolio): PortfolioResponse {
  return { id: portfolio.id, name: portfolio.name };
}

export function toPortfolioDetailResponse(result: PortfolioDetailResult): PortfolioDetailResult {
  return result;
}

export function toHoldingResponse(detail: PortfolioHoldingDetail): PortfolioHoldingDetail {
  return detail;
}

/** `not-found` 系の共通404文言。`portfolio-api.md` §共通仕様「他人のリソースへは404」 */
export function toPortfolioNotFoundResponse(): {
  readonly body: { readonly error: string };
  readonly status: 404;
} {
  return { body: { error: '指定されたポートフォリオは見つかりません' }, status: 404 };
}

export function toCreatePortfolioErrorResponse(error: CreatePortfolioError): {
  readonly body: { readonly error: string };
  readonly status: 403 | 500;
} {
  switch (error.kind) {
    case 'portfolio-limit-reached':
      return { body: { error: 'ポートフォリオは最大10個までです' }, status: 403 };
    case 'id-generation-failed':
      // 理論上到達しない防御的分岐（`create-portfolio.ts` 参照）。内部情報は出さない
      return { body: { error: 'ポートフォリオを作成できませんでした' }, status: 500 };
  }
}

export function toAddHoldingErrorResponse(error: AddHoldingError): {
  readonly body: { readonly error: string };
  readonly status: 404 | 409 | 403 | 500;
} {
  switch (error.kind) {
    case 'portfolio-not-found':
      return toPortfolioNotFoundResponse();
    case 'company-not-found':
      return { body: { error: '指定された銘柄は登録されていません' }, status: 404 };
    case 'duplicate-holding':
      return {
        body: {
          error:
            'この銘柄は既にこのポートフォリオに保有登録されています。数量・単価の変更は更新（PATCH）を使用してください',
        },
        status: 409,
      };
    case 'holding-limit-reached':
      return { body: { error: '保有銘柄は最大100件までです' }, status: 403 };
    case 'insert-verification-failed':
      // 理論上到達しない防御的分岐（`add-holding.ts` 参照）。内部情報は出さない
      return { body: { error: '保有銘柄を追加できませんでした' }, status: 500 };
  }
}

export function toUpdateHoldingErrorResponse(error: UpdateHoldingError): {
  readonly body: { readonly error: string };
  readonly status: 404;
} {
  switch (error.kind) {
    case 'portfolio-not-found':
      return toPortfolioNotFoundResponse();
    case 'holding-not-found':
      return { body: { error: '指定された保有銘柄は見つかりません' }, status: 404 };
  }
}
