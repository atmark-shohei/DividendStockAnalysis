/**
 * EDINET の2本の有報（最新＋1年前）から、6期分の EPS・売上高履歴を組み立て、
 * 重複4期の突き合わせで遡及修正を検出する。**純粋関数。**
 *
 * 仕様: `docs/02_design/logic/edinet-history-import.md` §4.3・§4.5・§7.2
 *
 * 突き合わせの対応関係（§4.3）:
 *
 * | 決算年度 | 最新有報の相対年度 | 1年前有報の相対年度 |
 * | :------- | :------------------ | :-------------------- |
 * | FY(latest-4) | 四期前（添字4） | 三期前（添字3） |
 * | FY(latest-3) | 三期前（添字3） | 前々期（添字2） |
 * | FY(latest-2) | 前々期（添字2） | 前期（添字1） |
 * | FY(latest-1) | 前期（添字1） | 当期（添字0） |
 *
 * つまり `latest` の添字 `o`（1〜4）と `prior` の添字 `o-1`（0〜3）が同じ決算年度を指す。
 */

import { type EdinetHistoryYear } from './edinet-history-source';

/** 1本の有報から読んだ5期分（添字0=当期 〜 4=四期前） */
export interface EdinetFilingYears {
  /** その有報の「当期」の決算年度 */
  readonly fiscalYear: number;
  readonly docId: string;
  /** 添字0=当期 〜 4=四期前。銭。取れなければ `null` */
  readonly epsSenByOffset: readonly (number | null)[];
  /** 同上 */
  readonly revenueSenByOffset: readonly (number | null)[];
}

export interface MergeEdinetFilingsInput {
  readonly latest: EdinetFilingYears;
  /** 1年前に提出された有報。無ければ `null`（6期目が埋まらず、遡及修正も判定できない） */
  readonly prior: EdinetFilingYears | null;
}

export interface MergedEdinetFilings {
  /** 年度降順。`prior` が無ければ最大5件、あれば最大6件 */
  readonly years: readonly EdinetHistoryYear[];
  /** ④用。比較できなければ `false`（§5） */
  readonly epsHistoryRestated: boolean;
  /** ⑦用。同上 */
  readonly revenueHistoryRestated: boolean;
}

const OFFSET_COUNT = 5;

/** 重複4期の突き合わせ。`latest` 添字 1〜4 と `prior` 添字 0〜3 を比較する */
function detectRestatement(
  latestByOffset: readonly (number | null)[],
  priorByOffset: readonly (number | null)[] | null,
): boolean {
  if (priorByOffset === null) return false; // 比較できなければ false（§5）

  for (let latestOffset = 1; latestOffset <= 4; latestOffset += 1) {
    const priorOffset = latestOffset - 1;
    const latestValue = latestByOffset[latestOffset] ?? null;
    const priorValue = priorByOffset[priorOffset] ?? null;
    // 片方が null なら比較不能。その点は判定に寄与しない（他の3点で判定する）
    if (latestValue === null || priorValue === null) continue;
    if (latestValue !== priorValue) return true;
  }
  return false;
}

export function mergeEdinetFilings(input: MergeEdinetFilingsInput): MergedEdinetFilings {
  const { latest, prior } = input;

  const years: EdinetHistoryYear[] = [];
  for (let offset = 0; offset < OFFSET_COUNT; offset += 1) {
    years.push({
      fiscalYear: latest.fiscalYear - offset,
      epsSen: latest.epsSenByOffset[offset] ?? null,
      revenueSen: latest.revenueSenByOffset[offset] ?? null,
      sourceDocId: latest.docId,
    });
  }

  // 6期目（五期前）は 1年前有報の「四期前」（添字4）から採る（§2.4・§4.5 手順4）
  if (prior !== null) {
    years.push({
      fiscalYear: prior.fiscalYear - 4,
      epsSen: prior.epsSenByOffset[4] ?? null,
      revenueSen: prior.revenueSenByOffset[4] ?? null,
      sourceDocId: prior.docId,
    });
  }

  return {
    years,
    epsHistoryRestated: detectRestatement(latest.epsSenByOffset, prior?.epsSenByOffset ?? null),
    revenueHistoryRestated: detectRestatement(
      latest.revenueSenByOffset,
      prior?.revenueSenByOffset ?? null,
    ),
  };
}
