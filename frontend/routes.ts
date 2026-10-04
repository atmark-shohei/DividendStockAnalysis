/**
 * URL と画面の対応。**DOM に触らない純関数だけを置く。**
 *
 * 画面状態を URL に載せるのは `.claude/rules/frontend.md` の要求。旧実装
 * （`reference/legacy-web/`）はタブ切り替えを class の付け替えだけで行っており、
 * リロードと共有で選択が失われた。同じ作りにしない。
 *
 * DOM を触る側は `use-route.ts`。分けてあるのは、ここを素の Node でテストするため。
 */

import type { AuthUser } from './api';

/**
 * 銘柄コード。4文字固定、先頭3文字は数字・末尾1文字は数字または英大文字
 * （handler の `companyCode` と同じ形式）。
 *
 * `export` している（T-103）。`frontend/pages/portfolio-page-logic.ts` の
 * 保有銘柄追加フォーム（銘柄コード欄）が同じ形式検証を必要とするため、
 * フロントエンド内部での再利用として export した（`routes.ts` 自身が
 * BE の `company-input.ts` を独自定義している既存パターンとは別物。あちらは
 * ADR-0008 のランタイム import 制約を避けるための意図的重複、こちらは同一パッケージ内の
 * 通常の共有）。
 */
export const COMPANY_CODE = /^\d{3}[0-9A-Z]$/;

/**
 * 指標詳細キーの形式チェック（`docs/adr/0014-analysis-dialog-url-state.md` §決定3）。
 * 英字のみを許可する緩いチェック。`MetricKey`（`dividendGrowthRate` 等）はすべて
 * ASCII の camelCase で構成されるため、この形式チェックで十分。10種との実在突き合わせは
 * ここでは行わない（ダイアログ側=T-096 の責務）。
 *
 * 上限32文字は `src/domain/shared/metric-key.ts` の `METRIC_KEYS` 実測（2026-08時点、
 * 最長 `dividendSustainability` 22文字）にゆとり（+10文字）を持たせた値。`METRIC_KEYS`
 * は ADR-0008 の allowlist 外でランタイム import できないため、追従は手動。
 * 指標が増えて22文字を大きく超えるキーが追加された場合はこの上限も見直すこと。
 */
const METRIC_KEY_FORMAT = /^[A-Za-z]{1,32}$/;

/**
 * 検索一覧のソートキー。**意図的に `src/domain/company/company-list-query.ts` の
 * `COMPANY_SORT_KEYS` と重複定義している**（[ADR-0008](../docs/adr/0008-frontend-domain-runtime-import.md)
 * が「副作用の無い純粋関数」限定で frontend からのランタイム import を許可しており、
 * 定数配列がこの対象に含まれるかが文言上明確でないため。`COMPANY_CODE` 正規表現が
 * `company-input.ts` の形式を独立定義している既存の前例と同型）。
 * **BE 側がソートキーを変更したら、ここも手動で追従させること。**
 */
const COMPANY_SORT_KEYS = ['created_desc', 'score_desc', 'score_asc', 'code_asc'] as const;
export type CompanySortKey = (typeof COMPANY_SORT_KEYS)[number];
const DEFAULT_SORT: CompanySortKey = 'created_desc';
const DEFAULT_PAGE = 1;

export type Route =
  | {
      readonly kind: 'list';
      readonly selectedCode: string | null;
      /**
       * 指標詳細のキー（`MetricKey` 相当の文字列）。既定 `null`（概要モード）。
       * ここでは形式チェックのみを行う。10種のキーとの実在検証は行わない
       * （`METRIC_KEYS` が `src/domain/shared/` にあり ADR-0008 の allowlist
       * （`src/domain/company/` 限定）外のため、そもそもランタイム import できない。
       * 実在チェックはダイアログ側=T-096 が `GET /api/companies/:code` の応答と
       * 突き合わせて行う。`docs/adr/0014-analysis-dialog-url-state.md` §決定3）。
       *
       * **契約: `Route` オブジェクトは常に `parseRoute` / `createListRoute` を経由して
       * 構築される。** `selectedCode`（`COMPANY_CODE` での形式チェック）と同様、
       * `routeToPath` はこのフィールドを信頼できる内部状態として扱い、再検証しない
       * （CR-2 で検討し意図的にこの設計とした）。
       */
      readonly metric: string | null;
      /**
       * ③ 予想配当性向の採点に実績を使うか（チェックボックス）。
       * 「リクエスト単位の一時指定」（`docs/02_design/logic/payout-ratio-scoring.md` §7 決定5）
       * を URL 状態として扱う。省略時は `false`（Manager決定、2026-08-06）。
       */
      readonly useActualForScoring: boolean;
      /** 検索語（銘柄コード・銘柄名の部分一致）。既定 `''`。URL には出さない */
      readonly q: string;
      /** 一覧のソート順。既定 `created_desc`。URL には出さない */
      readonly sort: CompanySortKey;
      /** ページ番号（1始まり）。既定 `1`。URL には出さない */
      readonly page: number;
    }
  | { readonly kind: 'input' }
  | { readonly kind: 'criteria' }
  | { readonly kind: 'indicators' }
  | {
      readonly kind: 'portfolio';
      /** 表示中のポートフォリオID。既定 `null`（`portfolio-page.md` §2「ユーザーの先頭
       * ポートフォリオ」）。**先頭ポートフォリオの解決（`portfolios[0]`）は URL の責務外**
       * （DOM 非依存の `routes.ts` は一覧を知らない）。`App.tsx` が
       * `resolveActivePortfolioId`（`portfolio-page-logic.ts`）で解決する */
      readonly portfolioId: string | null;
      /** 解析ダイアログ共通（ADR-0014）。`list` と同じ形式チェック */
      readonly selectedCode: string | null;
      readonly metric: string | null;
    }
  | {
      readonly kind: 'login';
      /** 成功後に戻る画面のパス。`sanitizeRedirect` を通した後の値（常に安全な相対パス） */
      readonly redirect: string;
    }
  | {
      readonly kind: 'signup';
      readonly redirect: string;
    };

export const LIST_PATH = '/';
export const INPUT_PATH = '/input';
export const CRITERIA_PATH = '/criteria';
export const INDICATORS_PATH = '/indicators';
export const PORTFOLIO_PATH = '/portfolio';
export const LOGIN_PATH = '/login';
export const SIGNUP_PATH = '/signup';

/**
 * `redirect` クエリの検証。相対パスのみ許可する。
 *
 * `//` で始まるものはプロトコル相対URLとして外部ドメインへのリダイレクトに使われうるため
 * 拒否する（`docs/02_design/ui/pages/login-page.md` §2・§6、
 * `docs/02_design/ui/screen-list.md` §3.5）。
 */
export function sanitizeRedirect(raw: string | null): string {
  if (raw === null || raw === '') return LIST_PATH;
  // `\` を含む値は無条件で拒否する。WHATWG URL パーサは http/https 等の special scheme で
  // `\` を `/` と同一視して正規化するため、`/\evil.example.com` はブラウザによって
  // `//evil.example.com`（プロトコル相対 = 外部ドメイン）として解決されうる
  // （既知の "backslash trick"）。社内の相対パスに `\` が正規に登場することは無いため、
  // 正規化して再チェックするより「含んでいたら即座に既定値へ倒す」方が安全側で単純。
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return LIST_PATH;

  // `/login` `/signup` 自身への redirect は「ログイン成功→自画面へ戻る」という
  // 意味のない遷移になり、`navigate` の no-op 判定（use-route.ts）と自己防御
  // useEffect（App.tsx）の副作用に処理を委ねる不安定な経路になる（CR-7）。
  // クエリを含む可能性があるので pathname 部分だけを比較する（`parseRoute` と同じ
  // `indexOf` 方式。`noUncheckedIndexedAccess` 下で `split('?')[0]` は `string | undefined`
  // になるため使わない）。
  const queryIndex = raw.indexOf('?');
  const pathname = queryIndex === -1 ? raw : raw.slice(0, queryIndex);
  const normalizedPathname =
    pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
  if (normalizedPathname === LOGIN_PATH || normalizedPathname === SIGNUP_PATH) return LIST_PATH;

  return raw;
}

/** 末尾スラッシュを落とす。`/input/` と `/input` を別画面にしない */
function normalizePathname(pathname: string): string {
  return pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
}

/**
 * `location.pathname + location.search` 相当の文字列から画面を決める。
 *
 * 未知のパスは一覧へ倒す。Worker の `not_found_handling: single-page-application`
 * がどんなパスでも `index.html` を返すので、ここには何が来てもおかしくない。
 */
export function parseRoute(href: string): Route {
  const queryIndex = href.indexOf('?');
  const pathname = normalizePathname(queryIndex === -1 ? href : href.slice(0, queryIndex));
  const search = queryIndex === -1 ? '' : href.slice(queryIndex + 1);
  const params = new URLSearchParams(search);

  if (pathname === INPUT_PATH) return { kind: 'input' };
  // 会社非依存の公開画面（ログイン不要）。クエリパラメータは持たない
  // （`/indicators` と同じ「静的画面はURLに付随状態を持たない」方針。screen-list.md:80）
  if (pathname === CRITERIA_PATH) return { kind: 'criteria' };
  // 指標カスタマイズ画面（T-101）。ログイン必須（user/admin）だが、選択・基準値の
  // 編集中値は URL に一切載せない（`indicator-custom-page.md` §1）。クエリパラメータは
  // `criteria` と同様に無視してよい
  if (pathname === INDICATORS_PATH) return { kind: 'indicators' };
  if (pathname === LOGIN_PATH)
    return { kind: 'login', redirect: sanitizeRedirect(params.get('redirect')) };
  if (pathname === SIGNUP_PATH) {
    return { kind: 'signup', redirect: sanitizeRedirect(params.get('redirect')) };
  }

  const code = params.get('code');
  // 形式不正のコードは「選択なし」にする。API へ渡す前にここで弾く
  const selectedCode = code !== null && COMPANY_CODE.test(code) ? code : null;

  // ポートフォリオ画面（T-103）。`code`/`metric` は解析ダイアログ共通（ADR-0014）で
  // `list` と同じ形式チェックを再利用する。ログイン必須の実効ガードは
  // `resolveRouteGuardRedirect` 側
  if (pathname === PORTFOLIO_PATH) {
    return {
      kind: 'portfolio',
      portfolioId: parsePortfolioIdParam(params.get('portfolio')),
      selectedCode,
      metric: parseMetricParam(params.get('metric')),
    };
  }

  return {
    kind: 'list',
    selectedCode,
    metric: parseMetricParam(params.get('metric')),
    // 真偽値は文字列 "true" のときだけ true にする（`api.ts` の `useActualForScoring` と同じ形式）
    useActualForScoring: params.get('useActualForScoring') === 'true',
    // BE の `companyListQuery`（`q?.trim() ?? ''`）と同じ trim 挙動に揃える
    q: params.get('q')?.trim() ?? '',
    sort: parseCompanySortKey(params.get('sort')),
    page: parseCompanyListPage(params.get('page')),
  };
}

/**
 * ポートフォリオID（`?portfolio=`）の読み取り。**形式検証はしない**（`pf_xxxxx` 等の
 * 不透明なサーバー生成ID。`COMPANY_CODE`のような固定長フォーマットが無いため）。
 * 空文字・未指定は「先頭ポートフォリオへ委ねる」既定（`null`）にする。
 */
function parsePortfolioIdParam(raw: string | null): string | null {
  return raw !== null && raw !== '' ? raw : null;
}

/** 形式不正・空文字・未指定は `null`（概要モード）に倒す */
function parseMetricParam(raw: string | null): string | null {
  return raw !== null && METRIC_KEY_FORMAT.test(raw) ? raw : null;
}

/** 未知の値は既定へ倒す（BE `companyListQuery` の `z.enum(...).catch(DEFAULT)` と同じ思想） */
function parseCompanySortKey(raw: string | null): CompanySortKey {
  return raw !== null && (COMPANY_SORT_KEYS as readonly string[]).includes(raw)
    ? (raw as CompanySortKey)
    : DEFAULT_SORT;
}

/**
 * 1以上の整数でなければ既定へ倒す（0・負・小数・非数値をすべて弾く。
 * BE `companyListQuery` の `z.coerce.number().int().min(1).catch(DEFAULT)` と同じ丸め方針）。
 */
function parseCompanyListPage(raw: string | null): number {
  if (raw === null) return DEFAULT_PAGE;
  const value = Number(raw);
  return Number.isInteger(value) && value >= 1 ? value : DEFAULT_PAGE;
}

/**
 * `kind: 'list'` の `Route` を既定値付きで作る。呼び出し側は差分だけ書けばよい
 * （`Route` の `list` バリアントは必須フィールドが多く、直書きだと既定値の書き漏れ・
 * 書き間違いが起きやすいため。§3.1 の設計判断）。
 */
export function createListRoute(
  overrides?: Partial<Omit<Extract<Route, { readonly kind: 'list' }>, 'kind'>>,
): Route {
  return {
    kind: 'list',
    selectedCode: null,
    metric: null,
    useActualForScoring: false,
    q: '',
    sort: DEFAULT_SORT,
    page: DEFAULT_PAGE,
    ...overrides,
  };
}

/**
 * `kind: 'portfolio'` の `Route` を既定値付きで作る。`createListRoute` と同じ理由
 * （呼び出し側は差分だけ書けばよい）。
 */
export function createPortfolioRoute(
  overrides?: Partial<Omit<Extract<Route, { readonly kind: 'portfolio' }>, 'kind'>>,
): Route {
  return {
    kind: 'portfolio',
    portfolioId: null,
    selectedCode: null,
    metric: null,
    ...overrides,
  };
}

export function routeToPath(route: Route): string {
  if (route.kind === 'input') return INPUT_PATH;
  if (route.kind === 'criteria') return CRITERIA_PATH;
  if (route.kind === 'indicators') return INDICATORS_PATH;

  if (route.kind === 'portfolio') {
    const params = new URLSearchParams();
    if (route.portfolioId !== null) params.set('portfolio', route.portfolioId);
    if (route.selectedCode !== null) params.set('code', route.selectedCode);
    if (route.metric !== null) params.set('metric', route.metric);
    const query = params.toString();
    return query === '' ? PORTFOLIO_PATH : `${PORTFOLIO_PATH}?${query}`;
  }

  if (route.kind === 'login' || route.kind === 'signup') {
    const base = route.kind === 'login' ? LOGIN_PATH : SIGNUP_PATH;
    // 既定値（'/'）は URL に出さない。他の既定値省略（`useActualForScoring: false` 等）と同じ流儀
    if (route.redirect === LIST_PATH) return base;
    const params = new URLSearchParams();
    params.set('redirect', route.redirect);
    return `${base}?${params.toString()}`;
  }

  const params = new URLSearchParams();
  if (route.selectedCode !== null) params.set('code', route.selectedCode);
  // metric は selectedCode と同様に形式の再検証をしない（Route 型定義のコメント参照）
  if (route.metric !== null) params.set('metric', route.metric);
  // 既定値（false）は URL に出さない。既存の `/?code=7203` の見た目を変えないため
  if (route.useActualForScoring) params.set('useActualForScoring', 'true');
  // 検索・ソート・ページも既定値は URL に出さない（同じ流儀）
  if (route.q !== '') params.set('q', route.q);
  if (route.sort !== DEFAULT_SORT) params.set('sort', route.sort);
  if (route.page !== DEFAULT_PAGE) params.set('page', String(route.page));

  const query = params.toString();
  return query === '' ? LIST_PATH : `${LIST_PATH}?${query}`;
}

/**
 * admin か（`Role` 型は `'user' | 'admin'`。guest は `user === null` で表現）。
 * `resolveRouteGuardRedirect` と `NavBar.tsx` の `shouldShowInputTab` の両方から呼ぶ
 * 共有ヘルパー。ロールが増えたときに判定ロジックが2箇所で食い違うのを防ぐ（CR-6）。
 */
export function isAdmin(user: AuthUser | null): boolean {
  return user !== null && user.role === 'admin';
}

/**
 * ルートガード（`docs/02_design/ui/screen-list.md` §5.2）。遷移先を返す（リダイレクトが
 * 必要なとき）。不要なら `null`。**DOM に触らない。** `App.tsx` はこの結果で `navigate` を
 * 呼ぶだけにする（URL 解釈を純関数に閉じる本ファイルの既定方針）。
 *
 * **タブを隠す／FE でリダイレクトすることは認可ではない**（`.claude/rules/frontend.md`）。
 * `/input` の実効的な制限は BE 側の `requireRole('admin')`（T-104）が別途必要。
 *
 * **`/indicators` はログイン必須（user/admin）でガード済み**（T-101）。`/portfolio` も
 * 同様にログイン必須（T-103。`portfolio-page.md` §1「ログイン必須（user・admin）」）。
 *
 * guest 判定は常に `user === null`（`Role` 型に `'guest'` は無い。
 * `src/domain/auth/user.ts` の `Role` 型定義を参照）。
 */
export function resolveRouteGuardRedirect(route: Route, user: AuthUser | null): Route | null {
  if (route.kind === 'input') {
    if (user === null) {
      return { kind: 'login', redirect: routeToPath(route) };
    }
    if (!isAdmin(user)) {
      // 既にログインしているためログイン画面へは送らない（screen-list.md §5.2 の注記）
      return createListRoute();
    }
    return null;
  }

  // 指標カスタマイズ画面（T-101）。user/admin いずれも許可（`/input` と異なりロール分岐は無い。
  // `screen-list.md` §2「指標カスタマイズ: user ✅ / admin ✅」）
  if (route.kind === 'indicators' && user === null) {
    return { kind: 'login', redirect: routeToPath(route) };
  }

  // ポートフォリオ画面（T-103）。`/indicators` と同じくロール不問・ログイン必須
  if (route.kind === 'portfolio' && user === null) {
    return { kind: 'login', redirect: routeToPath(route) };
  }

  if ((route.kind === 'login' || route.kind === 'signup') && user !== null) {
    return createListRoute();
  }

  return null;
}
