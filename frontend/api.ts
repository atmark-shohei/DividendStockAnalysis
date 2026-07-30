/**
 * API クライアント。**データ取得はここと画面（App）だけ。**
 * 表示コンポーネントは props で受け取る（`.claude/rules/frontend.md`）。
 *
 * 型は handler の DTO から type-only で読む。二重定義しない（`.claude/CLAUDE.md`）。
 */

import type { AnalyzeCompanyRequest, ScoringResponse } from '@/handler/dto/company-input';
import type { IrBankImportResponse } from '@/handler/dto/irbank-import';
import type { CompanySummary } from '@/domain/company/company-repository';

export type { AnalyzeCompanyRequest, ScoringResponse, IrBankImportResponse };

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

export function getCompany(code: string): Promise<ScoringResponse> {
  return request<ScoringResponse>(`/api/companies/${encodeURIComponent(code)}`);
}

/** IRバンクから財務データを取り込む。**保存はしない**（結果はフォームの初期値にするだけ） */
export function importFromIrBank(code: string): Promise<IrBankImportResponse> {
  return request<IrBankImportResponse>(`/api/irbank/${encodeURIComponent(code)}`);
}

export async function deleteCompany(code: string): Promise<void> {
  const response = await fetch(`/api/companies/${encodeURIComponent(code)}`, { method: 'DELETE' });
  if (!response.ok) throw new Error('削除に失敗しました。再試行してください');
}
