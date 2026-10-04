import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { parseSummaryCsv } from '@/infra/edinet/parse-summary-csv';

/**
 * EDINET有価証券報告書CSVのパース。
 * 仕様: `docs/02_design/logic/edinet-history-import.md` §2.4〜§2.7・§4.1・§4.2・§7.1
 *
 * 実物フィクスチャ（`tests/fixtures/edinet/*.csv`）に無いケース（単位異常・IFRS移行境界・
 * 負値EPS）は、実物と同じ列構成を保った**構成CSV**をテスト内で組み立てて使う
 * （`.claude/rules/backend.md`「モックのレスポンスは実物のサンプルから作る」の精神を踏まえ、
 * 実物CSVの構造〈タブ区切り・列順・引用符付き〉をそのまま踏襲する）。
 */

function fixtureText(name: string): string {
  const buffer = readFileSync(
    fileURLToPath(new URL(`../../fixtures/edinet/${name}`, import.meta.url)),
  );
  return new TextDecoder('utf-16le').decode(buffer);
}

const HEADER = [
  '要素ID',
  '項目名',
  'コンテキストID',
  '相対年度',
  '連結・個別',
  '期間・時点',
  'ユニットID',
  '単位',
  '値',
]
  .map((cell) => `"${cell}"`)
  .join('\t');

function row(
  elementId: string,
  contextId: string,
  unitId: string,
  unit: string,
  value: string,
): string {
  return [elementId, '項目名', contextId, '相対年度', 'その他', '期間', unitId, unit, value]
    .map((cell) => `"${cell}"`)
    .join('\t');
}

/** BOM付きUTF-16のフィクスチャを模した、構成CSVテキストを組み立てる（実データの列構成を維持） */
function buildCsv(rows: readonly string[]): string {
  return [HEADER, ...rows].join('\n');
}

describe('parseSummaryCsv — 実物フィクスチャ（§7.1受入基準）', () => {
  it('9433 fy2026「四期前」EPS(IFRS) → 15001銭', () => {
    const parsed = parseSummaryCsv(fixtureText('9433-fy2026-S100YKG2.csv'));
    expect(parsed.epsSenByOffset[4]).toBe(15001);
  });

  it('9433 fy2026「四期前」売上収益(IFRS) → 544,670,800,000,000銭（百万円換算しない）', () => {
    const parsed = parseSummaryCsv(fixtureText('9433-fy2026-S100YKG2.csv'));
    expect(parsed.revenueSenByOffset[4]).toBe(544_670_800_000_000);
  });

  it('9433 は当期(添字0)を基準にIFRSタグへ解決し、他の要素IDへフォールバックしない（決定7）', () => {
    const parsed = parseSummaryCsv(fixtureText('9433-fy2026-S100YKG2.csv'));
    // 当期(添字0) EPS=183.59円 → 18359銭
    expect(parsed.epsSenByOffset[0]).toBe(18359);
    expect(parsed.revenueSenByOffset[0]).toBe(607_191_500_000_000);
  });

  it('1301 fy2026「四期前」EPS(日本基準) → 43083銭', () => {
    const parsed = parseSummaryCsv(fixtureText('1301-fy2026-S100YE8K.csv'));
    expect(parsed.epsSenByOffset[4]).toBe(43_083);
  });

  it('1301 fy2026「四期前」売上高(連結・日本基準) → 25,357,500,000,000銭', () => {
    const parsed = parseSummaryCsv(fixtureText('1301-fy2026-S100YE8K.csv'));
    expect(parsed.revenueSenByOffset[4]).toBe(25_357_500_000_000);
  });

  it('⑥用: 9433（IFRS連結）は流動資産が取れ、投資有価証券は対応タグが無く null になる', () => {
    const parsed = parseSummaryCsv(fixtureText('9433-fy2026-S100YKG2.csv'));
    // 前期末 4,706,507,000,000円 → 470,650,700,000,000銭
    expect(parsed.balanceSheet.currentAssetsSen).toBe(470_650_700_000_000);
    expect(parsed.balanceSheet.investmentSecuritiesSen).toBeNull();
  });

  it('⑥用: 1301（日本基準連結）は流動資産・投資有価証券とも取れる', () => {
    const parsed = parseSummaryCsv(fixtureText('1301-fy2026-S100YE8K.csv'));
    // 前期末 134,260,000,000円 → 13,426,000,000,000銭
    expect(parsed.balanceSheet.currentAssetsSen).toBe(13_426_000_000_000);
    // 前期末 14,053,000,000円 → 1,405,300,000,000銭
    expect(parsed.balanceSheet.investmentSecuritiesSen).toBe(1_405_300_000_000);
  });

  it('連結タグが無い銘柄は個別（_NonConsolidatedMember）へフォールバックする（構成: 連結行を除いたCSV）', () => {
    // 1301の個別EPS行（実測値317.97円）だけを使い、連結行を含まないCSVを組み立てる
    const csv = buildCsv([
      row(
        'jpcrp_cor:BasicEarningsLossPerShareSummaryOfBusinessResults',
        'CurrentYearDuration_NonConsolidatedMember',
        'JPYPerShares',
        '',
        '483.69',
      ),
      row(
        'jpcrp_cor:BasicEarningsLossPerShareSummaryOfBusinessResults',
        'Prior4YearDuration_NonConsolidatedMember',
        'JPYPerShares',
        '',
        '317.97',
      ),
    ]);
    const parsed = parseSummaryCsv(csv);
    expect(parsed.epsSenByOffset[4]).toBe(31_797);
    expect(parsed.epsSenByOffset[0]).toBe(48_369);
  });
});

describe('parseSummaryCsv — 単位検証（構成CSV。§4.2・境界値ちょうど）', () => {
  it('単位列が「円」以外（例: 百万円）の売上高は採用せず null、診断を残す', () => {
    const csv = buildCsv([
      row(
        'jpcrp_cor:NetSalesSummaryOfBusinessResults',
        'CurrentYearDuration',
        'JPY',
        '百万円',
        '5000',
      ),
    ]);
    const parsed = parseSummaryCsv(csv);
    expect(parsed.revenueSenByOffset[0]).toBeNull();
    expect(parsed.diagnostics).toContainEqual(
      expect.objectContaining({ field: 'revenue', reason: 'unit-mismatch' }),
    );
  });

  it('単位列が「円」ちょうどの売上高は採用する（境界値ちょうど）', () => {
    const csv = buildCsv([
      row('jpcrp_cor:NetSalesSummaryOfBusinessResults', 'CurrentYearDuration', 'JPY', '円', '5000'),
    ]);
    const parsed = parseSummaryCsv(csv);
    expect(parsed.revenueSenByOffset[0]).toBe(500_000);
  });

  it('ユニットIDが JPYPerShares 以外のEPS行は採用せず null、診断を残す', () => {
    const csv = buildCsv([
      row(
        'jpcrp_cor:BasicEarningsLossPerShareSummaryOfBusinessResults',
        'CurrentYearDuration',
        'JPY',
        '',
        '150.01',
      ),
    ]);
    const parsed = parseSummaryCsv(csv);
    expect(parsed.epsSenByOffset[0]).toBeNull();
    expect(parsed.diagnostics).toContainEqual(
      expect.objectContaining({ field: 'eps', reason: 'unit-mismatch' }),
    );
  });

  it('ユニットIDが JPYPerShares ちょうどのEPS行は採用する（境界値ちょうど）', () => {
    const csv = buildCsv([
      row(
        'jpcrp_cor:BasicEarningsLossPerShareSummaryOfBusinessResults',
        'CurrentYearDuration',
        'JPYPerShares',
        '',
        '150.01',
      ),
    ]);
    const parsed = parseSummaryCsv(csv);
    expect(parsed.epsSenByOffset[0]).toBe(15_001);
  });
});

describe('parseSummaryCsv — 欠損・0円の区別（§4.1）', () => {
  it('"－"（未使用のタグ）は null（0と混同しない）', () => {
    const csv = buildCsv([
      row(
        'jpcrp_cor:BasicEarningsLossPerShareSummaryOfBusinessResults',
        'CurrentYearDuration',
        'JPYPerShares',
        '',
        String.fromCharCode(0xff0d),
      ),
    ]);
    const parsed = parseSummaryCsv(csv);
    expect(parsed.epsSenByOffset[0]).toBeNull();
  });

  it('EPS = 0円は null と混同せず 0銭として扱う', () => {
    const csv = buildCsv([
      row(
        'jpcrp_cor:BasicEarningsLossPerShareSummaryOfBusinessResults',
        'CurrentYearDuration',
        'JPYPerShares',
        '',
        '0.00',
      ),
    ]);
    const parsed = parseSummaryCsv(csv);
    expect(parsed.epsSenByOffset[0]).toBe(0);
  });

  it('要素IDの行が丸ごと存在しない年度は null（固定した要素IDのみを読み、他へフォールバックしない）', () => {
    const csv = buildCsv([
      row(
        'jpcrp_cor:BasicEarningsLossPerShareSummaryOfBusinessResults',
        'CurrentYearDuration',
        'JPYPerShares',
        '',
        '150.01',
      ),
      // Prior1YearDuration の行が無い
    ]);
    const parsed = parseSummaryCsv(csv);
    expect(parsed.epsSenByOffset[1]).toBeNull();
  });
});

describe('parseSummaryCsv — 変換は文字列のまま整数へ持ち上げる（§4.2）', () => {
  it('"150.01" → 15001（浮動小数点の丸め誤差が入らない値で確認）', () => {
    const csv = buildCsv([
      row(
        'jpcrp_cor:BasicEarningsLossPerShareSummaryOfBusinessResults',
        'CurrentYearDuration',
        'JPYPerShares',
        '',
        '150.01',
      ),
    ]);
    const parsed = parseSummaryCsv(csv);
    // 実装（senFromDecimalText）は小数点を文字列操作でずらすだけで `Number(text) * 100` を
    // 経由しない。`1.005 * 100` が `100.49999999999999` になるような double の丸み誤差を
    // 踏まないことを、実測値の桁が一致することで確認する
    expect(parsed.epsSenByOffset[0]).toBe(15_001);
  });

  it('安全整数を超える売上高は unsafe-integer 診断を残し null にする（境界値超過）', () => {
    // Number.MAX_SAFE_INTEGER = 9,007,199,254,740,991。銭で超えるよう円の値を選ぶ
    const csv = buildCsv([
      row(
        'jpcrp_cor:NetSalesSummaryOfBusinessResults',
        'CurrentYearDuration',
        'JPY',
        '円',
        '90071992547410',
      ),
    ]);
    const parsed = parseSummaryCsv(csv);
    expect(parsed.revenueSenByOffset[0]).toBeNull();
    expect(parsed.diagnostics).toContainEqual(
      expect.objectContaining({ field: 'revenue', reason: 'unsafe-integer' }),
    );
  });

  it('安全整数ちょうどの売上高は採用する（境界値ちょうど）', () => {
    // 90,071,992,547,409円 × 100 = 9,007,199,254,740,900（MAX_SAFE_INTEGER未満）
    const csv = buildCsv([
      row(
        'jpcrp_cor:NetSalesSummaryOfBusinessResults',
        'CurrentYearDuration',
        'JPY',
        '円',
        '90071992547409',
      ),
    ]);
    const parsed = parseSummaryCsv(csv);
    expect(parsed.revenueSenByOffset[0]).toBe(9_007_199_254_740_900);
  });
});

describe('parseSummaryCsv — 負の値（赤字EPS。§6・未実測のため保守的に倒す）', () => {
  it('"-123.45" 形式は正しくパースする', () => {
    const csv = buildCsv([
      row(
        'jpcrp_cor:BasicEarningsLossPerShareSummaryOfBusinessResults',
        'CurrentYearDuration',
        'JPYPerShares',
        '',
        '-123.45',
      ),
    ]);
    const parsed = parseSummaryCsv(csv);
    expect(parsed.epsSenByOffset[0]).toBe(-12_345);
  });

  it('△123（会計表記）は unparsable-value 診断を残し null にする（未実測のため未サポート）', () => {
    const csv = buildCsv([
      row(
        'jpcrp_cor:BasicEarningsLossPerShareSummaryOfBusinessResults',
        'CurrentYearDuration',
        'JPYPerShares',
        '',
        '△123.45',
      ),
    ]);
    const parsed = parseSummaryCsv(csv);
    expect(parsed.epsSenByOffset[0]).toBeNull();
    expect(parsed.diagnostics).toContainEqual(
      expect.objectContaining({ field: 'eps', reason: 'unparsable-value' }),
    );
  });

  it('全角マイナス（－123.45）は unparsable-value 診断を残し null にする', () => {
    const csv = buildCsv([
      row(
        'jpcrp_cor:BasicEarningsLossPerShareSummaryOfBusinessResults',
        'CurrentYearDuration',
        'JPYPerShares',
        '',
        `${String.fromCharCode(0xff0d)}123.45`,
      ),
    ]);
    const parsed = parseSummaryCsv(csv);
    expect(parsed.epsSenByOffset[0]).toBeNull();
    expect(parsed.diagnostics).toContainEqual(
      expect.objectContaining({ field: 'eps', reason: 'unparsable-value' }),
    );
  });
});

describe('parseSummaryCsv — ⑤ ROE自算（実物フィクスチャ。§2.8・§7.6受入基準）', () => {
  it('9433（IFRS）FY2026の5期（年度昇順）が 13.50/12.86/11.57/13.02/13.93 と完全一致する', () => {
    const parsed = parseSummaryCsv(fixtureText('9433-fy2026-S100YKG2.csv'));
    // 添字0=当期(FY2026)〜4=四期前(FY2022)
    expect(parsed.roePercentByOffset).toEqual([13.93, 13.02, 11.57, 12.86, 13.5]);
  });

  it('1301（日本基準）FY2023〜FY2026が 12.16/10.06/10.14/8.85 とIRバンク値と0.01pp以内で一致する', () => {
    const parsed = parseSummaryCsv(fixtureText('1301-fy2026-S100YE8K.csv'));
    // 添字0=当期(FY2026)〜3=三期前(FY2023)
    expect(parsed.roePercentByOffset[0]).toBeCloseTo(8.85, 2);
    expect(parsed.roePercentByOffset[1]).toBeCloseTo(10.14, 2);
    expect(parsed.roePercentByOffset[2]).toBeCloseTo(10.06, 2);
    expect(parsed.roePercentByOffset[3]).toBeCloseTo(12.16, 2);
  });

  it('1301の四期前（FY2022・offset4）が固定期待値 10.86% になる（IRバンクに公表値が無い年度。§2.8・2026-08-10決定）', () => {
    const parsed = parseSummaryCsv(fixtureText('1301-fy2026-S100YE8K.csv'));
    expect(parsed.roePercentByOffset[4]).toBe(10.86);
  });

  it('roePercentは%で入る（0.1393ではなく13.93。§4.2「倍のまま保存すると⑤が全銘柄0点になる」）', () => {
    const parsed = parseSummaryCsv(fixtureText('9433-fy2026-S100YKG2.csv'));
    expect(parsed.roePercentByOffset[0]).toBeGreaterThan(1);
  });
});

describe('parseSummaryCsv — ⑤ ROE境界値・単位検証（構成CSV。§4.1.1・§7.6）', () => {
  /** IFRS経路（自己資本を円で直接取る）の最小構成。当期(offset0)のみ */
  function ifrsRoeCsv(netIncomeValue: string, equityValue: string): string {
    return buildCsv([
      row(
        'jpcrp_cor:ProfitLossAttributableToOwnersOfParentIFRSSummaryOfBusinessResults',
        'CurrentYearDuration',
        'JPY',
        '円',
        netIncomeValue,
      ),
      row(
        'jpcrp_cor:EquityAttributableToOwnersOfParentIFRSSummaryOfBusinessResults',
        'CurrentYearInstant',
        'JPY',
        '円',
        equityValue,
      ),
    ]);
  }

  it('自己資本 = 0 → roePercent は null（ゼロ除算）', () => {
    const csv = ifrsRoeCsv('1000000000', '0');
    const parsed = parseSummaryCsv(csv);
    expect(parsed.roePercentByOffset[0]).toBeNull();
  });

  it('自己資本 < 0（債務超過） → roePercent は null。純利益が正でも高得点化させない', () => {
    const csv = ifrsRoeCsv('1000000000', '-1000000000');
    const parsed = parseSummaryCsv(csv);
    expect(parsed.roePercentByOffset[0]).toBeNull();
  });

  /**
   * 日本基準経路（総資産×自己資本比率）の最小構成。当期(offset0)のみ。
   * `readEquitySenSeries` の `jp-computed` 分岐・`readRatioCell` を実際に通す
   * （IFRS直接経路 `ifrsRoeCsv` とは別の分岐）。
   */
  function jpRoeCsv(netIncomeValue: string, totalAssetsValue: string, ratioValue: string): string {
    return buildCsv([
      row(
        'jpcrp_cor:ProfitLossAttributableToOwnersOfParentSummaryOfBusinessResults',
        'CurrentYearDuration',
        'JPY',
        '円',
        netIncomeValue,
      ),
      row(
        'jpcrp_cor:TotalAssetsSummaryOfBusinessResults',
        'CurrentYearInstant',
        'JPY',
        '円',
        totalAssetsValue,
      ),
      row(
        'jpcrp_cor:EquityToAssetRatioSummaryOfBusinessResults',
        'CurrentYearInstant',
        'pure',
        '',
        ratioValue,
      ),
    ]);
  }

  it('日本基準経路: 自己資本比率 = 0 → 自己資本(計算値)も0 → roePercent は null（ゼロ除算。IFRS経路とは別分岐）', () => {
    const csv = jpRoeCsv('1000000000', '10000000000', '0');
    const parsed = parseSummaryCsv(csv);
    expect(parsed.roePercentByOffset[0]).toBeNull();
  });

  it('日本基準経路: 自己資本比率が負（債務超過相当） → 自己資本(計算値)が負 → roePercent は null（IFRS経路とは別分岐）', () => {
    const csv = jpRoeCsv('1000000000', '10000000000', '-0.1');
    const parsed = parseSummaryCsv(csv);
    expect(parsed.roePercentByOffset[0]).toBeNull();
  });

  it('日本基準経路: 自己資本比率が"－"（未使用タグ） → roePercent は null（readRatioCellのMISSING_VALUE分岐。診断は残さない）', () => {
    const csv = jpRoeCsv('1000000000', '10000000000', String.fromCharCode(0xff0d));
    const parsed = parseSummaryCsv(csv);
    expect(parsed.roePercentByOffset[0]).toBeNull();
    expect(parsed.diagnostics).toEqual([]);
  });

  it('日本基準経路: 自己資本比率が"△0.1"（会計表記・未サポート） → unparsable-value診断、roePercent は null（readRatioCell自身の分岐）', () => {
    const csv = jpRoeCsv('1000000000', '10000000000', '△0.1');
    const parsed = parseSummaryCsv(csv);
    expect(parsed.roePercentByOffset[0]).toBeNull();
    expect(parsed.diagnostics).toContainEqual(
      expect.objectContaining({ field: 'equity', reason: 'unparsable-value', raw: '△0.1' }),
    );
  });

  it('純利益が負・自己資本が正 → 負のroePercentをそのまま返す（nullにしない）', () => {
    const csv = ifrsRoeCsv('-500000000000', '5000000000000');
    const parsed = parseSummaryCsv(csv);
    expect(parsed.roePercentByOffset[0]).toBe(-10);
  });

  it('純利益が"－"（未使用タグ） → roePercent は null（0と混同しない）', () => {
    const csv = ifrsRoeCsv(String.fromCharCode(0xff0d), '5000000000000');
    const parsed = parseSummaryCsv(csv);
    expect(parsed.roePercentByOffset[0]).toBeNull();
  });

  it('自己資本の該当年度の行が無い → その年度だけ roePercent は null（他は解決経路が保たれる）', () => {
    const csv = buildCsv([
      row(
        'jpcrp_cor:ProfitLossAttributableToOwnersOfParentIFRSSummaryOfBusinessResults',
        'CurrentYearDuration',
        'JPY',
        '円',
        '1000000000',
      ),
      row(
        'jpcrp_cor:ProfitLossAttributableToOwnersOfParentIFRSSummaryOfBusinessResults',
        'Prior4YearDuration',
        'JPY',
        '円',
        '900000000',
      ),
      row(
        'jpcrp_cor:EquityAttributableToOwnersOfParentIFRSSummaryOfBusinessResults',
        'CurrentYearInstant',
        'JPY',
        '円',
        '10000000000',
      ),
      // Prior4YearInstant（四期前時点）の自己資本行が無い
    ]);
    const parsed = parseSummaryCsv(csv);
    expect(parsed.roePercentByOffset[0]).toBe(10);
    expect(parsed.roePercentByOffset[4]).toBeNull();
  });

  it('純利益の単位が「円」以外 → field: netIncome / unit-mismatch、roePercent は null', () => {
    const csv = buildCsv([
      row(
        'jpcrp_cor:ProfitLossAttributableToOwnersOfParentSummaryOfBusinessResults',
        'CurrentYearDuration',
        'JPY',
        '百万円',
        '1000',
      ),
      row(
        'jpcrp_cor:EquityAttributableToOwnersOfParentIFRSSummaryOfBusinessResults',
        'CurrentYearInstant',
        'JPY',
        '円',
        '10000000000',
      ),
    ]);
    const parsed = parseSummaryCsv(csv);
    expect(parsed.roePercentByOffset[0]).toBeNull();
    expect(parsed.diagnostics).toContainEqual(
      expect.objectContaining({ field: 'netIncome', reason: 'unit-mismatch' }),
    );
  });

  it('IFRS自己資本の単位が「円」以外 → field: equity / unit-mismatch、roePercent は null', () => {
    const csv = buildCsv([
      row(
        'jpcrp_cor:ProfitLossAttributableToOwnersOfParentIFRSSummaryOfBusinessResults',
        'CurrentYearDuration',
        'JPY',
        '円',
        '1000000000',
      ),
      row(
        'jpcrp_cor:EquityAttributableToOwnersOfParentIFRSSummaryOfBusinessResults',
        'CurrentYearInstant',
        'JPY',
        '百万円',
        '10000',
      ),
    ]);
    const parsed = parseSummaryCsv(csv);
    expect(parsed.roePercentByOffset[0]).toBeNull();
    expect(parsed.diagnostics).toContainEqual(
      expect.objectContaining({ field: 'equity', reason: 'unit-mismatch' }),
    );
  });

  it('日本基準・総資産の単位が「円」以外 → field: equity / unit-mismatch、roePercent は null', () => {
    const csv = buildCsv([
      row(
        'jpcrp_cor:ProfitLossAttributableToOwnersOfParentSummaryOfBusinessResults',
        'CurrentYearDuration',
        'JPY',
        '円',
        '1000000000',
      ),
      row(
        'jpcrp_cor:TotalAssetsSummaryOfBusinessResults',
        'CurrentYearInstant',
        'JPY',
        '百万円',
        '10000',
      ),
      row(
        'jpcrp_cor:EquityToAssetRatioSummaryOfBusinessResults',
        'CurrentYearInstant',
        'pure',
        '',
        '0.5',
      ),
    ]);
    const parsed = parseSummaryCsv(csv);
    expect(parsed.roePercentByOffset[0]).toBeNull();
    expect(parsed.diagnostics).toContainEqual(
      expect.objectContaining({ field: 'equity', reason: 'unit-mismatch' }),
    );
  });

  it('自己資本比率のユニットIDが pure 以外（実測の罠を再現。§2.8.1） → unit-mismatch、275309%のような値を通さない', () => {
    // 9433・7203の実測どおり EquityToAssetRatioIFRS... 相当のBPS値（JPYPerShares・1333.50）を
    // 日本基準経路（EquityToAssetRatioSummaryOfBusinessResults）に混入させて検証する
    const csv = buildCsv([
      row(
        'jpcrp_cor:ProfitLossAttributableToOwnersOfParentSummaryOfBusinessResults',
        'CurrentYearDuration',
        'JPY',
        '円',
        '1000000000',
      ),
      row(
        'jpcrp_cor:TotalAssetsSummaryOfBusinessResults',
        'CurrentYearInstant',
        'JPY',
        '円',
        '10000000000',
      ),
      row(
        'jpcrp_cor:EquityToAssetRatioSummaryOfBusinessResults',
        'CurrentYearInstant',
        'JPYPerShares',
        '',
        '1333.50',
      ),
    ]);
    const parsed = parseSummaryCsv(csv);
    expect(parsed.roePercentByOffset[0]).toBeNull();
    expect(parsed.diagnostics).toContainEqual(
      expect.objectContaining({ field: 'equity', reason: 'unit-mismatch' }),
    );
  });

  it('連結・個別の取り違え防止: 個別（_NonConsolidatedMember）行を連結として読まない（1301実測相当）', () => {
    const csv = buildCsv([
      // 連結: 純利益600,000,000円・自己資本10,000,000,000円 → 6%
      row(
        'jpcrp_cor:ProfitLossAttributableToOwnersOfParentSummaryOfBusinessResults',
        'CurrentYearDuration',
        'JPY',
        '円',
        '600000000',
      ),
      row(
        'jpcrp_cor:EquityAttributableToOwnersOfParentIFRSSummaryOfBusinessResults',
        'CurrentYearInstant',
        'JPY',
        '円',
        '10000000000',
      ),
      // 個別: 別の値（連結と混同すると別の点数になる）
      row(
        'jpcrp_cor:ProfitLossAttributableToOwnersOfParentSummaryOfBusinessResults',
        'CurrentYearDuration_NonConsolidatedMember',
        'JPY',
        '円',
        '900000000',
      ),
      row(
        'jpcrp_cor:EquityAttributableToOwnersOfParentIFRSSummaryOfBusinessResults',
        'CurrentYearInstant_NonConsolidatedMember',
        'JPY',
        '円',
        '3000000000',
      ),
    ]);
    const parsed = parseSummaryCsv(csv);
    expect(parsed.roePercentByOffset[0]).toBe(6);
  });

  it('個別のみ存在（連結タグなし） → 個別へフォールバックせず roePercent は null（§6決定）', () => {
    const csv = buildCsv([
      row(
        'jpcrp_cor:ProfitLossAttributableToOwnersOfParentSummaryOfBusinessResults',
        'CurrentYearDuration_NonConsolidatedMember',
        'JPY',
        '円',
        '900000000',
      ),
      row(
        'jpcrp_cor:EquityAttributableToOwnersOfParentIFRSSummaryOfBusinessResults',
        'CurrentYearInstant_NonConsolidatedMember',
        'JPY',
        '円',
        '3000000000',
      ),
    ]);
    const parsed = parseSummaryCsv(csv);
    expect(parsed.roePercentByOffset).toEqual([null, null, null, null, null]);
  });

  it('IFRS自己資本と日本基準（総資産×比率）の両方が存在する場合、IFRS経路が優先される（決定7と同じ思想）', () => {
    const csv = buildCsv([
      row(
        'jpcrp_cor:ProfitLossAttributableToOwnersOfParentIFRSSummaryOfBusinessResults',
        'CurrentYearDuration',
        'JPY',
        '円',
        '1000000000',
      ),
      // IFRS経路: 自己資本10,000,000,000円 → 10%
      row(
        'jpcrp_cor:EquityAttributableToOwnersOfParentIFRSSummaryOfBusinessResults',
        'CurrentYearInstant',
        'JPY',
        '円',
        '10000000000',
      ),
      // 日本基準経路が使われた場合は 2% になってしまう値をわざと混在させる
      row(
        'jpcrp_cor:TotalAssetsSummaryOfBusinessResults',
        'CurrentYearInstant',
        'JPY',
        '円',
        '100000000000',
      ),
      row(
        'jpcrp_cor:EquityToAssetRatioSummaryOfBusinessResults',
        'CurrentYearInstant',
        'pure',
        '',
        '0.5',
      ),
    ]);
    const parsed = parseSummaryCsv(csv);
    expect(parsed.roePercentByOffset[0]).toBe(10);
  });

  it('自己資本比率×総資産の掛け算がNumber.MAX_SAFE_INTEGERを超える → unsafe-integer診断、roePercentはnull（総資産自体は安全整数内。掛け算専用の分岐を踏む）', () => {
    const csv = buildCsv([
      row(
        'jpcrp_cor:ProfitLossAttributableToOwnersOfParentSummaryOfBusinessResults',
        'CurrentYearDuration',
        'JPY',
        '円',
        '1000000000',
      ),
      // 90,071,992,547,409円 → 銭換算で 9,007,199,254,740,900（MAX_SAFE_INTEGER=9,007,199,254,740,991
      // 未満。総資産単体は readCell の unsafe-integer 分岐を踏まない）
      row(
        'jpcrp_cor:TotalAssetsSummaryOfBusinessResults',
        'CurrentYearInstant',
        'JPY',
        '円',
        '90071992547409',
      ),
      // 比率1.5（データ異常の再現。自己資本比率は本来1以下だが、ここでは掛け算後にのみ
      // オーバーフローさせるためあえて1超にする）→ 9,007,199,254,740,900 × 1.5 が
      // MAX_SAFE_INTEGER を超え、readEquitySenSeries の掛け算専用オーバーフロー分岐に到達する
      row(
        'jpcrp_cor:EquityToAssetRatioSummaryOfBusinessResults',
        'CurrentYearInstant',
        'pure',
        '',
        '1.5',
      ),
    ]);
    const parsed = parseSummaryCsv(csv);
    expect(parsed.roePercentByOffset[0]).toBeNull();
    expect(parsed.diagnostics).toContainEqual(
      expect.objectContaining({
        field: 'equity',
        reason: 'unsafe-integer',
        raw: '90071992547409×1.5',
      }),
    );
  });

  it('IFRS自己資本自体が安全整数を超える → unsafe-integer診断、roePercentはnull', () => {
    const csv = ifrsRoeCsv('1000000000', '90071992547410');
    const parsed = parseSummaryCsv(csv);
    expect(parsed.roePercentByOffset[0]).toBeNull();
    expect(parsed.diagnostics).toContainEqual(
      expect.objectContaining({ field: 'equity', reason: 'unsafe-integer' }),
    );
  });
});

describe('parseSummaryCsv — IFRS移行企業（構成CSV。§4.1決定7・§6未実測のため構成で検証）', () => {
  // ⚠️ 実銘柄のフィクスチャが無い（設計書§6明記）。この describe は実データではなく
  // 9433の構造を踏襲した構成CSVで、決定7（1回だけ解決する）の規則そのものを検証する。
  it('最新年度がIFRSタグで解決されたら、同じCSV内に日本基準タグが別途あっても読まない', () => {
    const csv = buildCsv([
      // 当期はIFRSタグのみ存在（移行後）
      row(
        'jpcrp_cor:BasicEarningsLossPerShareIFRSSummaryOfBusinessResults',
        'CurrentYearDuration',
        'JPYPerShares',
        '',
        '183.59',
      ),
      // 四期前は移行前なので日本基準タグに値がある（IFRSタグには無い）
      row(
        'jpcrp_cor:BasicEarningsLossPerShareSummaryOfBusinessResults',
        'Prior4YearDuration',
        'JPYPerShares',
        '',
        '125.15',
      ),
    ]);
    const parsed = parseSummaryCsv(csv);
    // 当期はIFRSタグを固定して読めるが、四期前はIFRSタグの行が無いため null になる。
    // 日本基準タグへは「混ぜて」フォールバックしない（決定7）
    expect(parsed.epsSenByOffset[0]).toBe(18_359);
    expect(parsed.epsSenByOffset[4]).toBeNull();
  });
});

describe('parseSummaryCsv — ⑧営業利益（実物フィクスチャ。§2.9・§7.7受入基準）', () => {
  it('9433 fy2026: 当期(offset0)=109,912,500,000,000銭、前期(offset1)=108,746,800,000,000銭', () => {
    const parsed = parseSummaryCsv(fixtureText('9433-fy2026-S100YKG2.csv'));
    expect(parsed.operatingIncomeSenByOffset[0]).toBe(109_912_500_000_000);
    expect(parsed.operatingIncomeSenByOffset[1]).toBe(108_746_800_000_000);
  });

  it('9433は長さ2固定（3期目以降は存在せず取得しない）', () => {
    const parsed = parseSummaryCsv(fixtureText('9433-fy2026-S100YKG2.csv'));
    expect(parsed.operatingIncomeSenByOffset).toHaveLength(2);
  });

  it('9433は日本基準タグ（jppfs_cor:OperatingIncome）ではなくIFRSタグ（jpigp_cor:OperatingProfitLossIFRS）の値が採用される', () => {
    const parsed = parseSummaryCsv(fixtureText('9433-fy2026-S100YKG2.csv'));
    // 個別（_NonConsolidatedMember）タグの値 655,817,000,000円（=65,581,700,000,000銭）
    // ではないことを明示的に確認し、個別と取り違えていないことを二重に確認する
    expect(parsed.operatingIncomeSenByOffset[0]).not.toBe(65_581_700_000_000);
    expect(parsed.operatingIncomeSenByOffset[0]).toBe(109_912_500_000_000);
  });

  it('1301 fy2026: 当期(offset0)=1,073,100,000,000銭、前期(offset1)=1,107,900,000,000銭', () => {
    const parsed = parseSummaryCsv(fixtureText('1301-fy2026-S100YE8K.csv'));
    expect(parsed.operatingIncomeSenByOffset[0]).toBe(1_073_100_000_000);
    expect(parsed.operatingIncomeSenByOffset[1]).toBe(1_107_900_000_000);
  });
});

describe('parseSummaryCsv — ⑧営業利益 セグメント別コンテキストの罠（構成CSV。§2.9.2・§7.7）', () => {
  it('9433実測の派生コンテキストを模したCSVで、素の CurrentYearDuration だけが採用され、セグメント値が混入しない', () => {
    const csv = buildCsv([
      // セグメント別内訳（採用してはいけない）
      row(
        'jpigp_cor:OperatingProfitLossIFRS',
        'CurrentYearDuration_jpcrp030000-asr_E04425-000PersonalReportableSegmentMember',
        'JPY',
        '円',
        '828337000000',
      ),
      row(
        'jpigp_cor:OperatingProfitLossIFRS',
        'CurrentYearDuration_TotalOfReportableSegmentsAndOthersMember',
        'JPY',
        '円',
        '1101680000000',
      ),
      // 素のキー（採用すべき値）
      row('jpigp_cor:OperatingProfitLossIFRS', 'CurrentYearDuration', 'JPY', '円', '1099125000000'),
    ]);
    const parsed = parseSummaryCsv(csv);
    expect(parsed.operatingIncomeSenByOffset[0]).toBe(109_912_500_000_000);
  });
});

describe('parseSummaryCsv — ⑧営業利益 個別のみ存在（連結タグなし）→ フォールバックしない（構成CSV。CR-5・§4.1.1決定に倣う）', () => {
  it('個別（_NonConsolidatedMember）タグのみ存在（連結タグなし） → 個別へフォールバックせず operatingIncomeSenByOffset は [null, null]', () => {
    const csv = buildCsv([
      row(
        'jppfs_cor:OperatingIncome',
        'CurrentYearDuration_NonConsolidatedMember',
        'JPY',
        '円',
        '655817000000',
      ),
      row(
        'jppfs_cor:OperatingIncome',
        'Prior1YearDuration_NonConsolidatedMember',
        'JPY',
        '円',
        '600000000000',
      ),
    ]);
    const parsed = parseSummaryCsv(csv);
    expect(parsed.operatingIncomeSenByOffset).toEqual([null, null]);
  });
});

describe('parseSummaryCsv — ⑧営業利益 単位検証・境界値ちょうど（構成CSV。§4.2）', () => {
  it('単位が「円」以外（例: 百万円）→ null + diagnostics: field=operatingIncome, reason=unit-mismatch', () => {
    const csv = buildCsv([
      row('jppfs_cor:OperatingIncome', 'CurrentYearDuration', 'JPY', '百万円', '1000'),
    ]);
    const parsed = parseSummaryCsv(csv);
    expect(parsed.operatingIncomeSenByOffset[0]).toBeNull();
    expect(parsed.diagnostics).toContainEqual(
      expect.objectContaining({ field: 'operatingIncome', reason: 'unit-mismatch' }),
    );
  });

  it('単位が「円」ちょうど → 採用する（境界値ちょうど）', () => {
    const csv = buildCsv([
      row('jppfs_cor:OperatingIncome', 'CurrentYearDuration', 'JPY', '円', '1000'),
    ]);
    const parsed = parseSummaryCsv(csv);
    expect(parsed.operatingIncomeSenByOffset[0]).toBe(100_000);
  });
});

describe('parseSummaryCsv — ⑧営業利益 欠損・0円・負値の区別（§4.1・§7.7）', () => {
  it('"－"（未使用のタグ）は null（0と混同しない）', () => {
    const csv = buildCsv([
      row(
        'jppfs_cor:OperatingIncome',
        'CurrentYearDuration',
        'JPY',
        '円',
        String.fromCharCode(0xff0d),
      ),
    ]);
    const parsed = parseSummaryCsv(csv);
    expect(parsed.operatingIncomeSenByOffset[0]).toBeNull();
  });

  it('営業利益 0.00 → 0（null と区別。§7.7「0円ちょうどの年度」要件）', () => {
    const csv = buildCsv([row('jppfs_cor:OperatingIncome', 'CurrentYearDuration', 'JPY', '円', '0.00')]);
    const parsed = parseSummaryCsv(csv);
    expect(parsed.operatingIncomeSenByOffset[0]).toBe(0);
  });

  it('営業赤字は負のまま返す（nullにしない）', () => {
    const csv = buildCsv([
      row('jppfs_cor:OperatingIncome', 'CurrentYearDuration', 'JPY', '円', '-500000000000'),
    ]);
    const parsed = parseSummaryCsv(csv);
    expect(parsed.operatingIncomeSenByOffset[0]).toBe(-50_000_000_000_000);
  });

  it('要素IDの行自体が存在しない年度（前期の行が無い）→ null（固定した要素IDのみ読み、フォールバックしない）', () => {
    const csv = buildCsv([
      row('jppfs_cor:OperatingIncome', 'CurrentYearDuration', 'JPY', '円', '1000000000'),
      // Prior1YearDuration の行が無い
    ]);
    const parsed = parseSummaryCsv(csv);
    expect(parsed.operatingIncomeSenByOffset[0]).toBe(100_000_000_000);
    expect(parsed.operatingIncomeSenByOffset[1]).toBeNull();
  });
});

describe('parseSummaryCsv — ⑧営業利益 安全整数超過・パース不能（構成CSV）', () => {
  it('安全整数を超える値 → unsafe-integer 診断 + null', () => {
    const csv = buildCsv([
      row('jppfs_cor:OperatingIncome', 'CurrentYearDuration', 'JPY', '円', '90071992547410'),
    ]);
    const parsed = parseSummaryCsv(csv);
    expect(parsed.operatingIncomeSenByOffset[0]).toBeNull();
    expect(parsed.diagnostics).toContainEqual(
      expect.objectContaining({ field: 'operatingIncome', reason: 'unsafe-integer' }),
    );
  });

  it('△123（会計表記）は unparsable-value 診断を残し null にする', () => {
    const csv = buildCsv([
      row('jppfs_cor:OperatingIncome', 'CurrentYearDuration', 'JPY', '円', '△123'),
    ]);
    const parsed = parseSummaryCsv(csv);
    expect(parsed.operatingIncomeSenByOffset[0]).toBeNull();
    expect(parsed.diagnostics).toContainEqual(
      expect.objectContaining({ field: 'operatingIncome', reason: 'unparsable-value' }),
    );
  });

  it('全角マイナス付き値は unparsable-value 診断を残し null にする', () => {
    const csv = buildCsv([
      row(
        'jppfs_cor:OperatingIncome',
        'CurrentYearDuration',
        'JPY',
        '円',
        `${String.fromCharCode(0xff0d)}123`,
      ),
    ]);
    const parsed = parseSummaryCsv(csv);
    expect(parsed.operatingIncomeSenByOffset[0]).toBeNull();
    expect(parsed.diagnostics).toContainEqual(
      expect.objectContaining({ field: 'operatingIncome', reason: 'unparsable-value' }),
    );
  });
});

describe('parseSummaryCsv — ⑧営業利益 未実測: 金融株相当（構成CSV。実データ確認は将来課題）', () => {
  // ⚠️ 実フィクスチャが無い（設計書§6・todo-list.md §8-12相当の残課題）。
  // 「jppfs_cor:OperatingIncome も jpigp_cor:OperatingProfitLossIFRS も一切含まないCSV」で
  // resolveElementId が null を返し、operatingIncomeSenByOffset が [null, null] になる
  // ロジックのみを確認する。金融株（銀行・保険）で実際にこの分岐を通るかは未確認。
  it('候補要素IDがどちらも解決できない → operatingIncomeSenByOffset は [null, null]（ロジックのみ検証）', () => {
    const csv = buildCsv([
      // 営業利益系のタグを一切含まない（他項目のタグのみ）
      row(
        'jpcrp_cor:NetSalesSummaryOfBusinessResults',
        'CurrentYearDuration',
        'JPY',
        '円',
        '1000000000',
      ),
    ]);
    const parsed = parseSummaryCsv(csv);
    expect(parsed.operatingIncomeSenByOffset).toEqual([null, null]);
  });
});
