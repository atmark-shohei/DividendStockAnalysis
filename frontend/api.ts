/**
 * API クライアント。**データ取得はここと画面（App）だけ。**
 * 表示コンポーネントは props で受け取る（`.claude/rules/frontend.md`）。
 *
 * 型は handler の DTO から type-only で読む。二重定義しない（`.claude/CLAUDE.md`）。
 */

import type { AnalyzeCompanyRequest, ScoringResponse } from '@/handler/dto/company-input';
import type { EdinetImportResponse } from '@/handler/dto/edinet-import';
import type { IrBankImportResponse } from '@/handler/dto/irbank-import';
import type { MarketDataImportResponse } from '@/handler/dto/market-data-import';
import type { CompanySummary } from '@/domain/company/company-repository';

export type {
  AnalyzeCompanyRequest,
  ScoringResponse,
  IrBankImportResponse,
  MarketDataImportResponse,
  EdinetImportResponse,
};

/** 失敗しうる外部呼び出しは必ず結果を検査する（`.claude/rules/coding-style.md`） */
async function request<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });

  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const message =
      typeof body === 'object' && body !== null && 'error' in body && typeof body.error === 'string'
        ? body.error
        : `通信に失敗しました（${String(response.status)}）。時間をおいて再試行してください`;
    throw new Error(message);
  }

  return (await response.json()) as T;
}

export function analyzeCompany(payload: AnalyzeCompanyRequest): Promise<ScoringResponse> {
  return request<ScoringResponse>('/api/companies', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function listCompanies(): Promise<readonly CompanySummary[]> {
  const body = await request<{ companies: readonly CompanySummary[] }>('/api/companies');
  return body.companies;
}

/**
 * @param useActualForScoring ③ 予想配当性向の採点に実績を強制採用するか。
 *   `true` のときだけクエリを付ける（既定 `false` は省略。`importMarketData` の
 *   `fiscalYearEndMonth` と同じ「必要な時だけ ? を付ける」形。
 *   `docs/02_design/logic/payout-ratio-scoring.md` §7）
 */
export function getCompany(code: string, useActualForScoring?: boolean): Promise<ScoringResponse> {
  const query = useActualForScoring === true ? '?useActualForScoring=true' : '';
  return request<ScoringResponse>(`/api/companies/${encodeURIComponent(code)}${query}`);
}

/** IRバンクから財務データを取り込む。**保存はしない**（結果はフォームの初期値にするだけ） */
export function importFromIrBank(code: string): Promise<IrBankImportResponse> {
  return request<IrBankImportResponse>(`/api/irbank/${encodeURIComponent(code)}`);
}

/**
 * Yahoo Finance から株価・配当履歴・株式分割イベントを取り込む。**保存はしない**
 * （`docs/02_design/ui/pages/market-data-import.md`）。
 *
 * @param fiscalYearEndMonth IRバンク取り込みが返した決算月
 *   （`IrBankImportResponse.fiscalYearEndMonth`）。`null`／未指定なら配当の年度集計を
 *   行わず、株価・分割イベントだけが返る（`dividendAggregated: false`）
 */
export function importMarketData(
  code: string,
  fiscalYearEndMonth?: number | null,
): Promise<MarketDataImportResponse> {
  const query =
    fiscalYearEndMonth === null || fiscalYearEndMonth === undefined
      ? ''
      : `?fiscalYearEndMonth=${String(fiscalYearEndMonth)}`;
  return request<MarketDataImportResponse>(
    `/api/market-data/${encodeURIComponent(code)}${query}`,
  );
}

/**
 * EDINET（金融庁の有価証券報告書）から④EPS CAGR・⑦売上高CAGR・⑤ROE・⑧営業利益率の
 * 古い年度の値、⑥配当維持可能年数が要求する流動資産・投資有価証券を取り込む。
 * **保存はしない**（`docs/02_design/logic/edinet-history-import.md`。
 * `importFromIrBank` と同じ方針）。
 */
export function importFromEdinet(code: string): Promise<EdinetImportResponse> {
  return request<EdinetImportResponse>(`/api/edinet/${encodeURIComponent(code)}`);
}

export async function deleteCompany(code: string): Promise<void> {
  const response = await fetch(`/api/companies/${encodeURIComponent(code)}`, { method: 'DELETE' });
  if (!response.ok) throw new Error('削除に失敗しました。再試行してください');
}
