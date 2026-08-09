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
