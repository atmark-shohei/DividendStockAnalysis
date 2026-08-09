import { describe, expect, it } from 'vitest';

import { type EdinetFilingYears, mergeEdinetFilings } from '@/domain/company/edinet-history-merge';

/**
 * `mergeEdinetFilings` — EDINET の2本の有報から6期を組み立て、重複4期の突き合わせで
 * 遡及修正を検出する（`docs/02_design/logic/edinet-history-import.md` §4.3・§7.2）。
 *
 * 実測値は `tests/fixtures/edinet/9433-fy2026-S100YKG2.csv`（第42期）と
 * `9433-fy2025-S100VXGZ.csv`（第41期）から読んだもの（設計書 §2.4・§2.6・§7.2 の表と同じ）。
 * `parseSummaryCsv` のパース結果を模した「添字0=当期〜4=四期前」の配列を直接組み立てる
 * （パースそのものは `tests/infra/edinet/parse-summary-csv.test.ts` が担う）。
 */

/** 添字0=当期, 1=前期, 2=前々期, 3=三期前, 4=四期前（銭）。5要素タプルで固定し、
 * `noUncheckedIndexedAccess` 下でも各要素へ添字アクセスした際に `undefined` が
 * 混ざらないようにする */
type Offsets5 = readonly [number, number, number, number, number];

const FY2026_EPS_SEN: Offsets5 = [18359, 16186, 14175, 14915, 15001];
const FY2026_REVENUE_SEN: Offsets5 = [
  607191500000000, 583552500000000, 569972400000000, 563002400000000, 544670800000000,
];
const FY2025_EPS_SEN: Offsets5 = [16933, 15063, 15550, 15001, 14208];
const FY2025_REVENUE_SEN: Offsets5 = [
  591795300000000, 575404700000000, 567176200000000, 544670800000000, 531259900000000,
];

function fy2026(overrides: Partial<EdinetFilingYears> = {}): EdinetFilingYears {
  return {
    fiscalYear: 2026,
    docId: 'S100YKG2',
    epsSenByOffset: FY2026_EPS_SEN,
    revenueSenByOffset: FY2026_REVENUE_SEN,
    ...overrides,
  };
}

function fy2025(overrides: Partial<EdinetFilingYears> = {}): EdinetFilingYears {
  return {
    fiscalYear: 2025,
    docId: 'S100VXGZ',
    epsSenByOffset: FY2025_EPS_SEN,
    revenueSenByOffset: FY2025_REVENUE_SEN,
    ...overrides,
  };
}

describe('mergeEdinetFilings — 6期の組み立て（§4.5）', () => {
  it('prior が無ければ最新有報の5期分だけを返す。6期目は作らない', () => {
    const merged = mergeEdinetFilings({ latest: fy2026(), prior: null });
    expect(merged.years).toHaveLength(5);
    expect(merged.years.map((year) => year.fiscalYear)).toEqual([2026, 2025, 2024, 2023, 2022]);
    expect(merged.years[0]).toEqual({
      fiscalYear: 2026,
      epsSen: 18359,
      revenueSen: 607191500000000,
      sourceDocId: 'S100YKG2',
    });
  });

  it('prior があれば6期目（五期前）を prior の「四期前」（添字4）から作る', () => {
    const merged = mergeEdinetFilings({ latest: fy2026(), prior: fy2025() });
    expect(merged.years).toHaveLength(6);
    expect(merged.years.map((year) => year.fiscalYear)).toEqual([
      2026, 2025, 2024, 2023, 2022, 2021,
    ]);
    expect(merged.years[5]).toEqual({
      fiscalYear: 2021,
      epsSen: 14208,
      revenueSen: 531259900000000,
      sourceDocId: 'S100VXGZ',
    });
  });

  it('欠損（null）は6期目にもそのまま伝わる', () => {
    const merged = mergeEdinetFilings({
      latest: fy2026(),
      prior: fy2025({ epsSenByOffset: [16933, 15063, 15550, 15001, null] }),
    });
    expect(merged.years[5]?.epsSen).toBeNull();
  });
});

describe('mergeEdinetFilings — 遡及修正の検出（§4.3・§7.2）', () => {
  it('9433実測: FY2025 の EPS が一致しない → epsHistoryRestated: true', () => {
    const merged = mergeEdinetFilings({ latest: fy2026(), prior: fy2025() });
    expect(merged.epsHistoryRestated).toBe(true);
  });

  it('9433実測: FY2025 の売上収益が一致しない → revenueHistoryRestated: true', () => {
    const merged = mergeEdinetFilings({ latest: fy2026(), prior: fy2025() });
    expect(merged.revenueHistoryRestated).toBe(true);
  });

  it('9433実測: FY2022（1点）が一致していても、他の3点が不一致なら restated は解除しない', () => {
    // FY2022 = 最新の「四期前」(添字4)=15001 と 1年前の「三期前」(添字3)=15001 は一致するが、
    // 他の3点（FY2023/2024/2025）が不一致のため全体としては restated のまま
    const merged = mergeEdinetFilings({ latest: fy2026(), prior: fy2025() });
    expect(FY2026_EPS_SEN[4]).toBe(FY2025_EPS_SEN[3]); // この1点は一致する（実測どおり）
    expect(merged.epsHistoryRestated).toBe(true);
  });

  it('重複4期すべてが一致する銘柄では restated-history にならない（構成データ）', () => {
    // 実データに完全一致ペアが無いため、fy2026 側と重複4期がぴったり揃うよう構成した
    // prior を作る（latest 添字1..4 と prior 添字0..3 が一致するように配置）
    const matchingPrior: EdinetFilingYears = {
      fiscalYear: 2025,
      docId: 'CONSTRUCTED-MATCHING',
      // 添字0..3 = latest の添字1..4 と同じ値（添字4 は6期目にしか使わないので任意）
      epsSenByOffset: [
        FY2026_EPS_SEN[1],
        FY2026_EPS_SEN[2],
        FY2026_EPS_SEN[3],
        FY2026_EPS_SEN[4],
        1,
      ],
      revenueSenByOffset: [
        FY2026_REVENUE_SEN[1],
        FY2026_REVENUE_SEN[2],
        FY2026_REVENUE_SEN[3],
        FY2026_REVENUE_SEN[4],
        1,
      ],
    };
    const merged = mergeEdinetFilings({ latest: fy2026(), prior: matchingPrior });
    expect(merged.epsHistoryRestated).toBe(false);
    expect(merged.revenueHistoryRestated).toBe(false);
  });

  it('prior が無ければ比較できないので false（比較不能を「修正あり」に倒さない）', () => {
    const merged = mergeEdinetFilings({ latest: fy2026(), prior: null });
    expect(merged.epsHistoryRestated).toBe(false);
    expect(merged.revenueHistoryRestated).toBe(false);
  });

  it('EPS側だけ不一致・売上高側は一致 → 独立して判定する', () => {
    const matchingRevenuePrior: EdinetFilingYears = fy2025({
      // 売上高だけ latest と重複4期が一致するよう差し替える。EPS はそのまま（不一致のまま）
      revenueSenByOffset: [
        FY2026_REVENUE_SEN[1],
        FY2026_REVENUE_SEN[2],
        FY2026_REVENUE_SEN[3],
        FY2026_REVENUE_SEN[4],
        FY2025_REVENUE_SEN[4],
      ],
    });
    const merged = mergeEdinetFilings({ latest: fy2026(), prior: matchingRevenuePrior });
    expect(merged.epsHistoryRestated).toBe(true);
    expect(merged.revenueHistoryRestated).toBe(false);
  });

  it('片方が null の年は比較不能として飛ばす（他の3点で判定する）', () => {
    const merged = mergeEdinetFilings({
      latest: fy2026({ epsSenByOffset: [18359, null, 14175, 14915, 15001] }),
      prior: fy2025({ epsSenByOffset: [16933, 15063, 15550, 15001, 14208] }),
    });
    // 添字1が比較不能でも、添字2・3の不一致で restated のまま検出される
    expect(merged.epsHistoryRestated).toBe(true);
  });
});
