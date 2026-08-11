/**
 * EDINET有価証券報告書のCSV（`XBRL_TO_CSV/jpcrp030000-asr-*.csv`）を正規化する。
 *
 * 仕様: `docs/02_design/logic/edinet-history-import.md` §2.4〜§2.7・§4.1・§4.2・§7.1
 *
 * **純粋関数。ネットワークにも触らない。** UTF-16 デコードは `unzip-edinet-document.ts`
 * が済ませたテキストを受け取る。
 *
 * CSV は UTF-16（BOM付き）・タブ区切り。列構成（実測、両銘柄で共通）:
 * `要素ID  項目名  コンテキストID  相対年度  連結・個別  期間・時点  ユニットID  単位  値`
 */

import {
  type EdinetImportDiagnostic,
  type EdinetImportDiagnosticField,
} from '../../domain/company/edinet-history-source';

/** 添字0=当期 〜 4=四期前。「経営指標等の推移」が必ず5期分持つコンテキスト（§2.4） */
const DURATION_CONTEXTS: readonly string[] = [
  'CurrentYearDuration',
  'Prior1YearDuration',
  'Prior2YearDuration',
  'Prior3YearDuration',
  'Prior4YearDuration',
];

/** 個別（非連結）のコンテキストサフィックス（§2.5） */
const NON_CONSOLIDATED_SUFFIX = '_NonConsolidatedMember';

/** ⑥用。前期末時点のコンテキスト（§2.7） */
const BALANCE_SHEET_CONTEXT = 'Prior1YearInstant';

/**
 * 欠損（未使用のタグ）を表す値。0円/0銭と区別する（§4.1）。
 *
 * U+FF0D（全角ハイフンマイナス）。実測フィクスチャで確認した文字コード
 * （`String.fromCharCode` で組み立て、ソースへの直接埋め込みによる文字化けを避ける）。
 */
const MISSING_VALUE = String.fromCharCode(0xff0d);

/** `-123.45` 形式のみサポートする（§6。`△123`・全角マイナスは unparsable-value） */
const NUMERIC_TEXT = /^-?\d+(\.\d+)?$/;

/** EPS の期待ユニットID（§4.2） */
const EPS_UNIT_ID = 'JPYPerShares';
/** 売上高・貸借対照表項目の期待単位（§4.2） */
const YEN_UNIT = '円';

/** UTF-16 の BOM（U+FEFF）。`String.fromCharCode` で組み立て、埋め込み文字化けを避ける */
const BOM = String.fromCharCode(0xfeff);

/** EPS の候補要素ID（連結）。フォールバック順（§4.1） */
const EPS_CANDIDATES_CONSOLIDATED: readonly string[] = [
  'jpcrp_cor:BasicEarningsLossPerShareSummaryOfBusinessResults',
  'jpcrp_cor:BasicEarningsLossPerShareIFRSSummaryOfBusinessResults',
];

/** 売上高の候補要素ID（連結）。フォールバック順（§4.1） */
const REVENUE_CANDIDATES_CONSOLIDATED: readonly string[] = [
  'jpcrp_cor:NetSalesSummaryOfBusinessResults',
  'jpcrp_cor:RevenueIFRSSummaryOfBusinessResults',
  'jpcrp_cor:OperatingRevenue1SummaryOfBusinessResults',
];

/** ⑥ 流動資産の候補要素ID（連結のみ。§2.7・§6: 個別フォールバックは初回スコープ外） */
const CURRENT_ASSETS_CANDIDATES: readonly string[] = [
  'jppfs_cor:CurrentAssets',
  'jpigp_cor:CurrentAssetsIFRS',
];

/** ⑥ 投資有価証券の候補要素ID（連結のみ。IFRS企業は対応タグなし。§2.7） */
const INVESTMENT_SECURITIES_CANDIDATES: readonly string[] = ['jppfs_cor:InvestmentSecurities'];

/**
 * ⑤純利益の候補要素ID（連結のみ）。§4.1.1・§6決定。
 * **個別（非連結）フォールバックは実装しない**（`resolveElementId` へ `false` を渡す）。
 */
const NET_INCOME_CANDIDATES_CONSOLIDATED: readonly string[] = [
  'jpcrp_cor:ProfitLossAttributableToOwnersOfParentSummaryOfBusinessResults',
  'jpcrp_cor:ProfitLossAttributableToOwnersOfParentIFRSSummaryOfBusinessResults',
  // 未実測フォールバック（§6残課題）。3銘柄の実測ではここまで到達しない
  'jpcrp_cor:NetIncomeLossSummaryOfBusinessResults',
];

/** ⑤自己資本（IFRS直接。円で取れる）の要素ID（§4.1.1） */
const EQUITY_IFRS_ELEMENT_ID = 'jpcrp_cor:EquityAttributableToOwnersOfParentIFRSSummaryOfBusinessResults';

/** ⑤自己資本比率算出用・総資産（日本基準）の要素ID（§4.1.1） */
const TOTAL_ASSETS_ELEMENT_ID = 'jpcrp_cor:TotalAssetsSummaryOfBusinessResults';

/**
 * ⑤自己資本比率（日本基準）の要素ID。
 * **`EquityToAssetRatioIFRS...` は使わない**（名前に反して BPS が入っている罠。§2.8.1）。
 */
const EQUITY_RATIO_ELEMENT_ID = 'jpcrp_cor:EquityToAssetRatioSummaryOfBusinessResults';

/** 添字0=当期〜4=四期前。自己資本用の時点コンテキスト（§4.1.1） */
const INSTANT_CONTEXTS: readonly string[] = [
  'CurrentYearInstant',
  'Prior1YearInstant',
  'Prior2YearInstant',
  'Prior3YearInstant',
  'Prior4YearInstant',
];

/** 比率（自己資本比率）の期待ユニットID。`pure` 以外はBPS等の罠（§2.8.1・§4.2） */
const PURE_UNIT_ID = 'pure';

/**
 * パース時点の診断。**この層は docID も当期年度も知らない**（CSV テキストしか渡されない
 * 純粋関数）ので、`sourceDocId` / `fiscalYear` を欠いた形にとどめる。
 * それらの肉付けは `edinet-client.ts` が行い、`EdinetImportDiagnostic` を完成させる。
 */
export type SummaryCsvDiagnostic = Omit<EdinetImportDiagnostic, 'sourceDocId' | 'fiscalYear'>;

export interface ParsedSummaryCsv {
  /** 添字0=当期 〜 4=四期前。銭。取れなければ `null`（欠損タグ含む） */
  readonly epsSenByOffset: readonly (number | null)[];
  /** 同上 */
  readonly revenueSenByOffset: readonly (number | null)[];
  /**
   * ⑤用。添字0=当期 〜 4=四期前。**%**（純利益÷期末自己資本×100の自算値。§4.1.1）。
   * 取れなければ `null`。
   */
  readonly roePercentByOffset: readonly (number | null)[];
  readonly balanceSheet: {
    readonly currentAssetsSen: number | null;
    readonly investmentSecuritiesSen: number | null;
  };
  readonly diagnostics: readonly SummaryCsvDiagnostic[];
}

interface CsvRow {
  readonly elementId: string;
  readonly contextId: string;
  readonly unitId: string;
  readonly unit: string;
  readonly value: string;
}

/** タブ区切り1行を読む。フィールドは `"..."` で囲まれる（実測フォーマット） */
function splitRow(line: string): string[] {
  return line.split('\t').map((cell) => cell.replace(/^"|"$/g, ''));
}

/**
 * CSVテキストを `(elementId, contextId) -> row` のマップにする。
 *
 * 同じ組が複数行あるケースは実測で確認していないため、最初に見つけた行を採用する
 * （`parse-fy-data.ts` の「後勝ちにせず」とは異なり、ここでは実データに重複が無いため
 * 単純化する。もし重複が見つかったら後続の値は無視される＝安全側）。
 */
function buildRowIndex(text: string): ReadonlyMap<string, CsvRow> {
  const withoutBom = text.startsWith(BOM) ? text.slice(BOM.length) : text;
  const lines = withoutBom.split(/\r\n|\n/);
  const index = new Map<string, CsvRow>();

  // 先頭行はヘッダ（要素ID/項目名/コンテキストID/相対年度/連結・個別/期間・時点/ユニットID/単位/値）
  for (let lineIndex = 1; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    if (line === undefined || line.trim() === '') continue;
    const cells = splitRow(line);
    const elementId = cells[0];
    const contextId = cells[2];
    const unitId = cells[6];
    const unit = cells[7];
    const value = cells[8];
    if (
      elementId === undefined ||
      contextId === undefined ||
      unitId === undefined ||
      unit === undefined ||
      value === undefined
    ) {
      continue;
    }
    const key = `${elementId} ${contextId}`;
    if (!index.has(key)) index.set(key, { elementId, contextId, unitId, unit, value });
  }
  return index;
}

/**
 * 数値文字列を銭へ。**小数点を文字列のままずらす**（`parseFloat`/`Number(text) * 100` を
 * 経由しない）。`parse-fy-data.ts` の `senFromText` と同じ発想（§4.2）。
 */
function senFromDecimalText(text: string): number | null {
  const negative = text.startsWith('-');
  const body = negative ? text.slice(1) : text;
  const dot = body.indexOf('.');
  const integerPart = dot === -1 ? body : body.slice(0, dot);
  const fractionPart = dot === -1 ? '' : body.slice(dot + 1);

  // 小数第2位までを銭にする。EDINETの実測値はEPSで2桁（例: "150.01"）、
  // 売上高・貸借対照表項目は整数（フラクション無し）
  const paddedFraction = `${fractionPart}00`.slice(0, 2);
  const dropped = fractionPart.slice(2);
  // 3桁目以降は実測で存在しないが、来た場合は四捨五入する（`senFromText` と同じ規則）
  const droppedHead = dropped[0];
  const carry = droppedHead !== undefined && Number(droppedHead) >= 5 ? 1 : 0;

  const magnitude = Number(integerPart + paddedFraction) + carry;
  if (!Number.isSafeInteger(magnitude)) return null;
  return negative ? -magnitude : magnitude;
}

/** 対象銘柄の最新実績年度（当期）に対して、フォールバック順で最初に行が存在する要素IDを選ぶ（§4.1 決定7） */
function resolveElementId(
  rows: ReadonlyMap<string, CsvRow>,
  candidates: readonly string[],
  allowIndividualFallback: boolean,
): { readonly elementId: string; readonly individual: boolean } | null {
  for (const candidate of candidates) {
    if (rows.has(`${candidate} CurrentYearDuration`)) {
      return { elementId: candidate, individual: false };
    }
  }
  if (allowIndividualFallback) {
    for (const candidate of candidates) {
      if (rows.has(`${candidate} CurrentYearDuration${NON_CONSOLIDATED_SUFFIX}`)) {
        return { elementId: candidate, individual: true };
      }
    }
  }
  return null;
}

interface CellReadResult {
  readonly senByOffset: readonly (number | null)[];
  readonly diagnostics: readonly SummaryCsvDiagnostic[];
}

interface ExpectedUnit {
  readonly unitId?: string;
  readonly unit?: string;
}

function readCell(
  row: CsvRow,
  field: EdinetImportDiagnosticField,
  offset: number | null,
  diagnostics: SummaryCsvDiagnostic[],
  expectedUnit: ExpectedUnit,
): number | null {
  if (row.value === MISSING_VALUE) return null; // 未使用のタグ。0 と混同しない（§4.1）

  if (expectedUnit.unitId !== undefined && row.unitId !== expectedUnit.unitId) {
    diagnostics.push({
      field,
      offset,
      elementId: row.elementId,
      reason: 'unit-mismatch',
      raw: `unitId=${row.unitId}`,
    });
    return null;
  }
  if (expectedUnit.unit !== undefined && row.unit !== expectedUnit.unit) {
    diagnostics.push({
      field,
      offset,
      elementId: row.elementId,
      reason: 'unit-mismatch',
      raw: `unit=${row.unit}`,
    });
    return null;
  }

  if (!NUMERIC_TEXT.test(row.value)) {
    // `-123.45` 形式のみサポート。`△123`・全角マイナスは弾く（§6・未実測のため保守的に倒す）
    diagnostics.push({
      field,
      offset,
      elementId: row.elementId,
      reason: 'unparsable-value',
      raw: row.value,
    });
    return null;
  }

  const sen = senFromDecimalText(row.value);
  if (sen === null) {
    diagnostics.push({
      field,
      offset,
      elementId: row.elementId,
      reason: 'unsafe-integer',
      raw: row.value,
    });
    return null;
  }
  return sen;
}

/** 1回だけ解決した要素ID（連結/個別も固定済み）で5期分読む。他の要素IDへはフォールバックしない（§4.1 決定7） */
function readDurationSeries(
  rows: ReadonlyMap<string, CsvRow>,
  resolved: { readonly elementId: string; readonly individual: boolean } | null,
  field: EdinetImportDiagnosticField,
  expectedUnit: ExpectedUnit,
): CellReadResult {
  if (resolved === null) {
    return { senByOffset: [null, null, null, null, null], diagnostics: [] };
  }

  const diagnostics: SummaryCsvDiagnostic[] = [];
  const senByOffset = DURATION_CONTEXTS.map((baseContext, offset) => {
    const context = resolved.individual ? `${baseContext}${NON_CONSOLIDATED_SUFFIX}` : baseContext;
    const row = rows.get(`${resolved.elementId} ${context}`);
    if (row === undefined) return null; // その年度の行が無い。固定した要素IDへの忠実さを守り null にする
    return readCell(row, field, offset, diagnostics, expectedUnit);
  });

  return { senByOffset, diagnostics };
}

/** ⑥用。連結のみ（個別フォールバックは§2.7により初回スコープ外） */
function readBalanceSheetValue(
  rows: ReadonlyMap<string, CsvRow>,
  candidates: readonly string[],
  field: EdinetImportDiagnosticField,
  diagnostics: SummaryCsvDiagnostic[],
): number | null {
  for (const candidate of candidates) {
    const row = rows.get(`${candidate} ${BALANCE_SHEET_CONTEXT}`);
    if (row === undefined) continue;
    return readCell(row, field, null, diagnostics, { unit: YEN_UNIT });
  }
  return null;
}

/** ⑤自己資本をどちらの経路（IFRS直接 / 日本基準の総資産×比率）で解決したか（決定7と同じ思想） */
type EquitySource =
  | { readonly kind: 'ifrs-direct' }
  | { readonly kind: 'jp-computed' };

/**
 * 対象銘柄の最新実績年度（当期）に対して、自己資本の解決経路を1回だけ選ぶ（§4.1.1）。
 * IFRS実額が直接取れるならそちらを優先し、比率を経由しない（§2.8.1「BPSの罠」を避ける）。
 * どちらも無ければ `null`（個別フォールバックは実装しない。§6）。
 */
function resolveEquitySource(rows: ReadonlyMap<string, CsvRow>): EquitySource | null {
  if (rows.has(`${EQUITY_IFRS_ELEMENT_ID} CurrentYearInstant`)) return { kind: 'ifrs-direct' };
  if (
    rows.has(`${TOTAL_ASSETS_ELEMENT_ID} CurrentYearInstant`) &&
    rows.has(`${EQUITY_RATIO_ELEMENT_ID} CurrentYearInstant`)
  ) {
    return { kind: 'jp-computed' };
  }
  return null;
}

/**
 * 比率セル（`pure`）を、小数点の位置を保ったまま分数（BigInt の分子・分母）で読む。
 *
 * `senFromDecimalText` は小数第2位までしか保持できず（金額専用）、自己資本比率
 * （例 `"0.361"`）の精度を落とす。§4.1.1.1決定3「掛け算の時点でも浮動小数点を
 * 経由しない」ため、専用の読み取りにする。
 */
function readRatioCell(
  row: CsvRow,
  field: EdinetImportDiagnosticField,
  offset: number | null,
  diagnostics: SummaryCsvDiagnostic[],
): { readonly numerator: bigint; readonly denominator: bigint } | null {
  if (row.value === MISSING_VALUE) return null;

  if (row.unitId !== PURE_UNIT_ID) {
    // §2.8.1: `EquityToAssetRatioIFRS...` は名前に反して BPS（`JPYPerShares`）が入っている。
    // ここを通さないと 275309% のような値が通ってしまう
    diagnostics.push({
      field,
      offset,
      elementId: row.elementId,
      reason: 'unit-mismatch',
      raw: `unitId=${row.unitId}`,
    });
    return null;
  }
  if (!NUMERIC_TEXT.test(row.value)) {
    diagnostics.push({
      field,
      offset,
      elementId: row.elementId,
      reason: 'unparsable-value',
      raw: row.value,
    });
    return null;
  }

  const negative = row.value.startsWith('-');
  const body = negative ? row.value.slice(1) : row.value;
  const dot = body.indexOf('.');
  const integerPart = dot === -1 ? body : body.slice(0, dot);
  const fractionPart = dot === -1 ? '' : body.slice(dot + 1);
  const denominator = 10n ** BigInt(fractionPart.length);
  const magnitude = BigInt(integerPart + fractionPart);
  return { numerator: negative ? -magnitude : magnitude, denominator };
}

const MAX_SAFE_INTEGER_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);

/**
 * ⑤用。5期分の自己資本（銭。中間値。DBには保存しない）を読む（§4.1.1・決定7）。
 *
 * - `ifrs-direct`: 円で直接取れる実額をそのまま読む（`readCell` を流用）
 * - `jp-computed`: 総資産（円）× 自己資本比率（`pure`）を BigInt の整数演算で求める
 *   （§4.1.1.1決定2・3。浮動小数点を経由しない）
 */
function readEquitySenSeries(
  rows: ReadonlyMap<string, CsvRow>,
  resolved: EquitySource | null,
  diagnostics: SummaryCsvDiagnostic[],
): readonly (number | null)[] {
  if (resolved === null) return [null, null, null, null, null];

  if (resolved.kind === 'ifrs-direct') {
    return INSTANT_CONTEXTS.map((context, offset) => {
      const row = rows.get(`${EQUITY_IFRS_ELEMENT_ID} ${context}`);
      if (row === undefined) return null;
      return readCell(row, 'equity', offset, diagnostics, { unit: YEN_UNIT });
    });
  }

  return INSTANT_CONTEXTS.map((context, offset) => {
    const totalAssetsRow = rows.get(`${TOTAL_ASSETS_ELEMENT_ID} ${context}`);
    const ratioRow = rows.get(`${EQUITY_RATIO_ELEMENT_ID} ${context}`);
    if (totalAssetsRow === undefined || ratioRow === undefined) return null;

    const totalAssetsSen = readCell(totalAssetsRow, 'equity', offset, diagnostics, {
      unit: YEN_UNIT,
    });
    const ratio = readRatioCell(ratioRow, 'equity', offset, diagnostics);
    if (totalAssetsSen === null || ratio === null) return null;

    // BigInt の `/` は0方向への切り捨て（丸めなし）。中間値は銭単位のため、
    // ここで生じる1銭未満の誤差は、最終的な roePercent の%丸め（小数第2位）には影響しない
    const equitySenBig = (BigInt(totalAssetsSen) * ratio.numerator) / ratio.denominator;
    const magnitude = equitySenBig < 0n ? -equitySenBig : equitySenBig;
    if (magnitude > MAX_SAFE_INTEGER_BIGINT) {
      diagnostics.push({
        field: 'equity',
        offset,
        elementId: TOTAL_ASSETS_ELEMENT_ID,
        reason: 'unsafe-integer',
        raw: `${totalAssetsRow.value}×${ratioRow.value}`,
      });
      return null;
    }
    return Number(equitySenBig);
  });
}

/**
 * 純利益 ÷ 自己資本 × 100（期末基準）をオフセットごとに独立して求める（§4.1.1）。
 *
 * 丸めは**小数第2位・四捨五入**、除算は**BigInt整数演算**で行う（§4.1.1.1決定）。
 * `Number()` への変換は最後の1回（丸め後の値を返すとき）だけ。
 *
 * - 自己資本 ≤ 0（0含む債務超過）→ `null`（ゼロ除算・符号反転防止）
 * - 純利益・自己資本のどちらかが `null` → `null`
 * - 純利益が負・自己資本が正 → 負の値をそのまま返す（`null` にしない）
 */
function calculateRoePercentByOffset(
  netIncomeSenByOffset: readonly (number | null)[],
  equitySenByOffset: readonly (number | null)[],
): readonly (number | null)[] {
  return netIncomeSenByOffset.map((netIncomeSen, offset) => {
    const equitySen = equitySenByOffset[offset] ?? null;
    if (netIncomeSen === null || equitySen === null) return null;
    if (equitySen <= 0) return null;

    const net = BigInt(netIncomeSen);
    const equity = BigInt(equitySen);
    const negative = net < 0n;
    const absNet = negative ? -net : net;
    // %の万分の1（小数第4位相当）を整数として求める
    const scaledMagnitude = (absNet * 100n * 10000n) / equity;
    // %の百分の1（小数第2位）へ四捨五入
    const roundedMagnitude = (scaledMagnitude + 50n) / 100n;
    const rounded = negative ? -roundedMagnitude : roundedMagnitude;
    return Number(rounded) / 100;
  });
}

export function parseSummaryCsv(text: string): ParsedSummaryCsv {
  const rows = buildRowIndex(text);
  const diagnostics: SummaryCsvDiagnostic[] = [];

  const epsResolved = resolveElementId(rows, EPS_CANDIDATES_CONSOLIDATED, true);
  const epsResult = readDurationSeries(rows, epsResolved, 'eps', { unitId: EPS_UNIT_ID });
  diagnostics.push(...epsResult.diagnostics);

  const revenueResolved = resolveElementId(rows, REVENUE_CANDIDATES_CONSOLIDATED, true);
  const revenueResult = readDurationSeries(rows, revenueResolved, 'revenue', { unit: YEN_UNIT });
  diagnostics.push(...revenueResult.diagnostics);

  const currentAssetsSen = readBalanceSheetValue(
    rows,
    CURRENT_ASSETS_CANDIDATES,
    'currentAssets',
    diagnostics,
  );
  const investmentSecuritiesSen = readBalanceSheetValue(
    rows,
    INVESTMENT_SECURITIES_CANDIDATES,
    'investmentSecurities',
    diagnostics,
  );

  const netIncomeResolved = resolveElementId(rows, NET_INCOME_CANDIDATES_CONSOLIDATED, false);
  const netIncomeResult = readDurationSeries(rows, netIncomeResolved, 'netIncome', {
    unit: YEN_UNIT,
  });
  diagnostics.push(...netIncomeResult.diagnostics);

  const equitySource = resolveEquitySource(rows);
  const equityDiagnostics: SummaryCsvDiagnostic[] = [];
  const equitySenByOffset = readEquitySenSeries(rows, equitySource, equityDiagnostics);
  diagnostics.push(...equityDiagnostics);

  const roePercentByOffset = calculateRoePercentByOffset(
    netIncomeResult.senByOffset,
    equitySenByOffset,
  );

  return {
    epsSenByOffset: epsResult.senByOffset,
    revenueSenByOffset: revenueResult.senByOffset,
    roePercentByOffset,
    balanceSheet: { currentAssetsSen, investmentSecuritiesSen },
    diagnostics,
  };
}
