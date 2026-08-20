import { useCallback, useEffect, useMemo, useState } from 'react';

import type {
  AnalyzeCompanyRequest,
  AuthUser,
  CompanyListResponse,
  LoginRequest,
  ScoringResponse,
  SignupRequest,
} from './api';
import * as api from './api';
import { AuthStatus } from './components/AuthStatus';
import { NavBar } from './components/NavBar';
import { AuthPage } from './pages/AuthPage';
import { InputPage } from './pages/InputPage';
import { ListPage } from './pages/ListPage';
import {
  createListRoute,
  isAdmin,
  parseRoute,
  resolveRouteGuardRedirect,
  routeToPath,
  type CompanySortKey,
} from './routes';
import { useRoute } from './use-route';

/** `GET /api/companies` の初期値。取得完了まで（`loadingCompanies`）はこの空の状態を出す。
 * `perPage: 15` は BE 既定値 `DEFAULT_COMPANY_LIST_PER_PAGE`
 * （`src/domain/company/company-list-query.ts`）と同じ値の意図的な重複。
 * FE は domain の定数を直接 import しない方針（`routes.ts` の `COMPANY_SORT_KEYS` と同じ理由。
 * ADR-0008 のグレーゾーンを避ける）。BE 側の既定値が変わったらここも手動で追従させること */
const EMPTY_COMPANY_LIST: CompanyListResponse = { companies: [], page: 1, perPage: 15, total: 0 };

/**
 * アプリの外枠。**データ取得はここに集約**し、各画面へは props で渡す
 * （`.claude/rules/frontend.md`）。画面自体は `pages/` にある。
 *
 * 「データ入力」と「保存済み銘柄」は別 URL の別画面。どちらを出すかは URL が決める。
 */
export function App() {
  const [route, navigate] = useRoute();
  const [scoring, setScoring] = useState<ScoringResponse | null>(null);
  const [companies, setCompanies] = useState<CompanyListResponse>(EMPTY_COMPANY_LIST);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadingScoring, setLoadingScoring] = useState(false);
  // 初回は必ず reload() が走る前提のため true から始める（CR-6。`false` だと
  // マウント直後の1フレームで EmptyState が一瞬見える）
  const [loadingCompanies, setLoadingCompanies] = useState(true);

  // 認証状態。`null` は「未ログイン（guest）」。起動時に一度だけ `GET /api/auth/me` を叩く
  const [user, setUser] = useState<AuthUser | null>(null);
  // 起動時の `GET /api/auth/me` が完了したか。**`user === null` だけでは「未確認」と
  // 「確認済み・未ログイン（guest）」を区別できない**（T-092）。区別せずルートガードを
  // 発火させると、`/input` を直接開いた admin が応答が届く前の一瞬 `/login` へ弾かれる
  // （fe-plan.md §2-B の既知バグ）。ガード useEffect はこれが `true` になるまで待つ
  const [authChecked, setAuthChecked] = useState(false);
  // ログイン/サインアップフォーム送信のエラー（カード内に表示。一覧取得等の `error` とは別枠）
  const [authError, setAuthError] = useState<string | null>(null);
  const [authBusy, setAuthBusy] = useState(false);

  const selectedCode = route.kind === 'list' ? route.selectedCode : null;
  // ③ 予想配当性向の採点に実績を使うか。URL が正（`.claude/rules/frontend.md`
  // 「選択中の銘柄コードは URL に置く」と同じ扱い。Manager決定、2026-08-06）
  const useActualForScoring = route.kind === 'list' ? route.useActualForScoring : false;
  // 検索・ソート・ページも URL が正（`screen-list.md` §3.1）
  const q = route.kind === 'list' ? route.q : '';
  const sort: CompanySortKey = route.kind === 'list' ? route.sort : 'created_desc';
  const page = route.kind === 'list' ? route.page : 1;

  /**
   * 依存配列は q/sort/page だけに絞る。`selectedCode`/`useActualForScoring` の変化
   * （銘柄選択・実績切替）では一覧を再フェッチしない（fe-plan.md §3.5）。
   */
  const reload = useCallback(async () => {
    setLoadingCompanies(true);
    try {
      setCompanies(await api.listCompanies({ q, sort, page }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '一覧の取得に失敗しました');
    } finally {
      setLoadingCompanies(false);
    }
  }, [q, sort, page]);

  useEffect(() => {
    // 一覧のクエリ（q/sort/page）はリスト画面以外では常に既定値のため、一覧以外を
    // 表示している間は再取得しない（CR-5。`/input` 等への遷移で無駄な GET を飛ばさない）
    if (route.kind !== 'list') return;
    void reload();
  }, [reload, route.kind]);

  /**
   * 起動時に一度だけログイン状態を確認する。**401（未ログイン）はエラーではない**
   * （`api.getCurrentUser` が `null` を返す）。通信障害（500・ネットワーク断）は
   * 黙って guest 扱いにせず、既存の `error`（一覧取得等と共有）に出す。
   * ユーザーが気付けない形で認証状態を誤認させないため（Manager決定）。
   */
  useEffect(() => {
    api
      .getCurrentUser()
      .then(setUser)
      .catch((cause: unknown) => {
        setUser(null);
        setError(cause instanceof Error ? cause.message : 'ログイン状態の確認に失敗しました');
      })
      .finally(() => setAuthChecked(true));
  }, []);

  /**
   * ルートガード（`docs/02_design/ui/screen-list.md` §5.2、T-092）。判定は
   * `resolveRouteGuardRedirect`（DOM 非依存の純関数）に閉じ、ここは結果で `navigate`
   * するだけの薄い配線にする（`routes.ts` 冒頭の既定方針）。
   *
   * `/login` `/signup` を開いた既ログインを `/` へ戻す旧来の自己防御ガードは
   * `resolveRouteGuardRedirect` に統合したので、ここでは重複して書かない。
   *
   * `authChecked` が `false` の間は発火させない。起動直後は `user === null` が
   * 「未確認」なのか「確認済み・未ログイン」なのか区別できず、応答が届く前に
   * admin を `/login` へ誤誘導しかねないため（fe-plan.md §2-B）。
   *
   * **保護対象コンテンツの一瞬のフラッシュは許容する。** `authChecked` が `false` の間、
   * 下記 return 内の画面切り替えは `route.kind` だけで描画するため、`/input` を直接開いた
   * guest/user には応答が届くまで一瞬 `<InputPage>` が見える。ただし
   * `InputPage`（`frontend/pages/InputPage.tsx`）はデータ取得をしないフォーム表示のみで、
   * 実データは含まない。「タブを隠すこと・FEリダイレクトは認可ではない」前提のとおり
   * `/input` の実効的な保護は BE 側の `requireRole('admin')`（T-091で
   * `POST/DELETE /api/companies` へ配線済み）であり、このフラッシュを消しても
   * 実害（実データ漏えい）は減らない。ローディング表示化（別案）の要否は今後の判断とする。
   */
  useEffect(() => {
    if (!authChecked) return;
    const redirectTo = resolveRouteGuardRedirect(route, user);
    if (redirectTo === null) return;
    navigate(redirectTo);
  }, [authChecked, user, route, navigate]);

  /**
   * 選択中の銘柄は **URL が正**。直リンク・リロード・戻る/進むのどれでも同じ結果になる。
   *
   * 解析直後も POST の戻り値を使わずここで取り直す。情報源を URL 一本に絞るためで、
   * 一度の往復が増えるのは承知のうえ（表示の食い違いのほうが害が大きい）。
   */
  useEffect(() => {
    if (selectedCode === null) {
      setScoring(null);
      return;
    }

    let cancelled = false;
    setLoadingScoring(true);
    api
      .getCompany(selectedCode, useActualForScoring)
      .then((result) => {
        if (!cancelled) setScoring(result);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setScoring(null);
        setError(cause instanceof Error ? cause.message : '取得に失敗しました');
      })
      .finally(() => {
        if (!cancelled) setLoadingScoring(false);
      });

    return () => {
      // 続けて別の銘柄を選んだとき、古い応答で上書きさせない
      cancelled = true;
    };
  }, [selectedCode, useActualForScoring]);

  const handleSubmit = (payload: AnalyzeCompanyRequest) => {
    setBusy(true);
    setError(null);
    api
      .analyzeCompany(payload)
      .then(async () => {
        await reload();
        // 解析直後は既定（予想優先）で表示する。実績を使うかは会社詳細側で選び直す。
        // 検索条件（q/sort/page）は既定へ戻す（新規登録した銘柄が現在の絞り込みに
        // 含まれるとは限らないため、一覧トップから見せる）
        navigate(createListRoute({ selectedCode: payload.code }));
      })
      .catch((cause: unknown) => {
        // 失敗時は入力画面に留まる。遷移すると入力内容が失われる
        setError(cause instanceof Error ? cause.message : '解析に失敗しました');
      })
      .finally(() => {
        setBusy(false);
      });
  };

  const handleSelect = (code: string) => {
    setError(null);
    // 銘柄を切り替えたら実績優先の指定は false に戻す（`payout-ratio-scoring.md` §7 決定5。
    // 「リクエスト単位の一時指定」であり、別銘柄に持ち越さない）。検索条件は維持する
    navigate(createListRoute({ selectedCode: code, q, sort, page }));
  };

  /**
   * ダイアログを閉じる（✕ / 背景クリック / Escape）。`?code=` と `?metric=` の
   * 両方を外す（`docs/adr/0014-analysis-dialog-url-state.md` §決定4）。`handleDelete`
   * 内の削除後処理（同じく selectedCode を外す navigate）と同型
   */
  const handleCloseDialog = useCallback(() => {
    navigate(createListRoute({ q, sort, page }));
  }, [navigate, q, sort, page]);

  /** 指標行クリック。`?metric=<key>` を付ける（`code` はそのまま維持） */
  const handleOpenMetric = useCallback(
    (metric: string) => {
      if (selectedCode === null) return;
      navigate(createListRoute({ selectedCode, metric, useActualForScoring, q, sort, page }));
    },
    [navigate, selectedCode, useActualForScoring, q, sort, page],
  );

  /** 「← 指標一覧へ戻る」。`?metric=` だけを外す（`code` は残す。ADR-0014 §決定4） */
  const handleBackToOverview = useCallback(() => {
    if (selectedCode === null) return;
    navigate(createListRoute({ selectedCode, metric: null, useActualForScoring, q, sort, page }));
  }, [navigate, selectedCode, useActualForScoring, q, sort, page]);

  /**
   * `dialogHandlers` オブジェクトを `useMemo` 化する（CR-7是正）。インラインで毎レンダー
   * 新しいオブジェクト・関数を生成すると、`ListPage`/`Dialog` 側の `useEffect` 依存配列に
   * 渡ったときに毎回再実行されうる（`Dialog.tsx` の `open`/`onClose` を監視する useEffect 等）。
   * `handleCloseDialog`/`handleOpenMetric`/`handleBackToOverview` を先に `useCallback` で
   * 参照安定化したうえで、それらをまとめる本オブジェクトも `useMemo` で安定化する
   */
  const dialogHandlers = useMemo(
    () => ({
      onClose: handleCloseDialog,
      onOpenMetric: handleOpenMetric,
      onBackToOverview: handleBackToOverview,
    }),
    [handleCloseDialog, handleOpenMetric, handleBackToOverview],
  );

  const handleToggleUseActualForScoring = (checked: boolean) => {
    if (selectedCode === null) return;
    navigate(createListRoute({ selectedCode, useActualForScoring: checked, q, sort, page }));
  };

  const handleDelete = (code: string) => {
    setError(null);
    api
      .deleteCompany(code)
      .then(async () => {
        await reload();
        // 表示中の銘柄を消したら選択を解除する。無い銘柄を URL に残さない。検索条件は維持する
        if (code === selectedCode) {
          navigate(createListRoute({ q, sort, page }));
        }
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : '削除に失敗しました');
      });
  };

  /**
   * 検索ボックスのデバウンス確定時に呼ばれる（`ListPage.tsx` 側でデバウンスを持つ）。
   * `q` を変えたら `page` を1に戻す（`search-page.md` §2）。履歴を汚さないよう
   * `replace: true`（`use-route.ts`）
   */
  const handleSearchChange = useCallback(
    (nextQ: string) => {
      navigate(createListRoute({ selectedCode, useActualForScoring, q: nextQ, sort, page: 1 }), {
        replace: true,
      });
    },
    [navigate, selectedCode, useActualForScoring, sort],
  );

  /** ソート変更も `page` を1に戻す（`search-page.md` §2） */
  const handleSortChange = (nextSort: CompanySortKey) => {
    navigate(createListRoute({ selectedCode, useActualForScoring, q, sort: nextSort, page: 1 }));
  };

  const handlePageChange = (nextPage: number) => {
    navigate(createListRoute({ selectedCode, useActualForScoring, q, sort, page: nextPage }));
  };

  /**
   * ログイン/サインアップ成功後の遷移先は `redirect`（生の相対パス文字列）を
   * `parseRoute` に通してから `navigate` へ渡す。`/portfolio` 等の未実装画面への
   * `redirect` が来ても `parseRoute` の「未知のパスは一覧へ倒す」safe fallback がそのまま働く
   * （`fe-plan.md` §2.2）。
   */
  const handleLogin = (payload: LoginRequest, redirect: string) => {
    setAuthBusy(true);
    setAuthError(null);
    api
      .login(payload)
      .then((result) => {
        setUser(result.user);
        navigate(parseRoute(redirect));
      })
      .catch((cause: unknown) => {
        setAuthError(cause instanceof Error ? cause.message : 'ログインできませんでした');
      })
      .finally(() => {
        setAuthBusy(false);
      });
  };

  const handleSignup = (payload: SignupRequest, redirect: string) => {
    setAuthBusy(true);
    setAuthError(null);
    api
      .signup(payload)
      .then((result) => {
        setUser(result.user);
        navigate(parseRoute(redirect));
      })
      .catch((cause: unknown) => {
        setAuthError(cause instanceof Error ? cause.message : '登録できませんでした');
      })
      .finally(() => {
        setAuthBusy(false);
      });
  };

  const handleLogout = () => {
    setError(null);
    api
      .logout()
      .then(() => {
        setUser(null);
        // screen-list.md §5.1: ログアウト後は `/` へ
        navigate(createListRoute());
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : 'ログアウトに失敗しました');
      });
  };

  return (
    <main>
      <header className="app-header">
        <h1>高配当銘柄スコアリング</h1>
        <AuthStatus
          user={user}
          currentPath={routeToPath(route)}
          onNavigate={navigate}
          onLogout={handleLogout}
        />
      </header>
      <NavBar current={route} user={user} onNavigate={navigate} />

      {error !== null && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {route.kind === 'input' ? (
        <InputPage onSubmit={handleSubmit} disabled={busy} />
      ) : route.kind === 'login' || route.kind === 'signup' ? (
        <AuthPage
          mode={route.kind}
          redirect={route.redirect}
          busy={authBusy}
          error={authError}
          onNavigate={navigate}
          onLogin={handleLogin}
          onSignup={handleSignup}
        />
      ) : (
        <ListPage
          companies={companies.companies}
          selected={{ code: selectedCode, scoring, loading: loadingScoring }}
          payoutRatioSourceControl={{
            checked: useActualForScoring,
            onToggle: handleToggleUseActualForScoring,
          }}
          searchControl={{
            q,
            sort,
            page,
            perPage: companies.perPage,
            total: companies.total,
            loading: loadingCompanies,
            onSearchChange: handleSearchChange,
            onSortChange: handleSortChange,
            onPageChange: handlePageChange,
            showRegisterCta: isAdmin(user),
            onNavigateToInput: () => {
              navigate({ kind: 'input' });
            },
          }}
          rowActions={{ onSelect: handleSelect, onDelete: handleDelete }}
          activeMetricParam={route.kind === 'list' ? route.metric : null}
          dialogHandlers={dialogHandlers}
        />
      )}

      <footer>
        <small>
          本アプリケーションは株式情報の分析・可視化を目的としたものであり、投資助言・投資勧誘を
          行うものではありません。投資判断はご自身の責任で行ってください。
        </small>
      </footer>
    </main>
  );
}
