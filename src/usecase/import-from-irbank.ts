/**
 * ユースケース: IRバンクから財務データを取り込む。
 *
 * 1ユースケース = 1関数（`.claude/CLAUDE.md`）。**保存はしない。** 取り込んだ
 * 結果は入力フォームの初期値として返すだけで、確定は従来どおりユーザーが行う
 * （`docs/02_design/logic/irbank-json-import.md` §1）。
 */

import {
  type FinancialSource,
  type FinancialSourceError,
  type ImportedFinancials,
} from '../domain/company/financial-source';
import { type Result } from '../domain/shared/result';

export async function importFromIrBank(
  source: FinancialSource,
  code: string,
): Promise<Result<ImportedFinancials, FinancialSourceError>> {
  return source.fetchByCode(code);
}
