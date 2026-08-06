import { useCallback, useEffect, useState } from 'react';

import type { CompanySummary } from '@/domain/company/company-repository';

import type { AnalyzeCompanyRequest, ScoringResponse } from './api';
import * as api from './api';
import { NavBar } from './components/NavBar';
import { InputPage } from './pages/InputPage';
import { ListPage } from './pages/ListPage';
import { useRoute } from './use-route';

/**
 * アプリの外枠。**データ取得はここに集約**し、各画面へは props で渡す
 * （`.claude/rules/frontend.md`）。画面自体は `pages/` にある。
 *
 * 「データ入力」と「保存済み銘柄」は別 URL の別画面。どちらを出すかは URL が決める。
 */
export function App() {
  const [route, navigate] = useRoute();
  const [scoring, setScoring] = useState<ScoringResponse | null>(null);
  const [companies, setCompanies] = useState<readonly CompanySummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadingScoring, setLoadingScoring] = useState(false);

  const selectedCode = route.kind === 'list' ? route.selectedCode : null;
  // ③ 予想配当性向の採点に実績を使うか。URL が正（`.claude/rules/frontend.md`
  // 「選択中の銘柄コードは URL に置く」と同じ扱い。Manager決定、2026-08-06）
  const useActualForScoring = route.kind === 'list' ? route.useActualForScoring : false;

  const reload = useCallback(async () => {
    try {
      setCompanies(await api.listCompanies());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '一覧の取得に失敗しました');
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

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
        // 解析直後は既定（予想優先）で表示する。実績を使うかは会社詳細側で選び直す
        navigate({ kind: 'list', selectedCode: payload.code, useActualForScoring: false });
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
    // 「リクエスト単位の一時指定」であり、別銘柄に持ち越さない）
    navigate({ kind: 'list', selectedCode: code, useActualForScoring: false });
  };

  const handleToggleUseActualForScoring = (checked: boolean) => {
    if (selectedCode === null) return;
    navigate({ kind: 'list', selectedCode, useActualForScoring: checked });
  };

  const handleDelete = (code: string) => {
    setError(null);
    api
      .deleteCompany(code)
      .then(async () => {
        await reload();
        // 表示中の銘柄を消したら選択を解除する。無い銘柄を URL に残さない
        if (code === selectedCode) {
          navigate({ kind: 'list', selectedCode: null, useActualForScoring: false });
        }
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : '削除に失敗しました');
      });
  };

  return (
    <main>
      <h1>高配当銘柄スコアリング</h1>
      <NavBar current={route} onNavigate={navigate} />

      {error !== null && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {route.kind === 'input' ? (
        <InputPage onSubmit={handleSubmit} disabled={busy} />
      ) : (
        <ListPage
          companies={companies}
          selected={{ code: selectedCode, scoring, loading: loadingScoring }}
          payoutRatioSourceControl={{
            checked: useActualForScoring,
            onToggle: handleToggleUseActualForScoring,
          }}
          onSelect={handleSelect}
          onDelete={handleDelete}
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
