/**
 * ユースケース: EDINET docIDインデックスの日次バッチ本体。
 *
 * 仕様: `docs/02_design/logic/edinet-history-import.md` §4.4
 *
 * Cloudflare Workers の Cron Trigger（`src/index.ts` の `scheduled` ハンドラ）から呼ばれる。
 * `documents.json` を対象期間ぶん走査し、`EdinetDocumentIndexRepository.upsertMany()` を呼ぶ。
 *
 * **走査対象期間の絞り込み。** 登録済み企業の決算月一覧（`CompanyRepository.
 * listFiscalYearEndMonths()`）から、今日（JST基準で1日前）が「決算後3ヶ月目」の
 * 提出集中期間に当たるかを判定する。当たらない日は `documents.json` を叩かず
 * バッチを終える（§4.4・§2.2の実測: 3社とも決算後3ヶ月目に提出）。
 *
 * TODO(be-developer, 2026-08-08): `listFiscalYearEndMonths()` は現状「常に1〜12月すべて」を
 * 返す暫定実装（`CompanyRepository` のコメント参照）。そのため実質的にはこの絞り込みが
 * 毎日 true になり、日次バッチは実装上「毎日 `documents.json` を1回叩く」のとほぼ同じ動作になる。
 * 決算月の永続化が決まり次第、絞り込みが実際に効くようになる。
 */

import { type CompanyRepository } from '../domain/company/company-repository';
import {
  type EdinetDocumentsListError,
  type EdinetDocumentsListSource,
  type EdinetDocumentIndexRepository,
} from '../domain/company/edinet-document-index';
import { type Result, ok } from '../domain/shared/result';

export interface RefreshEdinetDocumentIndexDependencies {
  readonly documentsListSource: EdinetDocumentsListSource;
  readonly indexRepository: EdinetDocumentIndexRepository;
  /** 走査対象期間の絞り込みに登録済み企業の決算月一覧が要る（§4.4） */
  readonly companyRepository: Pick<CompanyRepository, 'listFiscalYearEndMonths'>;
  /** 現在時刻。テストから固定できるように注入する */
  readonly now: () => Date;
  /**
   * 走査する暦日（`YYYY-MM-DD`）を明示する。**過去日の一括バックフィル用**（§4.4 追記）。
   *
   * 指定した日は決算月の絞り込みを行わず**無条件に走査する**。呼び出し側が日付を選んで
   * いる以上、こちらで «その日は対象外» と判断する根拠が無いため。
   * 未指定なら日次バッチの既定（JST基準の1日前 + 決算月による絞り込み）。
   */
  readonly targetDate?: string;
}

export type RefreshEdinetDocumentIndexError = EdinetDocumentsListError;

export interface RefreshEdinetDocumentIndexResult {
  /** その日の `documents.json` を実際に取得したか（走査対象期間外ならスキップし `false`） */
  readonly scanned: boolean;
  readonly entryCount: number;
}

/** JST（UTC+9固定）での「1日前」の暦日（`YYYY-MM-DD`）を返す */
function jstDateStringOneDayBefore(now: Date): string {
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  jst.setUTCDate(jst.getUTCDate() - 1);
  const year = jst.getUTCFullYear();
  const month = String(jst.getUTCMonth() + 1).padStart(2, '0');
  const day = String(jst.getUTCDate()).padStart(2, '0');
  return `${String(year)}-${month}-${day}`;
}

/**
 * 決算月から「提出が集中する月」を導く。決算後3ヶ月目（提出期限の月）に固定する
 * （§2.2実測: 3社とも決算後3ヶ月目に提出。§4.4「3月決算企業なら6月1日〜6月30日」の一般化）。
 */
function filingWindowMonth(fiscalYearEndMonth: number): number {
  return ((fiscalYearEndMonth + 3 - 1) % 12) + 1;
}

function isWithinAnyFilingWindow(
  dateText: string,
  fiscalYearEndMonths: readonly number[],
): boolean {
  const month = Number(dateText.slice(5, 7));
  return fiscalYearEndMonths.some(
    (fiscalYearEndMonth) => filingWindowMonth(fiscalYearEndMonth) === month,
  );
}

async function scanDate(
  dependencies: RefreshEdinetDocumentIndexDependencies,
  date: string,
): Promise<Result<RefreshEdinetDocumentIndexResult, RefreshEdinetDocumentIndexError>> {
  const fetched = await dependencies.documentsListSource.fetchByDate(date);
  if (!fetched.ok) return fetched;

  await dependencies.indexRepository.upsertMany(fetched.value);
  await dependencies.indexRepository.recordRefresh(
    dependencies.now().toISOString(),
    fetched.value.length,
  );

  return ok({ scanned: true, entryCount: fetched.value.length });
}

export async function refreshEdinetDocumentIndex(
  dependencies: RefreshEdinetDocumentIndexDependencies,
): Promise<Result<RefreshEdinetDocumentIndexResult, RefreshEdinetDocumentIndexError>> {
  // 呼び出し側が日付を選んでいる（バックフィル）なら、決算月の絞り込みは挟まない
  if (dependencies.targetDate !== undefined) {
    return scanDate(dependencies, dependencies.targetDate);
  }

  const fiscalYearEndMonths = await dependencies.companyRepository.listFiscalYearEndMonths();
  const targetDate = jstDateStringOneDayBefore(dependencies.now());

  if (!isWithinAnyFilingWindow(targetDate, fiscalYearEndMonths)) {
    // 対象外の日でも「バッチは正常終了した」ことは記録する（§4.4・lastRefreshedAt の意味）
    await dependencies.indexRepository.recordRefresh(dependencies.now().toISOString(), 0);
    return ok({ scanned: false, entryCount: 0 });
  }

  return scanDate(dependencies, targetDate);
}
