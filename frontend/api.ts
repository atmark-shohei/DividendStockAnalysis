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
import type { LoginRequest, SignupRequest, UserView } from '@/handler/dto/auth-input';

import type { CompanySortKey } from './routes';

export type {
  AnalyzeCompanyRequest,
  ScoringResponse,
  IrBankImportResponse,
  MarketDataImportResponse,
  EdinetImportResponse,
};

export type { LoginRequest, SignupRequest };
/** `UserView`（BE DTO）の再エクスポート。FE 側の呼び名 `AuthUser` に合わせるだけで構造は同一 */
export type AuthUser = UserView;

interface AuthUserResponse {
  readonly user: AuthUser;
}

/** レスポンスボディから `error` 文言を安全に取り出す。無ければ `fallback` を返す */
function extractErrorMessage(body: unknown, fallback: string): string {
  return typeof body === 'object' &&
    body !== null &&
    'error' in body &&
    typeof body.error === 'string'
    ? body.error
    : fallback;
}

/** 失敗しうる外部呼び出しは必ず結果を検査する（`.claude/rules/coding-style.md`） */
async function request<T>(input: string, init?: RequestInit): Promise<T> {
  // `credentials` は同一オリジン前提でも明示する（fe-plan.md §3・Manager決定）。
  // 一度変数に代入してから渡す。`tests/frontend/*.test.ts` はビルド構成上 `tsconfig.json`
  // （Workers 側）にも include されており、そちらの `RequestInit`（`worker-configuration.d.ts`）
  // は DOM 版と異なり `credentials` を持たない。object literal を直接 `fetch()` の引数にすると
  // 過剰プロパティチェックで弾かれるため、変数を経由して回避する
  const requestInit = {
    ...init,
    credentials: 'same-origin' as const,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  };
  const response = await fetch(input, requestInit);

  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    throw new Error(
      extractErrorMessage(
        body,
        `通信に失敗しました（${String(response.status)}）。時間をおいて再試行してください`,
      ),
    );
  }

  return (await response.json()) as T;
}

export function analyzeCompany(payload: AnalyzeCompanyRequest): Promise<ScoringResponse> {
  return request<ScoringResponse>('/api/companies', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export interface CompanyListParams {
  /** 銘柄コード・銘柄名の部分一致。既定 `''`（絞り込まない）。省略時はクエリを付けない */
  readonly q?: string;
  /** 既定 `created_desc`。既定値と同じならクエリを付けない */
  readonly sort?: CompanySortKey;
  /** 1始まり。既定 `1`。既定値と同じならクエリを付けない */
  readonly page?: number;
}

/**
 * `GET /api/companies` のレスポンス。**BE の handler DTO 化されていない**
 * （`src/handler/app.ts` がインラインオブジェクトを `context.json()` している）ため、
 * ここで FE ローカルに型定義する（`docs/02_design/api/company-api.md` §GET /api/companies）。
 * domain の `CompanyListResult`（`{ items, total }`）とは形が違うため名前を分ける。
 */
export interface CompanyListResponse {
  readonly companies: readonly CompanySummary[];
  readonly page: number;
  readonly perPage: number;
  readonly total: number;
}

/**
 * 検索一覧の取得。`perPage` はクエリに含めない（`screen-list.md` §3.1 に記載が無く、
 * 常に BE 既定の15件に委ねる設計）。既定値省略パターンは `getCompany` と同じ形。
 */
export function listCompanies(params?: CompanyListParams): Promise<CompanyListResponse> {
  const query = new URLSearchParams();
  if (params?.q !== undefined && params.q !== '') query.set('q', params.q);
  if (params?.sort !== undefined && params.sort !== 'created_desc') query.set('sort', params.sort);
  if (params?.page !== undefined && params.page !== 1) query.set('page', String(params.page));
  const qs = query.toString();
  return request<CompanyListResponse>(`/api/companies${qs === '' ? '' : `?${qs}`}`);
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
  return request<MarketDataImportResponse>(`/api/market-data/${encodeURIComponent(code)}${query}`);
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

export function signup(payload: SignupRequest): Promise<AuthUserResponse> {
  return request<AuthUserResponse>('/api/auth/signup', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function login(payload: LoginRequest): Promise<AuthUserResponse> {
  return request<AuthUserResponse>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/**
 * 常に 204（冪等。未ログインでも 204。auth-api.md §POST /api/auth/logout）。
 * 本文が無いので `request<T>` は使わない（`deleteCompany` と同じ方針）。
 */
export async function logout(): Promise<void> {
  // `credentials` を変数経由で渡す理由は `request()` のコメントを参照
  const logoutInit = { method: 'POST', credentials: 'same-origin' as const };
  const response = await fetch('/api/auth/logout', logoutInit);
  if (!response.ok) throw new Error('ログアウトに失敗しました。再試行してください');
}

/**
 * 現在のセッションのユーザー。**未ログイン（401）はエラーではなく `null`**
 * （`request<T>` をそのまま使うと 401 を例外にしてしまい、ゲスト状態を
 * 「通信エラー」として画面に出しかねない。ここだけ status を直接見て分岐する）。
 * サーバーエラー（500等・ネットワーク断）は例外のまま投げ、App 側で通常のエラー表示に乗せる
 * （黙って guest 扱いにしない。Manager決定）。
 */
export async function getCurrentUser(): Promise<AuthUser | null> {
  // `credentials` を変数経由で渡す理由は `request()` のコメントを参照。
  // `method` も明示しているのは、TS の「対象型と共通のプロパティが1つも無いオブジェクトは
  // 弱い型として拒否する」チェックを避けるため（`credentials` 単独だと Workers 側の
  // `RequestInit` と共通プロパティが無く弾かれる）
  const meInit = { method: 'GET', credentials: 'same-origin' as const };
  const response = await fetch('/api/auth/me', meInit);
  if (response.status === 401) return null;
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    throw new Error(extractErrorMessage(body, 'ログイン状態の確認に失敗しました'));
  }
  const body = (await response.json()) as AuthUserResponse;
  return body.user;
}
