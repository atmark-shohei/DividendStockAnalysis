/**
 * EDINET の2〜3本の有報（最新＋1年前＋Y-3）から、6期分の EPS・売上高履歴を組み立て、
 * 重複4期の突き合わせで遡及修正を検出する。あわせて⑧営業利益率を5期分（Y〜Y-4）導出する。
 * **純粋関数。**
 *
 * 仕様: `docs/02_design/logic/edinet-history-import.md` §4.3・§4.5・§4.7.1・§4.7.2・§4.7.3・§7.2・§7.7
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

import { deriveOperatingMarginPercent } from './operating-margin';
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
  /**
   * ⑤用。添字0=当期 〜 4=四期前。**%**（自算値。§4.1.1）。取れなければ `null`。
   *
   * **遡及修正検出（`detectRestatement`）の対象にしない。** ROE は ④⑦ 専用の
   * `restated-history` とは別軸で、EDINET公表ROE列自体を読まない自算値のため
   * 突き合わせの意味を持たない（§7.2 対象外）。
   */
  readonly roePercentByOffset: readonly (number | null)[];
  /**
   * ⑧用（T-055追加）。添字0=当期・1=前期のみ（長さ2固定）。銭。取れなければ `null`。
   * `deriveOperatingMarginPercent()` へ渡す分子。突き合わせ（`detectRestatement`）の対象外
   * （営業利益率は書類ごとに独立して導出するため。§4.7.2）
   */
  readonly operatingIncomeSenByOffset: readonly (number | null)[];
}

export interface MergeEdinetFilingsInput {
  readonly latest: EdinetFilingYears;
  /** 1年前に提出された有報。無ければ `null`（6期目が埋まらず、遡及修正も判定できない） */
  readonly prior: EdinetFilingYears | null;
  /**
   * ⑧用（T-055追加）。`Y-3`に提出された有報。無ければ `null`。
   * `Y-3`・`Y-4`の営業利益率が埋まらないだけで、他の指標（EPS・売上高・ROE・遡及修正判定）
   * には影響しない（§4.7.1）。
   */
  readonly third: EdinetFilingYears | null;
}

export interface MergedEdinetFilings {
  /** 年度降順。`prior` が無ければ最大5件、あれば最大6件 */
  readonly years: readonly EdinetHistoryYear[];
  /** ④用。比較できなければ `false`（§5） */
  readonly epsHistoryRestated: boolean;
  /** ⑦用。同上 */
  readonly revenueHistoryRestated: boolean;
}

/** `operatingMarginPercentAt` の offset 引数と1対1（CR-4）。要素数を変えたら両方直す */
const OFFSETS = [0, 1, 2, 3, 4] as const;

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

/**
 * 1本の有報の offset0（当期）・offset1（前期）ぶんの営業利益率を導出する
 * （`deriveOperatingMarginPercent`。分子・分母とも同じ有報の同じ offset から取る。
 * 書類をまたいだ組み合わせをしない。§4.7.2）。
 */
function marginAt(filing: EdinetFilingYears | null, offset: 0 | 1): number | null {
  if (filing === null) return null;
  return deriveOperatingMarginPercent(
    filing.operatingIncomeSenByOffset[offset] ?? null,
    filing.revenueSenByOffset[offset] ?? null,
  );
}

/**
 * 年度（`years`配列の添字。0=Y 〜 4=Y-4）ごとの営業利益率の導出元（§4.7.2の表）。
 *
 * `Y-1`（添字1）は `prior`（`Y-1`有報の offset0）ではなく `latest`（`Y`有報の offset1）から
 * 導出する。設計書 §4.7.1・§7.7 は「`Y-1`の有報の取得が失敗した場合、⑧は`Y-2`が欠けるため
 * `null`になる」と明言しており、`Y-1`年度自体はnullにならないと読める。もし`Y-1`年度の
 * 営業利益率が`prior`からも導出される設計なら、`prior`取得失敗時に`Y-1`もnullになるはずだが
 * そうならない。したがって`Y-1`年度の営業利益率は`latest`のoffset1からのみ導出する
 * （EPS・売上高が`prior`のoffset0-3を遡及修正の突き合わせにしか使わず、`years[]`本体には
 * `latest`側しか使わないのと同じ構造）。
 */
function operatingMarginPercentAt(
  offset: 0 | 1 | 2 | 3 | 4,
  latest: EdinetFilingYears,
  prior: EdinetFilingYears | null,
  third: EdinetFilingYears | null,
): number | null {
  switch (offset) {
    case 0:
      return marginAt(latest, 0);
    case 1:
      return marginAt(latest, 1);
    case 2:
      return marginAt(prior, 1);
    case 3:
      return marginAt(third, 0);
    case 4:
      return marginAt(third, 1);
    default: {
      // `OFFSETS` を変更しない限り到達しない。到達したらコンパイルエラーで検出する
      // （CR-4）。`0|1|2|3|4` を網羅していれば `offset` はここで `never` になる
      const exhaustive: never = offset;
      return exhaustive;
    }
  }
}

export function mergeEdinetFilings(input: MergeEdinetFilingsInput): MergedEdinetFilings {
  const { latest, prior, third } = input;

  const years: EdinetHistoryYear[] = [];
  for (const offset of OFFSETS) {
    years.push({
      fiscalYear: latest.fiscalYear - offset,
      epsSen: latest.epsSenByOffset[offset] ?? null,
      revenueSen: latest.revenueSenByOffset[offset] ?? null,
      roePercent: latest.roePercentByOffset[offset] ?? null,
      sourceDocId: latest.docId,
      operatingMarginPercent: operatingMarginPercentAt(offset, latest, prior, third),
    });
  }

  // 6期目（五期前）は 1年前有報の「四期前」（添字4）から採る（§2.4・§4.5 手順4）。
  // ⑧は設計書の対象外（Y〜Y-4の5期のみ。§4.7.1）のため常に null
  if (prior !== null) {
    years.push({
      fiscalYear: prior.fiscalYear - 4,
      epsSen: prior.epsSenByOffset[4] ?? null,
      revenueSen: prior.revenueSenByOffset[4] ?? null,
      roePercent: prior.roePercentByOffset[4] ?? null,
      sourceDocId: prior.docId,
      operatingMarginPercent: null,
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
