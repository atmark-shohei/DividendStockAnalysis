/**
 * `DELETE /api/companies/:code` のドメインエラーを HTTP 応答へ変換する（T-103）。
 * 文言は `docs/02_design/database/schema.md` §portfolio_holdings の注記と一致させる。
 */

import { type DeleteCompanyError } from '../../usecase/read-companies';

export function toDeleteCompanyErrorResponse(error: DeleteCompanyError): {
  readonly body: { readonly error: string };
  readonly status: 409;
} {
  switch (error.kind) {
    case 'held-in-portfolio':
      return {
        body: { error: 'この銘柄は誰かのポートフォリオに保有されているため削除できません' },
        status: 409,
      };
  }
}
