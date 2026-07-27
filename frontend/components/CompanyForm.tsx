import { useState } from 'react';

import type { AnalyzeCompanyRequest } from '../api';

/**
 * 銘柄データの入力フォーム。
 *
 * `.claude/rules/frontend.md`:
 * - 数値入力は範囲検証する
 * - 全角数字は半角に正規化する（日本語環境では日常的に混入する）
 * - 銘柄コードは形式検証してから API に渡す
 */

const FULLWIDTH_OFFSET = 0xfee0;

/** 全角英数記号を半角へ。IME のマイナス記号（U+2212）も直す */
function toHalfWidth(raw: string): string {
  return raw
    .replace(/[！-～]/g, (char) => String.fromCharCode(char.charCodeAt(0) - FULLWIDTH_OFFSET))
    .replace(/−/g, '-')
    .replace(/　/g, ' ')
    .trim();
}

/** 円の入力を銭へ。空欄は `null`（0 ではない）。読めなければ `undefined` */
function yenToSen(raw: string): number | null | undefined {
  const normalized = toHalfWidth(raw).replace(/,/g, '');
  if (normalized === '') return null;
  if (!/^-?\d+(\.\d{1,2})?$/.test(normalized)) return undefined;
  const sen = Math.round(Number(normalized) * 100);
  return Number.isSafeInteger(sen) ? sen : undefined;
}

/** %・倍の入力。空欄は `null` */
function toRatio(raw: string): number | null | undefined {
  const normalized = toHalfWidth(raw);
  if (normalized === '') return null;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : undefined;
}

interface YearRow {
  readonly fiscalYear: string;
  readonly isForecast: boolean;
  readonly epsYen: string;
  readonly roePercent: string;
  readonly revenueYen: string;
  readonly operatingMarginPercent: string;
  readonly dividendYen: string;
}

function emptyRow(fiscalYear: number, isForecast = false): YearRow {
  return {
    fiscalYear: String(fiscalYear),
    isForecast,
    epsYen: '',
    roePercent: '',
    revenueYen: '',
    operatingMarginPercent: '',
    dividendYen: '',
  };
}

const THIS_YEAR = new Date().getFullYear();
/** ①⑦ が5年前を見るので6行、④ は6年分が要る。既定でその年数を出す */
const DEFAULT_ROWS = 6;

export function CompanyForm({
  onSubmit,
  disabled,
}: {
  readonly onSubmit: (payload: AnalyzeCompanyRequest) => void;
  readonly disabled: boolean;
}) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [priceYen, setPriceYen] = useState('');
  const [per, setPer] = useState('');
  const [pbr, setPbr] = useState('');
  const [currentAssetsYen, setCurrentAssetsYen] = useState('');
  const [investmentSecuritiesYen, setInvestmentSecuritiesYen] = useState('');
  const [totalLiabilitiesYen, setTotalLiabilitiesYen] = useState('');
  const [previousDividendTotalYen, setPreviousDividendTotalYen] = useState('');
  const [rows, setRows] = useState<readonly YearRow[]>(() => [
    emptyRow(THIS_YEAR + 1, true),
    ...Array.from({ length: DEFAULT_ROWS }, (_, index) => emptyRow(THIS_YEAR - index)),
  ]);
  const [error, setError] = useState<string | null>(null);

  const updateRow = (index: number, patch: Partial<YearRow>) => {
    setRows((previous) =>
      previous.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)),
    );
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    const normalizedCode = toHalfWidth(code).toUpperCase();
    if (!/^\d{4}[0-9A-Z]?$/.test(normalizedCode)) {
      setError('銘柄コードは4桁の数字（一部英字を含む）で入力してください');
      return;
    }
    if (name.trim() === '') {
      setError('銘柄名を入力してください');
      return;
    }

    const priceSen = yenToSen(priceYen);
    if (priceSen === undefined) {
      setError('株価は数値で入力してください（小数第2位まで）');
      return;
    }
    if (priceSen !== null && (priceSen < 0 || priceSen > 100_000_000)) {
      setError('株価は 0 円以上 1,000,000 円以下で入力してください');
      return;
    }

    const records: AnalyzeCompanyRequest['records'] = [];
    const dividends: AnalyzeCompanyRequest['dividends'] = [];

    for (const row of rows) {
      const fiscalYear = Number(toHalfWidth(row.fiscalYear));
      if (!Number.isInteger(fiscalYear) || fiscalYear < 1900 || fiscalYear > 2200) {
        setError(`決算年度が不正です: ${row.fiscalYear}`);
        return;
      }

      const epsSen = yenToSen(row.epsYen);
      const revenueSen = yenToSen(row.revenueYen);
      const dividendPerShareSen = yenToSen(row.dividendYen);
      const roePercent = toRatio(row.roePercent);
      const operatingMarginPercent = toRatio(row.operatingMarginPercent);

      if (
        epsSen === undefined ||
        revenueSen === undefined ||
        dividendPerShareSen === undefined ||
        roePercent === undefined ||
        operatingMarginPercent === undefined
      ) {
        setError(`${String(fiscalYear)} 年度の入力に数値として読めない項目があります`);
        return;
      }

      records.push({
        fiscalYear,
        isForecast: row.isForecast,
        epsSen,
        roePercent,
        revenueSen,
        operatingMarginPercent,
        dividendPerShareSen,
      });
      dividends.push({
        fiscalYear,
        kind: row.isForecast ? 'forecast' : 'actual',
        annualAmountSen: dividendPerShareSen,
      });
    }

    const balance = {
      currentAssetsSen: yenToSen(currentAssetsYen),
      investmentSecuritiesSen: yenToSen(investmentSecuritiesYen),
      totalLiabilitiesSen: yenToSen(totalLiabilitiesYen),
      previousDividendTotalSen: yenToSen(previousDividendTotalYen),
    };
    if (Object.values(balance).some((value) => value === undefined)) {
      setError('貸借対照表の項目は数値で入力してください');
      return;
    }

    const multiples = { per: toRatio(per), pbr: toRatio(pbr) };
    if (multiples.per === undefined || multiples.pbr === undefined) {
      setError('PER / PBR は数値で入力してください');
      return;
    }

    onSubmit({
      code: normalizedCode,
      name: name.trim(),
      records,
      dividends,
      balanceSheet: balance as AnalyzeCompanyRequest['balanceSheet'],
      multiples: multiples as AnalyzeCompanyRequest['multiples'],
      priceSen,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="company-form">
      <fieldset>
        <legend>銘柄</legend>
        <label>
          銘柄コード
          <input value={code} onChange={(event) => setCode(event.target.value)} required />
        </label>
        <label>
          銘柄名
          <input value={name} onChange={(event) => setName(event.target.value)} required />
        </label>
        <label>
          現在株価（円）
          <input
            value={priceYen}
            onChange={(event) => setPriceYen(event.target.value)}
            inputMode="decimal"
            placeholder="例: 1234.50"
          />
        </label>
      </fieldset>

      <fieldset>
        <legend>市場指標・貸借対照表（⑥⑨ で使用）</legend>
        <label>
          PER（倍）
          <input value={per} onChange={(event) => setPer(event.target.value)} inputMode="decimal" />
        </label>
        <label>
          PBR（倍）
          <input value={pbr} onChange={(event) => setPbr(event.target.value)} inputMode="decimal" />
        </label>
        <label>
          流動資産（円）
          <input
            value={currentAssetsYen}
            onChange={(event) => setCurrentAssetsYen(event.target.value)}
            inputMode="decimal"
          />
        </label>
        <label>
          投資有価証券（円）
          <input
            value={investmentSecuritiesYen}
            onChange={(event) => setInvestmentSecuritiesYen(event.target.value)}
            inputMode="decimal"
          />
        </label>
        <label>
          負債総額（円）
          <input
            value={totalLiabilitiesYen}
            onChange={(event) => setTotalLiabilitiesYen(event.target.value)}
            inputMode="decimal"
          />
        </label>
        <label>
          前期末の配当総額（円）
          <input
            value={previousDividendTotalYen}
            onChange={(event) => setPreviousDividendTotalYen(event.target.value)}
            inputMode="decimal"
          />
        </label>
      </fieldset>

      <fieldset>
        <legend>年度別データ（空欄は「データなし」として扱います。0 とは区別されます）</legend>
        <table className="input-table">
          <thead>
            <tr>
              <th scope="col">年度</th>
              <th scope="col">区分</th>
              <th scope="col">EPS（円）</th>
              <th scope="col">ROE（%）</th>
              <th scope="col">売上高（円）</th>
              <th scope="col">営業利益率（%）</th>
              <th scope="col">1株配当（円）</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={`${row.fiscalYear}-${String(row.isForecast)}-${String(index)}`}>
                <td>
                  <input
                    value={row.fiscalYear}
                    onChange={(event) => updateRow(index, { fiscalYear: event.target.value })}
                    inputMode="numeric"
                    aria-label="決算年度"
                  />
                </td>
                <td>
                  <label className="inline">
                    <input
                      type="checkbox"
                      checked={row.isForecast}
                      onChange={(event) => updateRow(index, { isForecast: event.target.checked })}
                    />
                    予想
                  </label>
                </td>
                <td>
                  <input
                    value={row.epsYen}
                    onChange={(event) => updateRow(index, { epsYen: event.target.value })}
                    inputMode="decimal"
                    aria-label="EPS"
                  />
                </td>
                <td>
                  <input
                    value={row.roePercent}
                    onChange={(event) => updateRow(index, { roePercent: event.target.value })}
                    inputMode="decimal"
                    aria-label="ROE"
                  />
                </td>
                <td>
                  <input
                    value={row.revenueYen}
                    onChange={(event) => updateRow(index, { revenueYen: event.target.value })}
                    inputMode="decimal"
                    aria-label="売上高"
                  />
                </td>
                <td>
                  <input
                    value={row.operatingMarginPercent}
                    onChange={(event) =>
                      updateRow(index, { operatingMarginPercent: event.target.value })
                    }
                    inputMode="decimal"
                    aria-label="営業利益率"
                  />
                </td>
                <td>
                  <input
                    value={row.dividendYen}
                    onChange={(event) => updateRow(index, { dividendYen: event.target.value })}
                    inputMode="decimal"
                    aria-label="1株配当"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <button
          type="button"
          onClick={() =>
            setRows((previous) => [...previous, emptyRow(THIS_YEAR - previous.length)])
          }
        >
          年度を追加
        </button>
      </fieldset>

      {error !== null && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <button type="submit" disabled={disabled}>
        {disabled ? '解析中…' : '解析して保存'}
      </button>
    </form>
  );
}
