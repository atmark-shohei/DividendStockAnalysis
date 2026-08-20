/**
 * Hono のルート定義。**HTTP の入出力だけ。ロジックを書かない。**
 *
 * ドメインエラーを HTTP ステータスへ変換するのはこの層の責務
 * （`.claude/CLAUDE.md`）。逆に、ドメインは HTTP を知らない。
 *
 * エラー応答に内部情報（SQL・スタックトレース・パス）を含めない
 * （`.claude/rules/backend.md`）。
 */

import { Hono } from 'hono';

import { type PasswordHasher } from '../domain/auth/password-hasher';
import { type SessionRepository } from '../domain/auth/session-repository';
import { type SessionTokenGenerator } from '../domain/auth/session-token-generator';
import { type UserRepository } from '../domain/auth/user-repository';
import { type CompanyRepository } from '../domain/company/company-repository';
import {
  type EdinetDocumentIndexLookup,
  type EdinetDocumentIndexRepository,
  type EdinetDocumentsListSource,
} from '../domain/company/edinet-document-index';
import { type EdinetHistorySource } from '../domain/company/edinet-history-source';
import { type FinancialSource } from '../domain/company/financial-source';
import { type MarketDataSource } from '../domain/company/market-data-source';
import { analyzeCompany } from '../usecase/analyze-company';
import { importEdinetHistory } from '../usecase/import-edinet-history';
import { importFromIrBank } from '../usecase/import-from-irbank';
import { importMarketData } from '../usecase/import-market-data';
import {
  deleteCompany,
  getCompanyDividendHistory,
  getCompanyScoring,
  listCompanies,
} from '../usecase/read-companies';
import { refreshEdinetDocumentIndex } from '../usecase/refresh-edinet-document-index';
import { registerAuthRoutes } from './auth-routes';
import { companyListQuery } from './dto/company-list-query';
import { toDividendHistoryResponse } from './dto/company-dividends';
import {
  analyzeCompanyRequest,
  toCompany,
  toScoringResponse,
  useActualForScoringQuery,
} from './dto/company-input';
import {
  isExternalFactor as isEdinetExternalFactor,
  toEdinetErrorResponse,
  toEdinetImportResponse,
} from './dto/edinet-import';
import {
  refreshDateQuery,
  toEdinetIndexRefreshErrorResponse,
  toEdinetIndexRefreshResponse,
} from './dto/edinet-index-refresh';
import {
  isExternalFactor,
  toIrBankErrorResponse,
  toIrBankImportResponse,
} from './dto/irbank-import';
import {
  fiscalYearEndMonthQuery,
  isExternalFactor as isMarketDataExternalFactor,
  toMarketDataErrorResponse,
  toMarketDataImportResponse,
} from './dto/market-data-import';
import { parsePriceInput } from './dto/price-input';
import { requireRole } from './require-role';

export interface AppDependencies {
  /** リポジトリは**インターフェースで**受け取る。D1 を直接は知らない */
  readonly repository: CompanyRepository;
  /** ユーザー認証。**インターフェースで**受け取る（`src/infra/d1/user-repository.ts`） */
  readonly userRepository: UserRepository;
  /** セッション。**インターフェースで**受け取る */
  readonly sessionRepository: SessionRepository;
  /** パスワードハッシュ。**インターフェースで**受け取る（`src/infra/auth/`） */
  readonly passwordHasher: PasswordHasher;
  /** セッショントークン生成。**インターフェースで**受け取る */
  readonly sessionTokenGenerator: SessionTokenGenerator;
  /** `SIGNUP_ENABLED`。未設定は呼び出し側（`src/index.ts`）が安全側（false）に倒す */
  readonly signupEnabled: boolean;
  /** `SIGNUP_MAX_USERS`。未設定は呼び出し側が 0 に倒す（実質サインアップ不可） */
  readonly maxUsers: number;
  /** Cookie の `Secure` 属性。未設定時は呼び出し側（`src/index.ts`）が安全側（true）に倒す */
  readonly cookieSecure: boolean;
  /** IRバンク取り込み。**インターフェースで**受け取り、fetch の詳細を知らない */
  readonly financialSource: FinancialSource;
  /** Yahoo からの市場データ取り込み。**インターフェースで**受け取る */
  readonly marketDataSource: MarketDataSource;
  /** EDINET からの財務履歴取り込み。**インターフェースで**受け取る */
  readonly edinetHistorySource: EdinetHistorySource;
  /** EDINET docIDインデックスの読み取り窓口。**インターフェースで**受け取る */
  readonly edinetDocumentIndexLookup: EdinetDocumentIndexLookup;
  /** 現在時刻。テストから固定できるように注入する */
  readonly now: () => Date;
  /**
   * docIDインデックスの管理用リフレッシュ（過去日の一括バックフィル）に必要な一式。
   *
   * **省略可**。渡さない、または `token` が未設定なら管理用エンドポイントは
   * 503 を返して無効化される（`src/index.ts` が `EDINET_ADMIN_TOKEN` から組み立てる）。
   */
  readonly edinetIndexAdmin?: {
    readonly documentsListSource: EdinetDocumentsListSource;
    readonly indexRepository: EdinetDocumentIndexRepository;
    /** 共有シークレット。`X-Admin-Token` ヘッダと突き合わせる */
    readonly token: string | undefined;
  };
  /**
   * EDINETパース結果キャッシュ（`edinet_document_summary`）の全行削除に必要な一式
   * （`docs/02_design/logic/edinet-history-import.md` §4.8.3。管理用）。
   *
   * **省略可**。渡さない、または `token` が未設定なら管理用エンドポイントは
   * 503 を返して無効化される（`edinetIndexAdmin` と同じパターン）。
   *
   * `repository` は infra の型（`EdinetDocumentSummaryCache`）を直接 import せず、
   * ここで最小限の構造型を定義する（T-057 のキャッシュ全体が「domain を経由しない
   * infra 内完結」という設計方針のため。実装計画 §0.2）。
   */
  readonly edinetSummaryCacheAdmin?: {
    readonly repository: { clearAll(): Promise<number> };
    /** 共有シークレット。`edinetIndexAdmin` と同じ `EDINET_ADMIN_TOKEN` を再利用する */
    readonly token: string | undefined;
  };
}

/**
 * 銘柄コードの形式。パスパラメータにも同じ検証をかける。
 *
 * 4文字固定。先頭3文字は数字、末尾1文字は数字または英大文字（例: `130A`）。
 * JPX が 2024 年以降に採番している英字混じりコードに対応する。
 */
const COMPANY_CODE_PATTERN = /^\d{3}[0-9A-Z]$/;

export function createApp(dependencies: AppDependencies): Hono {
  const app = new Hono();

  registerAuthRoutes(app, {
    userRepository: dependencies.userRepository,
    sessionRepository: dependencies.sessionRepository,
    passwordHasher: dependencies.passwordHasher,
    sessionTokenGenerator: dependencies.sessionTokenGenerator,
    signupEnabled: dependencies.signupEnabled,
    maxUsers: dependencies.maxUsers,
    cookieSecure: dependencies.cookieSecure,
    now: dependencies.now,
  });

  /** 銘柄登録・更新・削除の保護（`screen-list.md` §2。ADR-0013 制約1の解消） */
  const adminOnly = requireRole(
    {
      userRepository: dependencies.userRepository,
      sessionRepository: dependencies.sessionRepository,
      now: dependencies.now,
    },
    ['admin'],
  );

  app.get('/api/health', (context) => context.json({ status: 'ok' }));

  /** 株価入力の検証だけを行う。画面が入力中に呼ぶ */
  app.post('/api/price/parse', async (context) => {
    const body: unknown = await context.req.json().catch(() => null);
    const raw = typeof body === 'object' && body !== null && 'raw' in body ? body.raw : null;
    if (typeof raw !== 'string') {
      return context.json({ error: 'raw は文字列で指定する' }, 400);
    }
    return context.json(parsePriceInput(raw));
  });

  /**
   * 検索・ソート・サーバサイドページング（`docs/02_design/api/company-api.md` §GET /api/companies）。
   *
   * `q`/`sort`/`page`/`perPage` は**不正値・未知値でも400にせず既定値へ丸める**
   * （`useActualForScoring` 等の他クエリと違う扱い。検索は誤入力頻度が高いフィールドのため）。
   * `companyListQuery.parse()` は `.catch()` を使っているため常に成功する（400分岐は無い）。
   */
  app.get('/api/companies', async (context) => {
    const query = companyListQuery.parse({
      q: context.req.query('q'),
      sort: context.req.query('sort'),
      page: context.req.query('page'),
      perPage: context.req.query('perPage'),
    });
    const result = await listCompanies(dependencies.repository, query);
    return context.json({
      companies: result.items,
      page: query.page,
      perPage: query.perPage,
      total: result.total,
    });
  });

  app.post('/api/companies', adminOnly, async (context) => {
    const body: unknown = await context.req.json().catch(() => null);
    const parsed = analyzeCompanyRequest.safeParse(body);
    if (!parsed.success) {
      // zod の issue は「どの項目がなぜ駄目か」だけを返す。内部構造は出さない
      return context.json(
        {
          error: '入力が不正です。項目を確認して再送信してください',
          issues: parsed.error.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
        },
        400,
      );
    }

    const fetchedAt = dependencies.now().toISOString();
    const company = toCompany(parsed.data, fetchedAt);
    const useActualForScoring = parsed.data.useActualForScoring ?? false;
    const scoring = await analyzeCompany(
      dependencies.repository,
      company,
      dependencies.now,
      useActualForScoring,
    );
    return context.json(toScoringResponse(scoring), 201);
  });

  /**
   * IRバンクから財務データを取り込む。**保存はしない**（設計書 §1）。
   *
   * `code` の形式検証は `importFromIrBank` の先（`IrBankFinancialSource`）が行う。
   * 形式違いでもネットワークへ問い合わせずに `invalid-code` を返すので、
   * ここで同じ正規表現を重複させない。
   */
  app.get('/api/irbank/:code', async (context) => {
    const code = context.req.param('code');
    const result = await importFromIrBank(dependencies.financialSource, code);

    if (!result.ok) {
      if (isExternalFactor(result.error)) {
        // 外部要因の失敗はサーバー側にだけ詳細を残す（`.claude/rules/backend.md`）
        console.error('irbank import failed', result.error.kind);
      }
      const { body, status } = toIrBankErrorResponse(result.error);
      return context.json(body, status);
    }

    return context.json(toIrBankImportResponse(result.value));
  });

  /**
   * Yahoo Finance から株価・配当履歴・株式分割を取り込む。**保存はしない**（設計書 §1.2）。
   *
   * `fiscalYearEndMonth` は IRバンク取り込み（`GET /api/irbank/:code`）が返した値を
   * フロントがそのままクエリで渡す想定（設計書 §8-4。2本のエンドポイントに分ける方式）。
   * 未指定なら配当の年度集計をせず、株価・分割イベントだけを返す。
   */
  app.get('/api/market-data/:code', async (context) => {
    const code = context.req.param('code');
    const rawFiscalYearEndMonth = context.req.query('fiscalYearEndMonth');

    let fiscalYearEndMonth: number | null = null;
    if (rawFiscalYearEndMonth !== undefined) {
      const parsed = fiscalYearEndMonthQuery.safeParse(rawFiscalYearEndMonth);
      if (!parsed.success) {
        return context.json({ error: 'fiscalYearEndMonth は 1〜12 の整数で指定する' }, 400);
      }
      fiscalYearEndMonth = parsed.data;
    }

    const result = await importMarketData(dependencies.marketDataSource, code, fiscalYearEndMonth);

    if (!result.ok) {
      if (isMarketDataExternalFactor(result.error)) {
        // 外部要因の失敗はサーバー側にだけ詳細を残す（`.claude/rules/backend.md`）
        console.error('market data import failed', result.error.kind);
      }
      const { body, status } = toMarketDataErrorResponse(result.error);
      return context.json(body, status);
    }

    return context.json(toMarketDataImportResponse(result.value));
  });

  /**
   * EDINET から④⑦用の履歴・⑥用の貸借対照表項目（流動資産・投資有価証券）を取り込む。
   * **保存はしない**（設計書 §4.6。IRバンク・Yahoo と同じ「取得するだけで保存しない」原則）。
   *
   * docIDインデックス（`edinetDocumentIndexLookup`）は日次バッチ（`scheduled` ハンドラ）が
   * 事前に構築している前提。インデックスが無ければ `document-not-found` を返す
   * （設計書 §7.3。例外にしない）。
   */
  app.get('/api/edinet/:code', async (context) => {
    const code = context.req.param('code');
    const result = await importEdinetHistory(
      dependencies.edinetHistorySource,
      code,
      dependencies.edinetDocumentIndexLookup,
    );

    if (!result.ok) {
      if (isEdinetExternalFactor(result.error)) {
        // 外部要因の失敗はサーバー側にだけ詳細を残す（`.claude/rules/backend.md`）
        console.error('edinet import failed', result.error.kind);
      }
      const { body, status } = toEdinetErrorResponse(result.error);
      return context.json(body, status);
    }

    return context.json(toEdinetImportResponse(result.value));
  });

  /**
   * docIDインデックスへ、**指定した1日ぶん**の有価証券報告書を取り込む（管理用）。
   *
   * 日次 Cron は「前日1日ぶん」しか走査しないため、既に提出済みの過去の有報は
   * 永久にインデックスへ入らない。過去日を外から1日ずつ指定して埋めるための口
   * （`scripts/backfill-edinet-index.mjs` がこれを日付ループで叩く。設計書 §4.4）。
   *
   * 認証は共有シークレット1本（`X-Admin-Token`）。このアプリ自体に認証が無いため
   * （T-003/T-004 未決）、EDINET の API キーを他人に消費されないための最低限の柵に留める。
   */
  app.post('/api/admin/edinet/index/refresh', async (context) => {
    const admin = dependencies.edinetIndexAdmin;
    if (admin?.token === undefined) {
      return context.json(
        {
          error:
            '管理用エンドポイントが無効です。EDINET_ADMIN_TOKEN を設定して再デプロイしてください',
        },
        503,
      );
    }
    if (context.req.header('X-Admin-Token') !== admin.token) {
      return context.json({ error: '管理用トークンが一致しません' }, 401);
    }

    const parsed = refreshDateQuery.safeParse(context.req.query('date'));
    if (!parsed.success) {
      return context.json({ error: 'date は YYYY-MM-DD 形式の実在する日付で指定する' }, 400);
    }

    const result = await refreshEdinetDocumentIndex({
      documentsListSource: admin.documentsListSource,
      indexRepository: admin.indexRepository,
      companyRepository: dependencies.repository,
      now: dependencies.now,
      targetDate: parsed.data,
    });

    if (!result.ok) {
      // 外部要因の失敗はサーバー側にだけ詳細を残す（`.claude/rules/backend.md`）
      console.error('edinet index refresh failed', parsed.data, result.error.kind);
      const { body, status } = toEdinetIndexRefreshErrorResponse(result.error);
      return context.json(body, status);
    }

    return context.json(toEdinetIndexRefreshResponse(parsed.data, result.value));
  });

  /**
   * EDINETパース結果キャッシュ（`edinet_document_summary`）を全行削除する（管理用）。
   *
   * `schema_version` の上げ忘れに対する保険（設計書 §4.8.3）。通常運用では使わない想定。
   * ボディ・クエリパラメータは無し。認証は `edinetIndexAdmin` と同じ `X-Admin-Token`
   * パターンをそのまま踏襲する（実装計画 §0.2・§0.4）。
   */
  app.post('/api/admin/edinet/document-summary-cache/clear', async (context) => {
    const admin = dependencies.edinetSummaryCacheAdmin;
    if (admin?.token === undefined) {
      return context.json(
        {
          error:
            '管理用エンドポイントが無効です。EDINET_ADMIN_TOKEN を設定して再デプロイしてください',
        },
        503,
      );
    }
    if (context.req.header('X-Admin-Token') !== admin.token) {
      return context.json({ error: '管理用トークンが一致しません' }, 401);
    }

    const cleared = await admin.repository.clearAll();
    return context.json({ cleared });
  });

  /**
   * `useActualForScoring` は③ 予想配当性向で実績を強制採用するか（設計書 §5.1・§7）。
   * 未指定なら既定 `false`（予想優先）。`fiscalYearEndMonth` と同じ
   * 「クエリパラメータは zod で検証する」方式（BE 計画 §0.1・§4.2）。
   */
  app.get('/api/companies/:code', async (context) => {
    const code = context.req.param('code');
    if (!COMPANY_CODE_PATTERN.test(code)) {
      return context.json({ error: '銘柄コードの形式が不正です' }, 400);
    }

    const rawUseActualForScoring = context.req.query('useActualForScoring');
    let useActualForScoring = false;
    if (rawUseActualForScoring !== undefined) {
      const parsed = useActualForScoringQuery.safeParse(rawUseActualForScoring);
      if (!parsed.success) {
        return context.json({ error: 'useActualForScoring は true か false で指定する' }, 400);
      }
      useActualForScoring = parsed.data;
    }

    const scoring = await getCompanyScoring(dependencies.repository, code, useActualForScoring);
    if (scoring === null) {
      return context.json({ error: '指定された銘柄は保存されていません' }, 404);
    }
    return context.json(toScoringResponse(scoring));
  });

  /**
   * 保存済みの配当履歴を年度昇順（古い年→新しい年）で返す。①配当推移の折れ線グラフ・
   * ②連続非減配年数のリストが使う（`docs/02_design/api/company-api.md` 545-586行目）。
   * `GET /api/companies/:code` と同じ可視性（無認証で閲覧可）に揃える。
   */
  app.get('/api/companies/:code/dividends', async (context) => {
    const code = context.req.param('code');
    if (!COMPANY_CODE_PATTERN.test(code)) {
      return context.json({ error: '銘柄コードの形式が不正です' }, 400);
    }

    const history = await getCompanyDividendHistory(dependencies.repository, code);
    if (history === null) {
      return context.json({ error: '指定された銘柄は保存されていません' }, 404);
    }
    return context.json(toDividendHistoryResponse(history));
  });

  app.delete('/api/companies/:code', adminOnly, async (context) => {
    const code = context.req.param('code');
    if (!COMPANY_CODE_PATTERN.test(code)) {
      return context.json({ error: '銘柄コードの形式が不正です' }, 400);
    }
    await deleteCompany(dependencies.repository, code);
    return context.body(null, 204);
  });

  app.onError((error, context) => {
    // 外部要因の失敗とこちらのバグを区別するため、サーバー側にだけ詳細を出す
    console.error('unhandled error', error);
    return context.json(
      { error: 'サーバー側で処理できませんでした。時間をおいて再試行してください' },
      500,
    );
  });

  return app;
}
