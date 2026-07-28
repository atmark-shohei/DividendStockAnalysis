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
      .getCompany(selectedCode)
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
  }, [selectedCode]);

  const handleSubmit = (payload: AnalyzeCompanyRequest) => {
    setBusy(true);
    setError(null);
    api
      .analyzeCompany(payload)
      .then(async () => {
        await reload();
        navigate({ kind: 'list', selectedCode: payload.code });
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
    navigate({ kind: 'list', selectedCode: code });
  };

  const handleDelete = (code: string) => {
    setError(null);
    api
      .deleteCompany(code)
      .then(async () => {
        await reload();
        // 表示中の銘柄を消したら選択を解除する。無い銘柄を URL に残さない
        if (code === selectedCode) navigate({ kind: 'list', selectedCode: null });
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
