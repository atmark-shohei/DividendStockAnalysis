import { useCallback, useEffect, useMemo, useState } from 'react';

import type {
  AddHoldingRequest,
  AnalyzeCompanyRequest,
  AuthUser,
  CompanyListResponse,
  DividendHistoryResponse,
  HoldingView,
  IndicatorSettingsRequest,
  IndicatorSettingsResponse,
  LoginRequest,
  PortfolioDetailResponse,
  PortfolioListResponse,
  ScoringBandsResponse,
  ScoringResponse,
  SignupRequest,
  UpdateHoldingRequest,
} from './api';
import * as api from './api';
import { AuthStatus } from './components/AuthStatus';
import { NavBar } from './components/NavBar';
import { AuthPage } from './pages/AuthPage';
import { CriteriaPage } from './pages/CriteriaPage';
import { IndicatorCustomPage } from './pages/IndicatorCustomPage';
import { InputPage } from './pages/InputPage';
import { ListPage } from './pages/ListPage';
import { PortfolioPage } from './pages/PortfolioPage';
import { resolveActivePortfolioId } from './pages/portfolio-page-logic';
import {
  createListRoute,
  createPortfolioRoute,
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
 * ログイン中ユーザーの比較キー。`user` オブジェクト全体ではなく `id` だけを使う
 * （`getCurrentUser` の再取得等で同じユーザーの新しいオブジェクト参照が来ても
 * 誤って「切り替わった」と判定しないため）。`null` は未ログイン（guest）。
 *
 * fe-reviewer CR-1: ユーザー個別の永続設定（`indicatorSettings`）をリセットすべきタイミングの
 * 判定に使う。純関数として export し、`tests/frontend/app.test.ts` から直接検証する
 * （`App` は JSX を含み `@testing-library/react` 未導入のため描画検証はできない。
 * `indicator-custom-logic.ts` と同じ「判定はexportした純関数に切り出す」方針）。
 */
export function authIdentityKey(user: AuthUser | null): number | null {
  return user === null ? null : user.id;
}

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
  // ①増配率（5年CAGR）の指標詳細（線グラフ）用。`?metric=dividendGrowthRate` のときだけ
  // 追加取得する（`analysis-dialog.md` §7。T-097）
  const [dividendHistory, setDividendHistory] = useState<DividendHistoryResponse | null>(null);
  const [loadingDividendHistory, setLoadingDividendHistory] = useState(false);
  // 評価基準タブ（T-099）。会社非依存の静的データなので、セッション中1回だけ取得しキャッシュする
  const [criteriaBands, setCriteriaBands] = useState<ScoringBandsResponse | null>(null);
  const [loadingCriteria, setLoadingCriteria] = useState(false);
  // 指標カスタマイズ画面（T-101）。`criteriaBands` はラベル・単位・並び順の出所として共用する
  // （`indicators` 表示時にも `criteriaBands === null` なら取得する。新しいAPI呼び出しを増やさない）
  const [indicatorSettings, setIndicatorSettings] = useState<IndicatorSettingsResponse | null>(
    null,
  );
  const [loadingIndicatorSettings, setLoadingIndicatorSettings] = useState(false);
  const [savingIndicatorSettings, setSavingIndicatorSettings] = useState(false);
  const [indicatorSettingsError, setIndicatorSettingsError] = useState<string | null>(null);
  // ポートフォリオ画面（T-103）。`null` は「未取得」（`indicatorSettings` と同じ設計。
  // 保有0件・ポートフォリオ0件の空配列と区別するため、初期値は空配列ではなく null にする）
  const [portfolios, setPortfolios] = useState<PortfolioListResponse | null>(null);
  const [loadingPortfolios, setLoadingPortfolios] = useState(false);
  const [portfolioDetail, setPortfolioDetail] = useState<PortfolioDetailResponse | null>(null);
  const [loadingPortfolioDetail, setLoadingPortfolioDetail] = useState(false);
  const [savingHolding, setSavingHolding] = useState(false);
  const [savingPortfolio, setSavingPortfolio] = useState(false);
  const [isAddPortfolioOpen, setIsAddPortfolioOpen] = useState(false);
  const [isAddHoldingOpen, setIsAddHoldingOpen] = useState(false);
  const [addPortfolioError, setAddPortfolioError] = useState<string | null>(null);
  const [addHoldingError, setAddHoldingError] = useState<string | null>(null);
  // 保有銘柄の編集ダイアログ（CR-3）。`null` = 閉。編集対象1件を保持する
  // （`indicatorSettings` 等と同じ「取得済みデータをそのまま保持」ではなく、
  // `portfolioDetail.holdings` から都度検索した1件のスナップショットを持つ）
  const [editingHolding, setEditingHolding] = useState<HoldingView | null>(null);
  // 保有銘柄の編集・削除、ポートフォリオ削除に共通のエラー表示（CR-3。
  // 追加系の `addHoldingError`/`addPortfolioError` とは別枠にする）
  const [holdingActionError, setHoldingActionError] = useState<string | null>(null);
  const [deletingPortfolio, setDeletingPortfolio] = useState(false);
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

  // 解析ダイアログ（`AnalysisDialogBody`）は `/`（list）と `/portfolio`（portfolio）で共通
  // （ADR-0014）。選択中コード・指標詳細キーは両ルートから取り出す
  const selectedCode =
    route.kind === 'list' || route.kind === 'portfolio' ? route.selectedCode : null;
  // ③ 予想配当性向の採点に実績を使うか。URL が正（`.claude/rules/frontend.md`
  // 「選択中の銘柄コードは URL に置く」と同じ扱い。Manager決定、2026-08-06）。
  // **`portfolio` route には `useActualForScoring` フィールドが無い**
  // （`routes.ts` の `Route` 型定義。`portfolio-page.md` §2 の URL状態表が
  // `portfolio`/`code`/`metric` のみを規定しているため）。ポートフォリオ画面から開いた
  // 解析ダイアログでは常に既定（予想優先）表示になり、トグルは永続化されない
  // （`handleToggleUseActualForScoring` 参照。TODO・推測: 設計書に明記が無いための実装判断）
  const useActualForScoring = route.kind === 'list' ? route.useActualForScoring : false;
  // 検索・ソート・ページも URL が正（`screen-list.md` §3.1）
  const q = route.kind === 'list' ? route.q : '';
  const sort: CompanySortKey = route.kind === 'list' ? route.sort : 'created_desc';
  const page = route.kind === 'list' ? route.page : 1;
  const activeMetricParam =
    route.kind === 'list' || route.kind === 'portfolio' ? route.metric : null;
  // ①増配率（5年CAGR。`analysis-dialog.md` §5.1）・②連続非減配年数（同 §5.2）のいずれかの
  // 指標詳細を開いているか。①②は同じ `GET /api/companies/:code/dividends` を共用する（T-098）。
  // `route.metric` は形式チェック済みだが実在未検証の生値（`resolveActiveMetric` が
  // 実在検証を担う）。ここでは「取得すべきか」の判定だけなので生値の突き合わせで十分
  const isDividendHistoryMetricOpen =
    activeMetricParam === 'dividendGrowthRate' || activeMetricParam === 'consecutiveYears';
  // ポートフォリオ画面（T-103）。既定は「ユーザーの先頭ポートフォリオ」（portfolio-page.md §2）
  const activePortfolioId =
    route.kind === 'portfolio'
      ? resolveActivePortfolioId(route.portfolioId, portfolios?.portfolios ?? [])
      : null;

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

  /**
   * ①増配率（5年CAGR）の線グラフ（T-097）・②連続非減配年数の年次リスト（T-098）が
   * 共用するデータ取得（fe-plan.md §3-1）。`?metric=dividendGrowthRate` または
   * `?metric=consecutiveYears` を開いたときだけ取得する（概要のペイロードを重くしない。
   * `analysis-dialog.md` §7）。
   *
   * 概要モードへ戻る・他の指標を開く・銘柄を切り替えたときは**都度クリアする**
   * （キャッシュを持たない。`scoring` の既存挙動と一貫させ、状態を単純に保つ判断。
   * fe-plan.md §3-1）。
   */
  useEffect(() => {
    if (selectedCode === null || !isDividendHistoryMetricOpen) {
      setDividendHistory(null);
      return;
    }

    let cancelled = false;
    setLoadingDividendHistory(true);
    api
      .getCompanyDividends(selectedCode)
      .then((result) => {
        if (!cancelled) setDividendHistory(result);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setDividendHistory(null);
        setError(cause instanceof Error ? cause.message : '配当推移の取得に失敗しました');
      })
      .finally(() => {
        if (!cancelled) setLoadingDividendHistory(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedCode, isDividendHistoryMetricOpen]);

  /**
   * 評価基準タブ（T-099）。会社非依存の静的データなので、`/criteria` を開いたときだけ
   * 一度取得し、以後はキャッシュを使い回す（`criteriaBands !== null` で再取得をスキップ。
   * 一覧の `reload()` のように毎回取り直す必要が無い。fe-plan.md §3.8）。
   *
   * 指標カスタマイズ画面（T-101）もラベル・単位・並び順の出所として同じ `criteriaBands` を
   * 共用する（fe-plan.md §5。新しいAPI呼び出しを増やさない）。
   */
  useEffect(() => {
    if ((route.kind !== 'criteria' && route.kind !== 'indicators') || criteriaBands !== null)
      return;

    let cancelled = false;
    setLoadingCriteria(true);
    api
      .getScoringBands()
      .then((result) => {
        if (!cancelled) setCriteriaBands(result);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setError(cause instanceof Error ? cause.message : '評価基準の取得に失敗しました');
      })
      .finally(() => {
        if (!cancelled) setLoadingCriteria(false);
      });

    return () => {
      // 別画面へ素早く遷移した場合、古い応答で state を上書きさせない（CR-3。
      // `dividendHistory` 取得 useEffect と同じキャンセルガードパターン）
      cancelled = true;
    };
  }, [route.kind, criteriaBands]);

  /**
   * fe-reviewer CR-1: ログイン/ログアウトで別ユーザーに切り替わったら、前ユーザーの
   * 指標設定キャッシュを破棄する。下の取得 useEffect は `indicatorSettings !== null` を
   * キャッシュガードに使っているため、これをリセットしないと、フルリロード無しで
   * 別ユーザーに切り替えた場合に前ユーザーの選択・基準値が再取得されずそのまま表示され、
   * 気付かず保存すると別ユーザーの設定を上書きしてしまう。
   *
   * 依存配列は `authIdentityKey(user)`（`user.id`、guestは`null`）にする。`user` オブジェクト
   * 全体を依存にすると `getCurrentUser` の再取得等で同一ユーザーでも参照が変わり無駄に
   * 発火しうるため、比較キーだけを見る。
   */
  useEffect(() => {
    setIndicatorSettings(null);
    setIndicatorSettingsError(null);
  }, [authIdentityKey(user)]);

  /**
   * ポートフォリオ画面（T-103）。ログイン/ログアウトで別ユーザーに切り替わったら、
   * 前ユーザーの一覧・詳細キャッシュを破棄する（`indicatorSettings` と同じ CR-1 対策）。
   */
  useEffect(() => {
    setPortfolios(null);
    setPortfolioDetail(null);
  }, [authIdentityKey(user)]);

  /**
   * ポートフォリオ一覧（T-103）。`/portfolio` を開いたときだけ一度取得し、以後は
   * キャッシュを使い回す（`criteriaBands`/`indicatorSettings` と同じ方針）。
   */
  useEffect(() => {
    if (route.kind !== 'portfolio' || portfolios !== null) return;

    let cancelled = false;
    setLoadingPortfolios(true);
    api
      .listPortfolios()
      .then((result) => {
        if (!cancelled) setPortfolios(result);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setError(cause instanceof Error ? cause.message : 'ポートフォリオ一覧の取得に失敗しました');
      })
      .finally(() => {
        if (!cancelled) setLoadingPortfolios(false);
      });

    return () => {
      cancelled = true;
    };
  }, [route.kind, portfolios]);

  /**
   * ポートフォリオの集計・保有銘柄一覧（T-103）。表示中のポートフォリオ（既定は
   * 先頭ポートフォリオ）が変わるたびに取得し直す。集計値はサーバー側で計算済みのものを
   * そのまま使う（`portfolio-page.md` §8。クライアントで再計算しない）。
   */
  useEffect(() => {
    if (activePortfolioId === null) {
      setPortfolioDetail(null);
      return;
    }

    let cancelled = false;
    setLoadingPortfolioDetail(true);
    api
      .getPortfolio(activePortfolioId)
      .then((result) => {
        if (!cancelled) setPortfolioDetail(result);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setPortfolioDetail(null);
        setError(cause instanceof Error ? cause.message : 'ポートフォリオの取得に失敗しました');
      })
      .finally(() => {
        if (!cancelled) setLoadingPortfolioDetail(false);
      });

    return () => {
      cancelled = true;
    };
  }, [activePortfolioId]);

  /**
   * 指標カスタマイズ画面（T-101）。`/indicators` を開いたときだけ現在の設定を取得し、
   * 以後はキャッシュを使い回す（`criteriaBands` と同じ方針）。保存成功時は PUT の応答を
   * そのまま `indicatorSettings` へ上書きするため、ここでの再取得は行わない
   * （fe-plan.md §5「PUTの200応答がそのまま最新の真実になる」）。
   */
  useEffect(() => {
    if (route.kind !== 'indicators' || indicatorSettings !== null) return;

    let cancelled = false;
    setLoadingIndicatorSettings(true);
    api
      .getIndicatorSettings()
      .then((result) => {
        if (!cancelled) setIndicatorSettings(result);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setError(cause instanceof Error ? cause.message : '指標設定の取得に失敗しました');
      })
      .finally(() => {
        if (!cancelled) setLoadingIndicatorSettings(false);
      });

    return () => {
      cancelled = true;
    };
  }, [route.kind, indicatorSettings]);

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
   * 内の削除後処理（同じく selectedCode を外す navigate）と同型。
   *
   * `/portfolio` から開いたダイアログは `/portfolio` へ戻す（ADR-0014「ダイアログは
   * `/` と `/portfolio` で共通」。**現在の画面から離脱させない**）。
   */
  const handleCloseDialog = useCallback(() => {
    if (route.kind === 'portfolio') {
      navigate(createPortfolioRoute({ portfolioId: route.portfolioId }));
      return;
    }
    navigate(createListRoute({ q, sort, page }));
  }, [navigate, route, q, sort, page]);

  /** 指標行クリック。`?metric=<key>` を付ける（`code` はそのまま維持） */
  const handleOpenMetric = useCallback(
    (metric: string) => {
      if (selectedCode === null) return;
      if (route.kind === 'portfolio') {
        navigate(createPortfolioRoute({ portfolioId: route.portfolioId, selectedCode, metric }));
        return;
      }
      navigate(createListRoute({ selectedCode, metric, useActualForScoring, q, sort, page }));
    },
    [navigate, route, selectedCode, useActualForScoring, q, sort, page],
  );

  /** 「← 指標一覧へ戻る」。`?metric=` だけを外す（`code` は残す。ADR-0014 §決定4） */
  const handleBackToOverview = useCallback(() => {
    if (selectedCode === null) return;
    if (route.kind === 'portfolio') {
      navigate(
        createPortfolioRoute({ portfolioId: route.portfolioId, selectedCode, metric: null }),
      );
      return;
    }
    navigate(createListRoute({ selectedCode, metric: null, useActualForScoring, q, sort, page }));
  }, [navigate, route, selectedCode, useActualForScoring, q, sort, page]);

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
    // `/portfolio` から開いたダイアログでは永続化しない（`useActualForScoring` 導出のコメント参照。
    // `Route` の `portfolio` バリアントにこのフィールドが無いため no-op にする）
    if (route.kind === 'portfolio') return;
    navigate(createListRoute({ selectedCode, useActualForScoring: checked, q, sort, page }));
  };

  /** ポートフォリオ切替タブのクリック。`?portfolio=` を更新する（`portfolio-page.md` §3） */
  const handleSelectPortfolio = (id: string) => {
    setError(null);
    navigate(createPortfolioRoute({ portfolioId: id }));
  };

  /** 保有銘柄の行クリック。`?code=` を付けて解析ダイアログを開く（ADR-0014） */
  const handleOpenHolding = (code: string) => {
    setError(null);
    if (route.kind !== 'portfolio') return;
    navigate(createPortfolioRoute({ portfolioId: route.portfolioId, selectedCode: code }));
  };

  const handleOpenAddPortfolio = () => {
    setAddPortfolioError(null);
    setIsAddPortfolioOpen(true);
  };

  const handleCloseAddPortfolio = () => {
    setIsAddPortfolioOpen(false);
  };

  /**
   * 「＋ 作成」の送信。成功したら一覧を取り直し、作成したポートフォリオへ切り替える
   * （`indicatorSettings` の保存と異なり、作成直後にIDが新規発行されるため
   * 一覧の再取得が必要。fe-plan.md §2.7「更新のたびに軽量な一覧APIを叩き直す」）。
   */
  const handleCreatePortfolio = (name: string) => {
    setSavingPortfolio(true);
    setAddPortfolioError(null);
    api
      .createPortfolio({ name })
      .then(async (created) => {
        setIsAddPortfolioOpen(false);
        setPortfolios(await api.listPortfolios());
        navigate(createPortfolioRoute({ portfolioId: created.id }));
      })
      .catch((cause: unknown) => {
        setAddPortfolioError(cause instanceof Error ? cause.message : '作成に失敗しました');
      })
      .finally(() => {
        setSavingPortfolio(false);
      });
  };

  const handleOpenAddHolding = () => {
    setAddHoldingError(null);
    setIsAddHoldingOpen(true);
  };

  const handleCloseAddHolding = () => {
    setIsAddHoldingOpen(false);
  };

  /** 「＋ 銘柄を追加」の送信。成功したら詳細（集計・保有銘柄一覧）を取り直す */
  const handleAddHolding = (payload: AddHoldingRequest) => {
    if (activePortfolioId === null) return;
    setSavingHolding(true);
    setAddHoldingError(null);
    api
      .addHolding(activePortfolioId, payload)
      .then(async () => {
        setIsAddHoldingOpen(false);
        setPortfolioDetail(await api.getPortfolio(activePortfolioId));
      })
      .catch((cause: unknown) => {
        setAddHoldingError(cause instanceof Error ? cause.message : '追加に失敗しました');
      })
      .finally(() => {
        setSavingHolding(false);
      });
  };

  /** 保有銘柄の「編集」ボタン（CR-3）。表示中の詳細から該当行を検索してダイアログを開く */
  const handleOpenEditHolding = (code: string) => {
    setHoldingActionError(null);
    const holding = portfolioDetail?.holdings.find((item) => item.code === code) ?? null;
    setEditingHolding(holding);
  };

  const handleCloseEditHolding = () => {
    setEditingHolding(null);
  };

  /** 編集フォームの送信（CR-3）。成功したら詳細を取り直し、ダイアログを閉じる */
  const handleUpdateHolding = (code: string, payload: UpdateHoldingRequest) => {
    if (activePortfolioId === null) return;
    setSavingHolding(true);
    setHoldingActionError(null);
    api
      .updateHolding(activePortfolioId, code, payload)
      .then(async () => {
        setEditingHolding(null);
        setPortfolioDetail(await api.getPortfolio(activePortfolioId));
      })
      .catch((cause: unknown) => {
        setHoldingActionError(cause instanceof Error ? cause.message : '更新に失敗しました');
      })
      .finally(() => {
        setSavingHolding(false);
      });
  };

  /**
   * 保有銘柄の「削除」ボタン（CR-3）。`window.confirm` はボタン側（`HoldingsTable.tsx`）で
   * 済ませてから呼ばれる。成功したら詳細を取り直す
   */
  const handleRemoveHolding = (code: string) => {
    if (activePortfolioId === null) return;
    setHoldingActionError(null);
    api
      .removeHolding(activePortfolioId, code)
      .then(async () => {
        setPortfolioDetail(await api.getPortfolio(activePortfolioId));
      })
      .catch((cause: unknown) => {
        setHoldingActionError(cause instanceof Error ? cause.message : '削除に失敗しました');
      });
  };

  /**
   * ポートフォリオの「削除」ボタン（CR-3）。`window.confirm` は呼び出し側
   * （`PortfolioPage.tsx`）で済ませてから呼ばれる。成功したら一覧を取り直し、
   * 既定（先頭ポートフォリオ、または0件なら空状態）へ遷移する
   * （`resolveActivePortfolioId` の既存フォールバックに任せる）。
   */
  const handleDeletePortfolio = (id: string) => {
    setDeletingPortfolio(true);
    setHoldingActionError(null);
    api
      .deletePortfolio(id)
      .then(async () => {
        setPortfolios(await api.listPortfolios());
        navigate(createPortfolioRoute());
      })
      .catch((cause: unknown) => {
        setHoldingActionError(cause instanceof Error ? cause.message : '削除に失敗しました');
      })
      .finally(() => {
        setDeletingPortfolio(false);
      });
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
   * `parseRoute` に通してから `navigate` へ渡す。未知のパスへの `redirect` が来ても
   * `parseRoute` の「未知のパスは一覧へ倒す」safe fallback がそのまま働く（`fe-plan.md` §2.2）。
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

  /**
   * 指標カスタマイズ画面（T-101）の保存。成功時はPUTの応答をそのまま `indicatorSettings`
   * へ反映し（再GETは行わない）、失敗時はサーバーの文言をそのまま出す
   * （`AuthForm` の `error` prop と同じ「BEの文言をそのまま出す」方針。fe-plan.md §5）。
   */
  const handleSaveIndicatorSettings = (payload: IndicatorSettingsRequest) => {
    setSavingIndicatorSettings(true);
    setIndicatorSettingsError(null);
    api
      .saveIndicatorSettings(payload)
      .then((result) => {
        setIndicatorSettings(result);
      })
      .catch((cause: unknown) => {
        setIndicatorSettingsError(cause instanceof Error ? cause.message : '保存に失敗しました');
      })
      .finally(() => {
        setSavingIndicatorSettings(false);
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
      ) : route.kind === 'criteria' ? (
        <CriteriaPage bands={criteriaBands} loading={loadingCriteria} />
      ) : route.kind === 'indicators' ? (
        <IndicatorCustomPage
          bands={criteriaBands}
          settings={indicatorSettings}
          loading={loadingCriteria || loadingIndicatorSettings}
          saving={savingIndicatorSettings}
          saveError={indicatorSettingsError}
          onSave={handleSaveIndicatorSettings}
        />
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
      ) : route.kind === 'portfolio' ? (
        <PortfolioPage
          portfolios={{
            items: portfolios?.portfolios ?? [],
            // BE 既定値（`portfolio-api.md` §GET /api/portfolios）と同じ値の意図的な重複
            // （`EMPTY_COMPANY_LIST` の `perPage: 15` と同じ方針。未取得時のみ使う既定値）
            maxPortfolios: portfolios?.maxPortfolios ?? 10,
            loading: loadingPortfolios,
          }}
          activePortfolioId={activePortfolioId}
          detail={{ data: portfolioDetail, loading: loadingPortfolioDetail }}
          actions={{
            onSelectPortfolio: handleSelectPortfolio,
            onCreatePortfolio: handleCreatePortfolio,
            onAddHolding: handleAddHolding,
            onOpenHolding: handleOpenHolding,
            onEditHolding: handleOpenEditHolding,
            onUpdateHolding: handleUpdateHolding,
            onRemoveHolding: handleRemoveHolding,
            onDeletePortfolio: handleDeletePortfolio,
          }}
          addPortfolioDialog={{
            open: isAddPortfolioOpen,
            onOpen: handleOpenAddPortfolio,
            onClose: handleCloseAddPortfolio,
            submitting: savingPortfolio,
            error: addPortfolioError,
          }}
          addHoldingDialog={{
            open: isAddHoldingOpen,
            onOpen: handleOpenAddHolding,
            onClose: handleCloseAddHolding,
            submitting: savingHolding,
            error: addHoldingError,
          }}
          editHoldingDialog={{
            open: editingHolding !== null,
            // 編集は HoldingsTable の行内ボタンから開く（`+`ボタンが無い）ため no-op
            // （`EditHoldingDialogState` の JSDoc 参照）
            onOpen: () => {},
            onClose: handleCloseEditHolding,
            submitting: savingHolding,
            error: holdingActionError,
            holding: editingHolding,
          }}
          deletingPortfolio={deletingPortfolio}
          selected={{ code: selectedCode, scoring, loading: loadingScoring }}
          payoutRatioSourceControl={{
            checked: useActualForScoring,
            onToggle: handleToggleUseActualForScoring,
          }}
          activeMetricParam={activeMetricParam}
          dialogHandlers={dialogHandlers}
          dividendHistory={{ data: dividendHistory, loading: loadingDividendHistory }}
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
          activeMetricParam={activeMetricParam}
          dialogHandlers={dialogHandlers}
          dividendHistory={{ data: dividendHistory, loading: loadingDividendHistory }}
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
