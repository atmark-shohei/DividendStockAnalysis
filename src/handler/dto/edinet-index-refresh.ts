/**
 * docIDインデックスの日付指定リフレッシュ（`POST /api/admin/edinet/index/refresh`）の
 * クエリ検証と応答 DTO。
 *
 * 仕様: `docs/02_design/logic/edinet-history-import.md` §4.4「過去日の一括バックフィル」
 *
 * **管理用**。日次 Cron が拾えない過去日（既に提出済みの有価証券報告書）を
 * インデックスへ入れるために、外部のスクリプトから日付を1日ずつ指定して叩く。
 */

import { z } from 'zod';

import { type EdinetDocumentsListError } from '../../domain/company/edinet-document-index';
import { type RefreshEdinetDocumentIndexResult } from '../../usecase/refresh-edinet-document-index';

/**
 * `?date=2026-06-25` の検証。**実在する暦日であることまで見る。**
 *
 * 形式だけ見て通すと `2026-06-31` のような日付がそのまま EDINET へ渡り、
 * 「空の応答」と「存在しない日付」の区別がつかなくなる。
 */
export const refreshDateQuery = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    // `2026-06-31` は `2026-07-01` に繰り上がる。往復して一致するかで実在性を見る
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  });

export interface EdinetIndexRefreshResponse {
  readonly date: string;
  /** `documents.json` を実際に取得したか。日付指定なら常に `true` */
  readonly scanned: boolean;
  /** インデックスへ upsert した有価証券報告書の件数 */
  readonly entryCount: number;
}

export function toEdinetIndexRefreshResponse(
  date: string,
  result: RefreshEdinetDocumentIndexResult,
): EdinetIndexRefreshResponse {
  return { date, scanned: result.scanned, entryCount: result.entryCount };
}

interface EdinetIndexRefreshErrorResponse {
  readonly body: { readonly error: string };
  readonly status: 502;
}

/** 取得失敗はどちらも外部要因。`detail`（内部情報）はここで捨てる */
export function toEdinetIndexRefreshErrorResponse(
  error: EdinetDocumentsListError,
): EdinetIndexRefreshErrorResponse {
  switch (error.kind) {
    case 'authentication-failed':
      // 再実行しても直らない。設定を直す以外に次の行動が無いので、そう書く
      return {
        body: {
          error: 'EDINETの認証が通りませんでした。EDINET_API_KEY の設定を確認してください',
        },
        status: 502,
      };
    case 'source-unreachable':
    case 'malformed-response':
      return {
        body: {
          error: 'EDINETの書類一覧を取得できませんでした。時間をおいて同じ日付で再実行してください',
        },
        status: 502,
      };
  }
}
