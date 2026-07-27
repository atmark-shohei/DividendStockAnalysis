import { useCallback, useEffect, useState } from 'react';

import type { CompanySummary } from '@/domain/company/company-repository';

import type { AnalyzeCompanyRequest, ScoringResponse } from './api';
import * as api from './api';
import { CompanyForm } from './components/CompanyForm';
import { MetricTable } from './components/MetricTable';
import { ScoreRadar } from './components/ScoreRadar';
import { dividendSourceText, formatFetchedAt } from './format';

/**
 * 画面全体。**データ取得はここに集約**し、表示コンポーネントへは props で渡す
 * （`.claude/rules/frontend.md`）。
 */
export function App() {
  const [scoring, setScoring] = useState<ScoringResponse | null>(null);
  const [companies, setCompanies] = useState<readonly CompanySummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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

  const handleSubmit = (payload: AnalyzeCompanyRequest) => {
    setBusy(true);
    setError(null);
    api
      .analyzeCompany(payload)
      .then(async (result) => {
        setScoring(result);
        await reload();
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : '解析に失敗しました');
      })
      .finally(() => {
        setBusy(false);
      });
  };

  const handleOpen = (code: string) => {
    setError(null);
    api
      .getCompany(code)
      .then(setScoring)
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : '取得に失敗しました');
      });
  };

  const handleDelete = (code: string) => {
    setError(null);
    api
      .deleteCompany(code)
      .then(reload)
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : '削除に失敗しました');
      });
  };

  return (
    <main>
      <h1>高配当銘柄スコアリング</h1>

      {error !== null && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <section>
        <h2>データ入力</h2>
        <CompanyForm onSubmit={handleSubmit} disabled={busy} />
      </section>

      {scoring !== null && (
        <section>
          <h2>解析結果</h2>
          <p className="total">
            総合点 <strong>{scoring.totalScore}</strong> / {scoring.maxTotalScore} 点
            {/* 有効指標数の併記は §0.5 の必須要件。80/100 の誤読を防ぐ */}
            <span className="effective">
              （有効 {scoring.effectiveMetricCount}/{scoring.totalMetricCount} 指標）
            </span>
          </p>
          <p className="meta">
            採用した配当: {dividendSourceText(scoring.dividendSource)} ／ 入力日時:{' '}
            {formatFetchedAt(scoring.fetchedAt)}
          </p>
          <ScoreRadar metrics={scoring.metrics} />
          <MetricTable metrics={scoring.metrics} />
        </section>
      )}

      <section>
        <h2>保存済み銘柄</h2>
        {companies.length === 0 ? (
          <p>保存された銘柄はありません。</p>
        ) : (
          <table className="metric-table">
            <caption>保存済み銘柄の一覧</caption>
            <thead>
              <tr>
                <th scope="col">コード</th>
                <th scope="col">銘柄名</th>
                <th scope="col">総合点</th>
                <th scope="col">有効指標</th>
                <th scope="col">入力日時</th>
                <th scope="col">操作</th>
              </tr>
            </thead>
            <tbody>
              {companies.map((company) => (
                <tr key={company.code}>
                  <td>{company.code}</td>
                  <th scope="row">{company.name}</th>
                  <td className="numeric">
                    {company.totalScore} / {company.maxTotalScore} 点
                  </td>
                  <td className="numeric">
                    {company.effectiveMetricCount} / {company.totalMetricCount}
                  </td>
                  <td>{formatFetchedAt(company.fetchedAt)}</td>
                  <td>
                    <button type="button" onClick={() => handleOpen(company.code)}>
                      表示
                    </button>
                    <button type="button" onClick={() => handleDelete(company.code)}>
                      削除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <footer>
        <small>
          本アプリケーションは株式情報の分析・可視化を目的としたものであり、投資助言・投資勧誘を
          行うものではありません。投資判断はご自身の責任で行ってください。
        </small>
      </footer>
    </main>
  );
}
