import { describe, expect, it } from 'vitest';

import type { AuthUser } from '../../frontend/api';
import {
  createListRoute,
  createPortfolioRoute,
  isAdmin,
  parseRoute,
  resolveRouteGuardRedirect,
  routeToPath,
  sanitizeRedirect,
  type CompanySortKey,
  type Route,
} from '../../frontend/routes';

/**
 * URL と画面の対応。**画面状態は URL が正**なので、ここが崩れると
 * リロード・共有・戻る/進むが壊れる（`.claude/rules/frontend.md`）。
 *
 * `list` route の期待値は `createListRoute(overrides)` で作る。T-094 で
 * `q`/`sort`/`page` が増え、直書きリテラルだと書き漏れが起きやすいため
 * （`routes.ts` 冒頭のコメントと同じ理由）。
 */
describe('parseRoute', () => {
  const cases: readonly (readonly [name: string, href: string, expected: Route])[] = [
    ['ルートは一覧・選択なし', '/', createListRoute()],
    ['code 付きは一覧・選択あり', '/?code=7203', createListRoute({ selectedCode: '7203' })],
    [
      '3桁数字＋末尾英字の4文字コードも受ける',
      '/?code=130A',
      createListRoute({ selectedCode: '130A' }),
    ],
    ['入力画面', '/input', { kind: 'input' }],
    ['入力画面の末尾スラッシュは同じ画面', '/input/', { kind: 'input' }],
    ['入力画面のクエリは無視する', '/input?code=7203', { kind: 'input' }],
    ['評価基準画面', '/criteria', { kind: 'criteria' }],
    ['評価基準画面の末尾スラッシュは同じ画面', '/criteria/', { kind: 'criteria' }],
    ['評価基準画面のクエリは無視する', '/criteria?foo=bar', { kind: 'criteria' }],
    ['指標カスタマイズ画面', '/indicators', { kind: 'indicators' }],
    ['指標カスタマイズ画面の末尾スラッシュは同じ画面', '/indicators/', { kind: 'indicators' }],
    ['指標カスタマイズ画面のクエリは無視する', '/indicators?foo=bar', { kind: 'indicators' }],
    ['未知のパスは一覧へ倒す', '/no-such-page', createListRoute()],
    ['他のクエリ（未知のパラメータ）は選択に影響しない', '/?foo=bar', createListRoute()],
  ];

  it.each(cases)('%s', (_name, href, expected) => {
    expect(parseRoute(href)).toEqual(expected);
  });

  /**
   * 形式不正のコードをそのまま API へ渡さない。**判定は handler の `companyCode`
   * （`src/handler/dto/company-input.ts`）と同じ形式に揃える。**
   * 画面だけが緩いと API が 400 を返し、厳しいと登録済みの銘柄を開けなくなる。
   *
   * `1301A`（4桁数字＋英字の5文字）は JPX の実際の採番形式ではない
   * （4文字固定・末尾1文字だけが英字になりうる）ので、5文字コードは弾く。
   */
  const invalidCodes = ['', '720', '1301A', 'abcd', '7203a', '<script>', '7203 ', '７２０３'];

  it.each(invalidCodes)('形式不正のコード %j は選択なしにする', (code) => {
    expect(parseRoute(`/?code=${encodeURIComponent(code)}`)).toEqual(createListRoute());
  });

  it('code が空指定でも選択なしになる', () => {
    expect(parseRoute('/?code=')).toEqual(createListRoute());
  });

  /**
   * ③ 予想配当性向のソース切替（`docs/02_design/logic/payout-ratio-scoring.md` §7）。
   * 「リクエスト単位の一時指定」を URL 状態として扱う決定（Manager決定、2026-08-06）。
   */
  describe('useActualForScoring', () => {
    it('true 指定を受け取る', () => {
      expect(parseRoute('/?code=7203&useActualForScoring=true')).toEqual(
        createListRoute({ selectedCode: '7203', useActualForScoring: true }),
      );
    });

    it('省略時は false（既定は予想優先）', () => {
      expect(parseRoute('/?code=7203')).toEqual(createListRoute({ selectedCode: '7203' }));
    });

    it('"true" 以外の値（"1" 等）は false にする。文字列 "true" だけを真とする', () => {
      expect(parseRoute('/?code=7203&useActualForScoring=1')).toEqual(
        createListRoute({ selectedCode: '7203' }),
      );
    });

    it('選択なし（コード不正）でも独立して読める', () => {
      expect(parseRoute('/?useActualForScoring=true')).toEqual(
        createListRoute({ useActualForScoring: true }),
      );
    });
  });

  /**
   * 指標詳細モードのキー（T-095）。`docs/adr/0014-analysis-dialog-url-state.md` §決定3。
   * ここで検証するのは「英字のみか」の形式チェックのみ。`MetricKey` 10種との実在突き合わせは
   * ダイアログ側（T-096）が API 結果と突き合わせて行うため、ここではテストしない。
   */
  describe('metric', () => {
    it('未指定は概要モード（既定 null）', () => {
      expect(parseRoute('/?code=7203')).toEqual(createListRoute({ selectedCode: '7203' }));
    });

    it('正しい形式（英字のみ）をそのまま採用する', () => {
      expect(parseRoute('/?code=7203&metric=roeAverage')).toEqual(
        createListRoute({ selectedCode: '7203', metric: 'roeAverage' }),
      );
    });

    it('選択なし（code 未指定）でも metric は独立して読める', () => {
      expect(parseRoute('/?metric=roeAverage')).toEqual(createListRoute({ metric: 'roeAverage' }));
    });

    it('選択なし（code 形式不正）でも metric は独立して読める', () => {
      expect(parseRoute('/?code=abc&metric=roeAverage')).toEqual(
        createListRoute({ metric: 'roeAverage' }),
      );
    });

    it('32文字ちょうどは形式OK（上限値の境界）', () => {
      const metric = 'a'.repeat(32);
      expect(parseRoute(`/?code=7203&metric=${metric}`)).toEqual(
        createListRoute({ selectedCode: '7203', metric }),
      );
    });

    it.each([
      ['空文字は概要モードへ', '/?code=7203&metric=', ''],
      ['数字を含む値は形式不正', '/?code=7203&metric=metric1', 'metric1'],
      ['ハイフンを含む値は形式不正', '/?code=7203&metric=roe-average', 'roe-average'],
      ['アンダースコアを含む値は形式不正', '/?code=7203&metric=roe_average', 'roe_average'],
      ['前後空白付きは形式不正（trim しない）', '/?code=7203&metric=%20roeAverage', ' roeAverage'],
      ['スクリプトタグ等は形式不正', '/?code=7203&metric=%3Cscript%3E', '<script>'],
      ['全角英字は形式不正', '/?code=7203&metric=%EF%BD%92%EF%BD%8F%EF%BD%85', 'ｒｏｅ'],
      ['33文字は形式不正（上限超え）', `/?code=7203&metric=${'a'.repeat(33)}`, 'a'.repeat(33)],
    ])('%s（%j）', (_name, href) => {
      expect(parseRoute(href)).toEqual(createListRoute({ selectedCode: '7203' }));
    });
  });

  /**
   * 検索・ソート・ページング（T-094）。`docs/02_design/ui/screen-list.md` §3.1 が正。
   * 未知の値・範囲外は既定値へ倒す（BE `companyListQuery` と同じ思想）。
   */
  describe('q / sort / page', () => {
    it('q は前後の空白を trim する（BE companyListQuery と同じ挙動）', () => {
      expect(parseRoute('/?q=%20%E3%83%88%E3%83%A8%E3%82%BF%20')).toEqual(
        createListRoute({ q: 'トヨタ' }),
      );
    });

    it('q 省略時は空文字（絞り込まない）', () => {
      expect(parseRoute('/')).toEqual(createListRoute({ q: '' }));
    });

    const validSortKeys: readonly CompanySortKey[] = [
      'created_desc',
      'score_desc',
      'score_asc',
      'code_asc',
    ];

    it.each(validSortKeys)('sort=%s をそのまま受け取る', (sort) => {
      expect(parseRoute(`/?sort=${sort}`)).toEqual(createListRoute({ sort }));
    });

    it('未知の sort は既定値（created_desc）へ倒す', () => {
      expect(parseRoute('/?sort=unknown')).toEqual(createListRoute({ sort: 'created_desc' }));
    });

    it('sort 省略時は既定値（created_desc）', () => {
      expect(parseRoute('/')).toEqual(createListRoute({ sort: 'created_desc' }));
    });

    it('page はそのまま受け取る', () => {
      expect(parseRoute('/?page=3')).toEqual(createListRoute({ page: 3 }));
    });

    it.each([
      ['0以下は既定値（1）へ倒す', '/?page=0', 1],
      ['負の値は既定値（1）へ倒す', '/?page=-1', 1],
      ['小数は既定値（1）へ倒す', '/?page=1.5', 1],
      ['非数値は既定値（1）へ倒す', '/?page=abc', 1],
      ['空文字は既定値（1）へ倒す', '/?page=', 1],
    ])('%s', (_name, href, expectedPage) => {
      expect(parseRoute(href)).toEqual(createListRoute({ page: expectedPage }));
    });

    it('q・sort・page を同時に指定できる', () => {
      expect(parseRoute('/?q=7203&sort=score_desc&page=2')).toEqual(
        createListRoute({ q: '7203', sort: 'score_desc', page: 2 }),
      );
    });
  });
});

/**
 * ポートフォリオ画面（T-103）。`docs/02_design/ui/pages/portfolio-page.md` §2
 * 「portfolio（表示中のポートフォリオID）/ code・metric（解析ダイアログ共通）」。
 */
describe('parseRoute（ポートフォリオ）', () => {
  const cases: readonly (readonly [name: string, href: string, expected: Route])[] = [
    ['ポートフォリオ画面（既定）', '/portfolio', createPortfolioRoute()],
    [
      'portfolio 付き',
      '/portfolio?portfolio=pf_01',
      createPortfolioRoute({ portfolioId: 'pf_01' }),
    ],
    [
      'portfolio・code・metric を同時に受け取る',
      '/portfolio?portfolio=pf_01&code=7203&metric=roeAverage',
      createPortfolioRoute({ portfolioId: 'pf_01', selectedCode: '7203', metric: 'roeAverage' }),
    ],
    [
      '末尾スラッシュは同じ画面（/input 等と同じ正規化）',
      '/portfolio/',
      createPortfolioRoute(),
    ],
    ['portfolio 省略時は null（先頭ポートフォリオへ委ねる既定）', '/portfolio?code=7203', createPortfolioRoute({ selectedCode: '7203' })],
    ['portfolio が空文字なら null 扱い', '/portfolio?portfolio=', createPortfolioRoute()],
    [
      'code の形式不正は選択なしにする（list と同じ形式チェックを再利用）',
      '/portfolio?code=abc',
      createPortfolioRoute(),
    ],
    [
      'metric の形式不正は概要モードへ倒す（list と同じ形式チェックを再利用）',
      '/portfolio?metric=roe-average',
      createPortfolioRoute(),
    ],
  ];

  it.each(cases)('%s', (_name, href, expected) => {
    expect(parseRoute(href)).toEqual(expected);
  });
});

describe('routeToPath', () => {
  const cases: readonly (readonly [name: string, route: Route, expected: string])[] = [
    ['一覧・選択なし', createListRoute(), '/'],
    ['一覧・選択あり', createListRoute({ selectedCode: '7203' }), '/?code=7203'],
    ['入力画面', { kind: 'input' }, '/input'],
    ['評価基準画面', { kind: 'criteria' }, '/criteria'],
    ['指標カスタマイズ画面', { kind: 'indicators' }, '/indicators'],
    ['ポートフォリオ画面（既定）', createPortfolioRoute(), '/portfolio'],
    [
      'ポートフォリオID付き',
      createPortfolioRoute({ portfolioId: 'pf_01' }),
      '/portfolio?portfolio=pf_01',
    ],
    [
      'ポートフォリオID・code・metric を同時に付ける',
      createPortfolioRoute({ portfolioId: 'pf_01', selectedCode: '7203', metric: 'roeAverage' }),
      '/portfolio?portfolio=pf_01&code=7203&metric=roeAverage',
    ],
    [
      'metric 付きは code の後ろに並ぶ',
      createListRoute({ selectedCode: '7203', metric: 'roeAverage' }),
      '/?code=7203&metric=roeAverage',
    ],
    [
      '選択なしでも metric だけ付けられる',
      createListRoute({ metric: 'roeAverage' }),
      '/?metric=roeAverage',
    ],
    [
      'metric と useActualForScoring を同時に付ける',
      createListRoute({ selectedCode: '7203', metric: 'roeAverage', useActualForScoring: true }),
      '/?code=7203&metric=roeAverage&useActualForScoring=true',
    ],
    [
      '実績優先も選択ありなら useActualForScoring=true を付ける',
      createListRoute({ selectedCode: '7203', useActualForScoring: true }),
      '/?code=7203&useActualForScoring=true',
    ],
    [
      '選択なしでも実績優先の指定は残す',
      createListRoute({ useActualForScoring: true }),
      '/?useActualForScoring=true',
    ],
    [
      'q が既定値と違えば付ける',
      createListRoute({ q: 'トヨタ' }),
      '/?q=%E3%83%88%E3%83%A8%E3%82%BF',
    ],
    ['sort が既定値と違えば付ける', createListRoute({ sort: 'score_desc' }), '/?sort=score_desc'],
    ['page が既定値と違えば付ける', createListRoute({ page: 2 }), '/?page=2'],
    [
      'q・sort・page をまとめて付ける',
      createListRoute({ q: 'a', sort: 'code_asc', page: 3 }),
      '/?q=a&sort=code_asc&page=3',
    ],
  ];

  it.each(cases)('%s', (_name, route, expected) => {
    expect(routeToPath(route)).toBe(expected);
  });

  it('往復しても同じ画面になる', () => {
    for (const route of cases.map(([, value]) => value)) {
      expect(parseRoute(routeToPath(route))).toEqual(route);
    }
  });

  it('既定値（false）は URL に出さない。既存の見た目（/?code=7203）を変えない', () => {
    expect(routeToPath(createListRoute({ selectedCode: '7203' }))).toBe('/?code=7203');
  });

  it('既定値（q/sort/page）は URL に出さない', () => {
    expect(routeToPath(createListRoute({ q: '', sort: 'created_desc', page: 1 }))).toBe('/');
  });

  it('既定値（metric: null）は URL に出さない', () => {
    expect(routeToPath(createListRoute({ selectedCode: '7203', metric: null }))).toBe(
      '/?code=7203',
    );
  });
});

describe('createListRoute', () => {
  it('引数無しは既定値そのもの', () => {
    expect(createListRoute()).toEqual({
      kind: 'list',
      selectedCode: null,
      useActualForScoring: false,
      metric: null,
      q: '',
      sort: 'created_desc',
      page: 1,
    });
  });

  it('overrides で差分だけ渡せる', () => {
    expect(createListRoute({ page: 2 })).toEqual({
      kind: 'list',
      selectedCode: null,
      useActualForScoring: false,
      metric: null,
      q: '',
      sort: 'created_desc',
      page: 2,
    });
  });

  it('metric だけ override しても他のフィールドは既定値のまま', () => {
    expect(createListRoute({ metric: 'roeAverage' })).toEqual({
      kind: 'list',
      selectedCode: null,
      useActualForScoring: false,
      metric: 'roeAverage',
      q: '',
      sort: 'created_desc',
      page: 1,
    });
  });
});

describe('createPortfolioRoute', () => {
  it('引数無しは既定値そのもの', () => {
    expect(createPortfolioRoute()).toEqual({
      kind: 'portfolio',
      portfolioId: null,
      selectedCode: null,
      metric: null,
    });
  });

  it('overrides で差分だけ渡せる', () => {
    expect(createPortfolioRoute({ portfolioId: 'pf_01' })).toEqual({
      kind: 'portfolio',
      portfolioId: 'pf_01',
      selectedCode: null,
      metric: null,
    });
  });
});

/**
 * ログイン/アカウント作成画面のルーティング（T-091 FE分）。
 * `docs/02_design/ui/pages/login-page.md` §2・`docs/02_design/ui/screen-list.md` §3.5。
 */
describe('sanitizeRedirect（オープンリダイレクト対策）', () => {
  const cases: readonly (readonly [name: string, raw: string | null, expected: string])[] = [
    ['null は既定へ', null, '/'],
    ['空文字は既定へ', '', '/'],
    ['相対パスはそのまま許可', '/portfolio', '/portfolio'],
    ['既定と同じ値（/）はそのまま', '/', '/'],
    ['外部URL（絶対URL）は既定へ倒す', 'https://evil.example.com', '/'],
    ['プロトコル相対URL（//）は既定へ倒す', '//evil.example.com', '/'],
    ['スキームもスラッシュも無い文字列は既定へ倒す', 'evil.example.com', '/'],
    ['バックスラッシュ経由の外部URL指定は既定へ倒す', '/\\evil.example.com', '/'],
    ['ログイン画面自身への redirect は既定へ倒す', '/login', '/'],
    ['サインアップ画面自身への redirect は既定へ倒す', '/signup', '/'],
    ['末尾スラッシュ付きの自己参照も既定へ倒す', '/login/', '/'],
  ];

  it.each(cases)('%s', (_name, raw, expected) => {
    expect(sanitizeRedirect(raw)).toBe(expected);
  });
});

describe('parseRoute（ログイン/アカウント作成）', () => {
  const cases: readonly (readonly [name: string, href: string, expected: Route])[] = [
    ['ログイン画面', '/login', { kind: 'login', redirect: '/' }],
    ['redirect 付き', '/login?redirect=/portfolio', { kind: 'login', redirect: '/portfolio' }],
    [
      '外部URL指定は既定へ倒れる',
      '/login?redirect=https://evil.example.com',
      { kind: 'login', redirect: '/' },
    ],
    [
      'プロトコル相対は既定へ倒れる',
      '/login?redirect=//evil.example.com',
      { kind: 'login', redirect: '/' },
    ],
    [
      '相対パスでない値は既定へ倒れる',
      '/login?redirect=evil.example.com',
      { kind: 'login', redirect: '/' },
    ],
    ['サインアップ画面', '/signup', { kind: 'signup', redirect: '/' }],
    [
      '末尾スラッシュは同じ画面（/input と同じ正規化）',
      '/login/',
      { kind: 'login', redirect: '/' },
    ],
    ['redirect 省略', '/login', { kind: 'login', redirect: '/' }],
    ['redirect が空文字', '/login?redirect=', { kind: 'login', redirect: '/' }],
    ['redirect が既定値と同じ（/）', '/login?redirect=/', { kind: 'login', redirect: '/' }],
    [
      'バックスラッシュ経由は既定へ倒れる',
      '/login?redirect=%2F%5Cevil.example.com',
      { kind: 'login', redirect: '/' },
    ],
    [
      'redirect が自画面（/login）なら既定へ倒れる',
      '/login?redirect=/login',
      { kind: 'login', redirect: '/' },
    ],
    [
      'redirect が他方の自画面（/signup）でも既定へ倒れる',
      '/login?redirect=/signup',
      { kind: 'login', redirect: '/' },
    ],
  ];

  it.each(cases)('%s', (_name, href, expected) => {
    expect(parseRoute(href)).toEqual(expected);
  });
});

describe('routeToPath（ログイン/アカウント作成）', () => {
  it('往復しても同じ画面になる（redirect あり）', () => {
    const route: Route = { kind: 'login', redirect: '/portfolio' };
    expect(routeToPath(route)).toBe('/login?redirect=%2Fportfolio');
    expect(parseRoute(routeToPath(route))).toEqual(route);
  });

  it('既定値（redirect: "/"）はクエリを省略する', () => {
    expect(routeToPath({ kind: 'login', redirect: '/' })).toBe('/login');
    expect(routeToPath({ kind: 'signup', redirect: '/' })).toBe('/signup');
  });

  it('signup も同じ形式で往復する', () => {
    const route: Route = { kind: 'signup', redirect: '/indicators' };
    expect(routeToPath(route)).toBe('/signup?redirect=%2Findicators');
    expect(parseRoute(routeToPath(route))).toEqual(route);
  });
});

/**
 * ルートガード（T-092）。`docs/02_design/ui/screen-list.md` §5.2 の表を1対1でカバーする。
 * guest 判定は `user === null`（`Role` 型に `'guest'` は無い）。
 */
describe('resolveRouteGuardRedirect', () => {
  const asUser: AuthUser = { id: 1, email: 'user@example.com', role: 'user' };
  const asAdmin: AuthUser = { id: 2, email: 'admin@example.com', role: 'admin' };

  const listRoute: Route = createListRoute();
  const inputRoute: Route = { kind: 'input' };
  const criteriaRoute: Route = { kind: 'criteria' };
  const indicatorsRoute: Route = { kind: 'indicators' };
  const portfolioRoute: Route = createPortfolioRoute();
  const loginRoute: Route = { kind: 'login', redirect: '/' };
  const signupRoute: Route = { kind: 'signup', redirect: '/' };

  const cases: readonly (readonly [
    name: string,
    route: Route,
    user: AuthUser | null,
    expected: Route | null,
  ])[] = [
    ['guestが/inputを開く -> /loginへ', inputRoute, null, { kind: 'login', redirect: '/input' }],
    ['userが/inputを開く -> /へ（ログイン画面へは送らない）', inputRoute, asUser, listRoute],
    ['adminが/inputを開く -> ガード不要', inputRoute, asAdmin, null],
    ['guestが/loginを開く -> ガード不要', loginRoute, null, null],
    ['userが/loginを開く -> /へ', loginRoute, asUser, listRoute],
    ['adminが/loginを開く -> /へ', loginRoute, asAdmin, listRoute],
    ['guestが/signupを開く -> ガード不要', signupRoute, null, null],
    ['userが/signupを開く -> /へ', signupRoute, asUser, listRoute],
    ['adminが/signupを開く -> /へ', signupRoute, asAdmin, listRoute],
    ['guestが/を開く -> ガード不要', listRoute, null, null],
    ['adminが/を開く -> ガード対象外', listRoute, asAdmin, null],
    // 評価基準タブ（T-099）はログイン不要・全員閲覧可（screen-list.md §5.2の表に無い＝ガード対象外）
    ['guestが/criteriaを開く -> ガード不要', criteriaRoute, null, null],
    ['userが/criteriaを開く -> ガード不要', criteriaRoute, asUser, null],
    ['adminが/criteriaを開く -> ガード不要', criteriaRoute, asAdmin, null],
    // 指標カスタマイズ（T-101）はログイン必須・user/admin両方許可（`/input`と異なりロール分岐なし）
    [
      'guestが/indicatorsを開く -> /loginへ',
      indicatorsRoute,
      null,
      { kind: 'login', redirect: '/indicators' },
    ],
    ['userが/indicatorsを開く -> ガード不要', indicatorsRoute, asUser, null],
    ['adminが/indicatorsを開く -> ガード不要', indicatorsRoute, asAdmin, null],
    // ポートフォリオ画面（T-103）はログイン必須・user/admin両方許可（`/indicators`と同型）
    [
      'guestが/portfolioを開く -> /loginへ',
      portfolioRoute,
      null,
      { kind: 'login', redirect: '/portfolio' },
    ],
    ['userが/portfolioを開く -> ガード不要', portfolioRoute, asUser, null],
    ['adminが/portfolioを開く -> ガード不要', portfolioRoute, asAdmin, null],
  ];

  it.each(cases)('%s', (_name, route, user, expected) => {
    expect(resolveRouteGuardRedirect(route, user)).toEqual(expected);
  });

  it('/input への guest 用 redirect は現在パスそのもの（クエリ無し）', () => {
    const redirectTo = resolveRouteGuardRedirect(inputRoute, null);
    expect(redirectTo).not.toBeNull();
    if (redirectTo === null || redirectTo.kind !== 'login') throw new Error('unreachable');
    expect(redirectTo.redirect).toBe('/input');
  });

  describe('isAdmin', () => {
    const isAdminCases: readonly (readonly [
      name: string,
      user: AuthUser | null,
      expected: boolean,
    ])[] = [
      ['guest（null） -> false', null, false],
      ['一般ユーザー -> false', asUser, false],
      ['管理者 -> true', asAdmin, true],
    ];

    it.each(isAdminCases)('%s', (_name, user, expected) => {
      expect(isAdmin(user)).toBe(expected);
    });
  });
});
