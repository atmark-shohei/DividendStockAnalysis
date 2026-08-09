import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  type EdinetDocumentsListEntry,
  parseDocumentsListResponse,
  toDocumentIndexEntries,
} from '@/infra/edinet/parse-documents-list';

/**
 * `documents.json` 応答のパース・docIDインデックスへの変換。
 * 仕様: `docs/02_design/logic/edinet-history-import.md` §4.4・§7.3
 *
 * `tests/fixtures/edinet/documents-list-sample.json` は `results` 配列の1件を
 * `tmp/edinet-verify/candidates.json`（実測レスポンス）からそのまま採用したもの。
 * `metadata` 包み（envelope）は実測データに含まれていなかったため、実測の
 * `results` 部分だけが実物で、`metadata` はEDINET API仕様書の一般的な形を模した
 * 合理的な推測（本テストでは `results` の扱いにしか影響しない）。
 * 複数書類・取下げ・重複提出などのケースは実データに存在しないため（§6明記）、
 * 同じフィールド構成の構成データをテスト内で組み立てる。
 */

function fixtureJson(): unknown {
  const text = readFileSync(
    fileURLToPath(new URL('../../fixtures/edinet/documents-list-sample.json', import.meta.url)),
    'utf8',
  );
  return JSON.parse(text) as unknown;
}

function entry(overrides: Partial<EdinetDocumentsListEntry> = {}): EdinetDocumentsListEntry {
  return {
    docId: 'S100YKG2',
    secCode: '94330',
    formCode: '030000',
    periodEnd: '2026-03-31',
    submitDateTime: '2026-06-25 15:30',
    withdrawalStatus: '0',
    ...overrides,
  };
}

describe('parseDocumentsListResponse — 実物フィクスチャ', () => {
  it('results 配列の1件を EdinetDocumentsListEntry に正規化する', () => {
    const result = parseDocumentsListResponse(fixtureJson());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual([
      {
        docId: 'S100YKG2',
        secCode: '94330',
        formCode: '030000',
        periodEnd: '2026-03-31',
        submitDateTime: '2026-06-25 15:30',
        withdrawalStatus: '0',
      },
    ]);
  });
});

describe('parseDocumentsListResponse — 異常系', () => {
  it('ルートがオブジェクトでなければ malformed-response', () => {
    const result = parseDocumentsListResponse('not an object');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('malformed-response');
  });

  it('results が配列でなければ malformed-response', () => {
    const result = parseDocumentsListResponse({ results: 'not-an-array' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('malformed-response');
  });

  it('docID が無いエントリは飛ばす（例外にしない）', () => {
    const result = parseDocumentsListResponse({ results: [{ secCode: '94330' }] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual([]);
  });

  it('results が空配列なら空配列を返す', () => {
    const result = parseDocumentsListResponse({ results: [] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual([]);
  });
});

describe('toDocumentIndexEntries — §7.3 受入基準', () => {
  it('formCode="030000" のみ候補にする', () => {
    const entries = toDocumentIndexEntries([
      entry({ docId: 'A', formCode: '030000' }),
      entry({ docId: 'B', formCode: '140000' }), // 半期報告書等（構成データ）
    ]);
    expect(entries.map((e) => e.docId)).toEqual(['A']);
  });

  it('withdrawalStatus === "1"（取下げ）は除外する（構成データ。実データに取下げ例なし）', () => {
    const entries = toDocumentIndexEntries([entry({ docId: 'A', withdrawalStatus: '1' })]);
    expect(entries).toEqual([]);
  });

  it('secCode → companyCode 変換（末尾チェックディジット0の5桁 → 先頭4桁）', () => {
    const entries = toDocumentIndexEntries([entry()]);
    expect(entries[0]?.companyCode).toBe('9433');
  });

  it('secCode の形式が想定と異なる（末尾が0以外）場合はそのエントリを飛ばす（例外にしない）', () => {
    const entries = toDocumentIndexEntries([entry({ secCode: '94331' })]);
    expect(entries).toEqual([]);
  });

  it('secCode が null なら飛ばす', () => {
    const entries = toDocumentIndexEntries([entry({ secCode: null })]);
    expect(entries).toEqual([]);
  });

  it('periodEnd から決算年度を導く（先頭4桁）', () => {
    const entries = toDocumentIndexEntries([entry({ periodEnd: '2026-03-31' })]);
    expect(entries[0]?.fiscalYear).toBe(2026);
  });

  it('submitDateTime（JST）をUTCのISO8601へ変換する', () => {
    const entries = toDocumentIndexEntries([entry({ submitDateTime: '2026-06-25 15:30' })]);
    // JST 2026-06-25 15:30 = UTC 2026-06-25 06:30
    expect(entries[0]?.submittedAt).toBe('2026-06-25T06:30:00.000Z');
  });

  it('同一 (companyCode, fiscalYear) に複数の030000書類 → submitDateTime が最新のものを採用する（構成データ）', () => {
    const entries = toDocumentIndexEntries([
      entry({ docId: 'OLD', submitDateTime: '2026-06-20 10:00' }),
      entry({ docId: 'NEW', submitDateTime: '2026-06-25 15:30' }),
    ]);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.docId).toBe('NEW');
  });

  it('採用順が逆でも最新が残る（配列順に依存しない）', () => {
    const entries = toDocumentIndexEntries([
      entry({ docId: 'NEW', submitDateTime: '2026-06-25 15:30' }),
      entry({ docId: 'OLD', submitDateTime: '2026-06-20 10:00' }),
    ]);
    expect(entries[0]?.docId).toBe('NEW');
  });

  it('periodEnd が読めないエントリは飛ばす', () => {
    const entries = toDocumentIndexEntries([entry({ periodEnd: null })]);
    expect(entries).toEqual([]);
  });

  it('submitDateTime が読めないエントリは飛ばす', () => {
    const entries = toDocumentIndexEntries([entry({ submitDateTime: null })]);
    expect(entries).toEqual([]);
  });
});
