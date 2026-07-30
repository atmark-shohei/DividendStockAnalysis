import { useState } from 'react';

import { type PbrSource, type PerSource } from '@/domain/company/company';
import { deriveMarketMultiples } from '@/domain/company/market-multiples';

import type { AnalyzeCompanyRequest, IrBankImportResponse } from '../api';
import * as api from '../api';
import { multipleSourceText, ratioToEditableText, senToEditableText } from '../format';

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

type ImportedRecord = IrBankImportResponse['records'][number];
/** 1株配当は `records` ではなくこちらから来る（ADR-0009） */
type IrBankDividendView = IrBankImportResponse['dividends'][number];
/** 診断をどのセルの話かに解決したもの。**判定は domain 側**（`import-review.ts` §3.2） */
type CellWarning = IrBankImportResponse['cellWarnings'][number];
type YearRowField = NonNullable<CellWarning['field']>;

/** 行そのものが落ちたことを示す列名（`src/infra/irbank/parse-fy-data.ts` と同じ値） */
const ROW_LEVEL_COLUMNS = new Set(['年度', '備考']);

/** 理由ごとの固定文言（`docs/02_design/logic/import-review.md` §5.2） */
function warningReasonText(reason: CellWarning['reason']): string {
  switch (reason) {
    case 'unparsable-value':
      return '数値として読めない値でした';
    case 'unsafe-integer':
      return '桁が大きすぎて取り込めない金額でした';
    case 'rounded':
      return '小数第3位以下を丸めました';
    case 'suspicious-jump':
      return '前年からの変化が大きすぎます（株式分割の反映漏れの疑い）';
    case 'year-out-of-range':
      return '決算年度として読めないキーでした';
    case 'duplicate-year':
      return '同じ決算年度が重複していました。どちらの値も採用していません';
    case 'unknown-note':
      return '予想と実績のどちらとも判断できない注記が付いていました';
  }
}

/** 元のキーも併記する。3月期以外は年度だけでは原典と突き合わせられない（同 §3.4） */
function yearLabel(warning: CellWarning): string {
  if (warning.fiscalYear === null) return `決算期 ${warning.fiscalYearKey}`;
  return `${String(warning.fiscalYear)}年度（${warning.fiscalYearKey}）`;
}

/**
 * セル警告の文言。**⚠記号と文言を必ず添える。色だけで表現しない**
 * （`.claude/rules/frontend.md`。同 §5.2）。値を採用したかどうかが、
 * 文言を変える唯一の分岐（同 §3.2）。
 */
export function cellWarningText(warning: CellWarning): string {
  const handling = warning.valueKept
    ? '値は採用しています。原典と見比べて確認してください'
    : 'この欄は空欄にしました。必要なら手入力してください';
  return `⚠ ${warningReasonText(warning.reason)}。${handling}`;
}

/** 表の外に出す警告。行ごと落ちたもの・画面に欄が無い列（同 §5.3） */
export function rowlessWarnings(warnings: readonly CellWarning[]): readonly CellWarning[] {
  return warnings.filter((warning) => warning.field === null);
}

/** 行に紐づかない警告の文言。**件数に潰さず、年度と理由を1件ずつ出す**（同 §5.3） */
export function rowlessWarningText(warning: CellWarning): string {
  const reason = warningReasonText(warning.reason);
  if (ROW_LEVEL_COLUMNS.has(warning.column)) {
    return `⚠ ${yearLabel(warning)}の行は取り込めませんでした: ${reason}。必要なら「年度を追加」で手入力してください`;
  }
  // 画面に欄が無い列。営業利益率が空欄なのは元の営業利益が読めなかったからだと伝える（同 §3.2）
  const handling = warning.valueKept ? '値は採用しています' : '取り込めていません';
  return `⚠ ${yearLabel(warning)}の${warning.column}は${handling}: ${reason}`;
}

/** そのセルに出す警告。`aria-invalid` を付けるかもこれで決める（同 §5.2） */
export function warningsForCell(
  warnings: readonly CellWarning[],
  fiscalYear: string,
  field: YearRowField,
): readonly CellWarning[] {
  return warnings.filter(
    (warning) => warning.field === field && String(warning.fiscalYear) === fiscalYear,
  );
}

/**
 * 編集されたセルの警告を落とす。ユーザーが値を直した時点でその警告は用済みになる
 * （同 §5.6）。**再検証はしない**（手入力値の妥当性は取り込みの責務ではない）。
 *
 * `fiscalYear` 欄自体を編集したときは、行の対応年度が変わるので**その行の
 * 警告を全部落とす**（`field` の一致では拾えないため。code-reviewer 指摘、2026-07-30）。
 */
export function dropEditedWarnings(
  warnings: readonly CellWarning[],
  fiscalYear: string,
  patch: Partial<YearRow>,
): readonly CellWarning[] {
  if ('fiscalYear' in patch) {
    return warnings.filter(
      (warning) => warning.field === null || String(warning.fiscalYear) !== fiscalYear,
    );
  }
  const editedFields = new Set(Object.keys(patch));
  return warnings.filter(
    (warning) =>
      warning.field === null ||
      String(warning.fiscalYear) !== fiscalYear ||
      !editedFields.has(warning.field),
  );
}

/**
 * 保存前の確認が要るか（同 §5.6）。`valueKept: true` の警告
 * （`suspicious-jump` / `rounded`）は値を採用したまま残っているので、
 * 人が見たかどうかを1回だけ確かめる。
 *
 * **値が落ちた警告は対象にしない。** その欄は空欄になっているだけで、
 * 確認しても採用される値が無い。
 */
export function hasUnconfirmedWarnings(warnings: readonly CellWarning[]): boolean {
  return warnings.some((warning) => warning.valueKept);
}

/**
 * 確認の文言。**⚠記号と件数を添える。色だけで表現しない**
 * （`.claude/rules/frontend.md`）。ここは「どこが怪しいか」を伝える場では
 * ないので件数でよい（該当セルは表の中で既に指している。同 §5.2）。
 */
export function confirmWarningsText(warnings: readonly CellWarning[]): string {
  const count = warnings.filter((warning) => warning.valueKept).length;
  return `⚠ 値を採用したまま警告が残っている項目が ${String(count)} 件あります。原典と見比べて確認しましたか？`;
}

/**
 * 確認を挟むか（同 §5.6）。**ペイロードは運ばない。**
 *
 * 以前はペイロードのスナップショットを確認待ちの間だけ保持していたが、確認バナー表示中に
 * ユーザーがセルを直すと古い値が保存されるバグがあった（code-reviewer 指摘、2026-07-30）。
 * 送信するかどうかの判定だけを純粋関数にし、ペイロードは送信の瞬間に
 * `handleSubmit` が毎回組み立て直す。
 */
export function shouldShowConfirmation(
  warnings: readonly CellWarning[],
  awaitingConfirmation: boolean,
): boolean {
  return hasUnconfirmedWarnings(warnings) && !awaitingConfirmation;
}

export function toYearRow(record: ImportedRecord, dividendAnnualAmountSen: number | null): YearRow {
  return {
    fiscalYear: String(record.fiscalYear),
    isForecast: record.isForecast,
    epsYen: senToEditableText(record.epsSen),
    roePercent: ratioToEditableText(record.roePercent),
    revenueYen: senToEditableText(record.revenueSen),
    operatingMarginPercent: ratioToEditableText(record.operatingMarginPercent),
    dividendYen: senToEditableText(dividendAnnualAmountSen),
  };
}

/** 値の入力欄。年度・区分は行を突き合わせる鍵なのでマージの対象にしない */
const VALUE_FIELDS = [
  'epsYen',
  'roePercent',
  'revenueYen',
  'operatingMarginPercent',
  'dividendYen',
] as const;

function fiscalYearOf(row: YearRow): number {
  return Number(toHalfWidth(row.fiscalYear));
}

/** 並びは「予想行 → 実績年度の降順」（同設計書 §5.5） */
function byForecastThenYearDesc(a: YearRow, b: YearRow): number {
  if (a.isForecast !== b.isForecast) return a.isForecast ? -1 : 1;
  return fiscalYearOf(b) - fiscalYearOf(a);
}

export interface MergeRowsWithImportResult {
  readonly rows: readonly YearRow[];
  /** 手入力を取り込み値で置き換えたセル数。呼び出し側が通知に使う（同設計書 §5.5） */
  readonly overwrittenCount: number;
}

/**
 * 取り込み結果を既存の行にマージする。**取り込みは手入力を破壊しない**
 * （`docs/02_design/logic/import-review.md` §5.5）。
 *
 * ①②④⑦ は取り込みで構造的に埋まらない
 * （`docs/02_design/logic/irbank-json-import.md` §6.2）ので、この機能は手入力との
 * 併用が前提になる。したがって「取り込みに無い」を「空である」と解釈してはいけない。
 * 行の同一性は年度だけで決める（同じ年度の行を2つ作らないため）。
 * React の state を知らない純粋関数にしてある（`fillBlankMultiples` と同じ方針）。
 */
export function mergeRowsWithImport(
  existingRows: readonly YearRow[],
  records: readonly ImportedRecord[],
  dividends: readonly IrBankDividendView[],
): MergeRowsWithImportResult {
  const dividendByYear = new Map(dividends.map((d) => [d.fiscalYear, d.annualAmountSen]));
  const importedByYear = new Map(
    records.map((record) => [
      record.fiscalYear,
      toYearRow(record, dividendByYear.get(record.fiscalYear) ?? null),
    ]),
  );
  let overwrittenCount = 0;

  const mergedRows = existingRows.map((existing) => {
    const imported = importedByYear.get(fiscalYearOf(existing));
    if (imported === undefined) return existing;

    const merged = { ...existing, isForecast: imported.isForecast };
    for (const field of VALUE_FIELDS) {
      const value = imported[field];
      if (value === '') continue;
      if (merged[field] !== '' && merged[field] !== value) overwrittenCount += 1;
      merged[field] = value;
    }
    return merged;
  });

  const existingYears = new Set(existingRows.map(fiscalYearOf));
  const addedRows = [...importedByYear]
    .filter(([fiscalYear]) => !existingYears.has(fiscalYear))
    .map(([, row]) => row);

  return {
    rows: [...mergedRows, ...addedRows].sort(byForecastThenYearDesc),
    overwrittenCount,
  };
}

export interface FillBlankMultiplesResult {
  readonly per: string;
  /** `per` を新しく埋めたときだけ非 `null`。既存値を触らなかった場合は `null` */
  readonly perSource: PerSource | null;
  readonly pbr: string;
  readonly pbrSource: PbrSource | null;
}

/**
 * PER/PBR を株価と取り込み済み EPS/BPS から算出し、**空欄のときだけ**入れ替える。
 * ユーザーが既に手入力した値は上書きしない。埋めたときだけ出所を返す
 * （2026-07-29 追加。呼び出し側が「出所を上書きしてよいか」を自分で
 * 判定しなくて済むようにするため）。
 *
 * 株価が数値として読めなければ何もしない（現在の値をそのまま返す）。
 * React の state を知らない純粋関数にしてある（テストのため。同設計書 §8-7）。
 */
export function fillBlankMultiples(input: {
  readonly priceYen: string;
  readonly per: string;
  readonly pbr: string;
  readonly latestForecastEpsSen: number | null;
  readonly latestActualEpsSen: number | null;
  readonly latestActualBpsSen: number | null;
}): FillBlankMultiplesResult {
  const priceSen = yenToSen(input.priceYen);
  if (priceSen === undefined) {
    return { per: input.per, perSource: null, pbr: input.pbr, pbrSource: null };
  }
  const derived = deriveMarketMultiples({
    priceSen,
    latestForecastEpsSen: input.latestForecastEpsSen,
    latestActualEpsSen: input.latestActualEpsSen,
    latestActualBpsSen: input.latestActualBpsSen,
  });
  const fillPer = input.per === '';
  const fillPbr = input.pbr === '';
  return {
    per: fillPer ? ratioToEditableText(derived.per) : input.per,
    perSource: fillPer ? derived.perSource : null,
    pbr: fillPbr ? ratioToEditableText(derived.pbr) : input.pbr,
    pbrSource: fillPbr ? derived.pbrSource : null,
  };
}

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
  const [perSource, setPerSource] = useState<PerSource | null>(null);
  const [pbr, setPbr] = useState('');
  const [pbrSource, setPbrSource] = useState<PbrSource | null>(null);
  const [currentAssetsYen, setCurrentAssetsYen] = useState('');
  const [investmentSecuritiesYen, setInvestmentSecuritiesYen] = useState('');
  const [totalLiabilitiesYen, setTotalLiabilitiesYen] = useState('');
  const [previousDividendTotalYen, setPreviousDividendTotalYen] = useState('');
  const [rows, setRows] = useState<readonly YearRow[]>(() => [
    emptyRow(THIS_YEAR + 1, true),
    ...Array.from({ length: DEFAULT_ROWS }, (_, index) => emptyRow(THIS_YEAR - index)),
  ]);
  const [error, setError] = useState<string | null>(null);
  /**
   * 確認待ちか（同設計書 §5.6）。**フラグだけを持ち、ペイロードは持たない。**
   * 確認バナー表示中もセルは編集できるので、送信内容は押された時点の state から作る。
   */
  const [awaitingConfirmation, setAwaitingConfirmation] = useState(false);

  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importNotice, setImportNotice] = useState<string | null>(null);
  /** 取り込みで怪しかったセル。人が判断する箇所を指すために持つ（同設計書 §5.2） */
  const [cellWarnings, setCellWarnings] = useState<readonly CellWarning[]>([]);
  /** ⑨ の PER/PBR を株価から算出するために保持する。取り込み前は `null` */
  const [importedForecastEpsSen, setImportedForecastEpsSen] = useState<number | null>(null);
  const [importedEpsSen, setImportedEpsSen] = useState<number | null>(null);
  const [importedBpsSen, setImportedBpsSen] = useState<number | null>(null);

  /** 判定は `fillBlankMultiples`（純粋関数）に置き、ここは state への反映だけ */
  const fillMultiplesIfEmpty = (
    priceRaw: string,
    forecastEpsSen: number | null,
    epsSen: number | null,
    bpsSen: number | null,
  ) => {
    const filled = (currentPer: string, currentPbr: string) =>
      fillBlankMultiples({
        priceYen: priceRaw,
        per: currentPer,
        pbr: currentPbr,
        latestForecastEpsSen: forecastEpsSen,
        latestActualEpsSen: epsSen,
        latestActualBpsSen: bpsSen,
      });
    // 各欄は自分の**最新**の値だけを見る（取り込み中に手入力された値を消さない）
    setPer((current) => {
      const result = filled(current, pbr);
      if (result.perSource !== null) setPerSource(result.perSource);
      return result.per;
    });
    setPbr((current) => {
      const result = filled(per, current);
      if (result.pbrSource !== null) setPbrSource(result.pbrSource);
      return result.pbr;
    });
  };

  const handleImport = async () => {
    setImportError(null);
    setImportNotice(null);
    // 前回の取り込みの警告を別の銘柄に付けたまま残さない
    setCellWarnings([]);
    // 警告の中身が入れ替わるので、古い警告に対する確認を新しい警告へ持ち越さない
    // （code-reviewer 指摘、2026-07-30。確認バナー表示中の再取り込みが未確認のまま素通りしていた）
    setAwaitingConfirmation(false);

    const normalizedCode = toHalfWidth(code).toUpperCase();
    if (!/^\d{3}[0-9A-Z]$/.test(normalizedCode)) {
      setImportError(
        '銘柄コードは4文字（先頭3桁は数字、末尾1桁は数字か英大文字）で入力してください',
      );
      return;
    }

    setImporting(true);
    try {
      const result = await api.importFromIrBank(normalizedCode);
      setCode(normalizedCode);
      const merged = mergeRowsWithImport(rows, result.records, result.dividends);
      setRows(merged.rows);
      setImportedForecastEpsSen(result.latestForecastEpsSen);
      setImportedEpsSen(result.latestActualEpsSen);
      setImportedBpsSen(result.latestActualBpsSen);
      fillMultiplesIfEmpty(
        priceYen,
        result.latestForecastEpsSen,
        result.latestActualEpsSen,
        result.latestActualBpsSen,
      );
      // 手入力を置き換えたことは黙って済ませない（同設計書 §5.5）
      setImportNotice(
        merged.overwrittenCount > 0
          ? `${String(merged.overwrittenCount)}件の入力値を取り込み値で置き換えました`
          : null,
      );
      // 怪しい値は件数に潰さず、該当セルと表の外に出す（同設計書 §2.1・§5.2）
      setCellWarnings(result.cellWarnings);
    } catch (cause) {
      setImportError(cause instanceof Error ? cause.message : '取り込みに失敗しました');
    } finally {
      setImporting(false);
    }
  };

  const updateRow = (index: number, patch: Partial<YearRow>) => {
    const edited = rows[index];
    setRows((previous) =>
      previous.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)),
    );
    // 直したセルの警告は用済みになる（同設計書 §5.6）
    if (edited !== undefined) {
      setCellWarnings((previous) => dropEditedWarnings(previous, edited.fiscalYear, patch));
    }
  };

  /** 判定は純粋関数側に置き、ここは state を渡すだけ */
  const cellWarningsOf = (row: YearRow, field: YearRowField) =>
    warningsForCell(cellWarnings, row.fiscalYear, field);

  const invalidIfWarned = (row: YearRow, field: YearRowField) =>
    cellWarningsOf(row, field).length > 0 ? 'true' : undefined;

  const cellWarningNotes = (row: YearRow, field: YearRowField) =>
    cellWarningsOf(row, field).map((warning, order) => (
      <p className="warning" key={`${field}-${warning.reason}-${String(order)}`}>
        {cellWarningText(warning)}
        {/* 元の値は等幅でそのまま出す。金額として整形しない（同設計書 §5.2） */}
        （元の値: <code>{warning.raw}</code>）
      </p>
    ));

  const warningsOutsideTable = rowlessWarnings(cellWarnings);

  /**
   * 入力を受け付けられないときの共通処理。**確認待ちを必ず解除する。**
   * バリデーションが通らない状態で確認バナーを出したままにしない（同設計書 §5.6）。
   */
  const failValidation = (message: string) => {
    setError(message);
    setAwaitingConfirmation(false);
  };

  /**
   * 送信する内容は**呼ばれるたびに毎回ゼロから組み立てる**。確認バナー表示中も表は
   * 編集できるので、スナップショットを保持すると直した値が捨てられる（同設計書 §5.6）。
   */
  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    const normalizedCode = toHalfWidth(code).toUpperCase();
    if (!/^\d{3}[0-9A-Z]$/.test(normalizedCode)) {
      failValidation(
        '銘柄コードは4文字（先頭3桁は数字、末尾1桁は数字か英大文字）で入力してください',
      );
      return;
    }
    if (name.trim() === '') {
      failValidation('銘柄名を入力してください');
      return;
    }

    const priceSen = yenToSen(priceYen);
    if (priceSen === undefined) {
      failValidation('株価は数値で入力してください（小数第2位まで）');
      return;
    }
    if (priceSen !== null && (priceSen < 0 || priceSen > 100_000_000)) {
      failValidation('株価は 0 円以上 1,000,000 円以下で入力してください');
      return;
    }

    const records: AnalyzeCompanyRequest['records'] = [];
    const dividends: AnalyzeCompanyRequest['dividends'] = [];

    for (const row of rows) {
      const fiscalYear = Number(toHalfWidth(row.fiscalYear));
      if (!Number.isInteger(fiscalYear) || fiscalYear < 1900 || fiscalYear > 2200) {
        failValidation(`決算年度が不正です: ${row.fiscalYear}`);
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
        failValidation(`${String(fiscalYear)} 年度の入力に数値として読めない項目があります`);
        return;
      }

      records.push({
        fiscalYear,
        isForecast: row.isForecast,
        epsSen,
        roePercent,
        revenueSen,
        operatingMarginPercent,
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
      failValidation('貸借対照表の項目は数値で入力してください');
      return;
    }

    const perValue = toRatio(per);
    const pbrValue = toRatio(pbr);
    if (perValue === undefined || pbrValue === undefined) {
      failValidation('PER / PBR は数値で入力してください');
      return;
    }
    // 出所は空欄なら null（データなし）。値があるのに出所が無い＝ユーザーが直接編集した
    const multiples = {
      per: perValue,
      perSource: perValue === null ? null : (perSource ?? 'manual'),
      pbr: pbrValue,
      pbrSource: pbrValue === null ? null : (pbrSource ?? 'manual'),
    };

    const payload: AnalyzeCompanyRequest = {
      code: normalizedCode,
      name: name.trim(),
      records,
      dividends,
      balanceSheet: balance as AnalyzeCompanyRequest['balanceSheet'],
      multiples,
      priceSen,
    };

    // 確認バナーの「確認した」は type="submit" なので、ここへ戻ってくる（同設計書 §5.6）
    if (shouldShowConfirmation(cellWarnings, awaitingConfirmation)) {
      setAwaitingConfirmation(true);
      return;
    }
    setAwaitingConfirmation(false);
    onSubmit(payload);
  };

  return (
    <form onSubmit={handleSubmit} className="company-form">
      <fieldset>
        <legend>銘柄</legend>
        <label>
          銘柄コード
          <input value={code} onChange={(event) => setCode(event.target.value)} required />
        </label>
        <button type="button" onClick={() => void handleImport()} disabled={importing}>
          {importing ? '取り込み中…' : 'IRバンクから取り込む'}
        </button>
        <p className="meta">
          銘柄コードから業績・配当を取り込み、年度別データへ反映します（取り込みに値が無い
          欄の手入力は残ります。株価・PER・PBR・貸借対照表は対象外。株価を先に入力しておくと PER/PBR
          も算出します）。
        </p>
        {importError !== null && (
          <p className="error" role="alert">
            {importError}
          </p>
        )}
        {importNotice !== null && <p className="meta">{importNotice}</p>}
        <label>
          銘柄名
          <input value={name} onChange={(event) => setName(event.target.value)} required />
        </label>
        <label>
          現在株価（円）
          <input
            value={priceYen}
            onChange={(event) => {
              const value = event.target.value;
              setPriceYen(value);
              fillMultiplesIfEmpty(value, importedForecastEpsSen, importedEpsSen, importedBpsSen);
            }}
            inputMode="decimal"
            placeholder="例: 1234.50"
          />
        </label>
      </fieldset>

      <fieldset>
        <legend>市場指標・貸借対照表（⑥⑨ で使用）</legend>
        <label>
          PER（倍）
          <input
            value={per}
            onChange={(event) => {
              setPer(event.target.value);
              setPerSource('manual');
            }}
            inputMode="decimal"
          />
        </label>
        <p className="meta">{multipleSourceText(perSource)}</p>
        <label>
          PBR（倍）
          <input
            value={pbr}
            onChange={(event) => {
              setPbr(event.target.value);
              setPbrSource('manual');
            }}
            inputMode="decimal"
          />
        </label>
        <p className="meta">{multipleSourceText(pbrSource)}</p>
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
        {warningsOutsideTable.length > 0 && (
          <ul className="warning">
            {warningsOutsideTable.map((warning, order) => (
              <li key={`${warning.fiscalYearKey}-${warning.column}-${String(order)}`}>
                {rowlessWarningText(warning)}
              </li>
            ))}
          </ul>
        )}
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
                    aria-invalid={invalidIfWarned(row, 'epsYen')}
                  />
                  {cellWarningNotes(row, 'epsYen')}
                </td>
                <td>
                  <input
                    value={row.roePercent}
                    onChange={(event) => updateRow(index, { roePercent: event.target.value })}
                    inputMode="decimal"
                    aria-label="ROE"
                    aria-invalid={invalidIfWarned(row, 'roePercent')}
                  />
                  {cellWarningNotes(row, 'roePercent')}
                </td>
                <td>
                  <input
                    value={row.revenueYen}
                    onChange={(event) => updateRow(index, { revenueYen: event.target.value })}
                    inputMode="decimal"
                    aria-label="売上高"
                    aria-invalid={invalidIfWarned(row, 'revenueYen')}
                  />
                  {cellWarningNotes(row, 'revenueYen')}
                </td>
                <td>
                  <input
                    value={row.operatingMarginPercent}
                    onChange={(event) =>
                      updateRow(index, { operatingMarginPercent: event.target.value })
                    }
                    inputMode="decimal"
                    aria-label="営業利益率"
                    aria-invalid={invalidIfWarned(row, 'operatingMarginPercent')}
                  />
                  {cellWarningNotes(row, 'operatingMarginPercent')}
                </td>
                <td>
                  <input
                    value={row.dividendYen}
                    onChange={(event) => updateRow(index, { dividendYen: event.target.value })}
                    inputMode="decimal"
                    aria-label="1株配当"
                    aria-invalid={invalidIfWarned(row, 'dividendYen')}
                  />
                  {cellWarningNotes(row, 'dividendYen')}
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

      {awaitingConfirmation && (
        <div className="warning" role="alert">
          <p>{confirmWarningsText(cellWarnings)}</p>
          {/* type="submit" にして handleSubmit を通す。確認中に直した値をそのまま送るため */}
          <button type="submit" disabled={disabled}>
            確認した
          </button>
          <button type="button" onClick={() => setAwaitingConfirmation(false)}>
            戻る
          </button>
        </div>
      )}

      <button type="submit" disabled={disabled}>
        {disabled ? '解析中…' : '解析して保存'}
      </button>
    </form>
  );
}
