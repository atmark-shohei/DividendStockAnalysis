import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { unzipSummaryCsv } from '@/infra/edinet/unzip-edinet-document';

/**
 * ZIP展開・ファイル選択・UTF-16デコード。
 * 仕様: `docs/02_design/logic/edinet-history-import.md` §0（実装時の発見）・§2.3・§7.5
 *
 * フィクスチャは実物（`documents/S100YKG2?type=5` の応答そのもの）から作る
 * （`.claude/rules/backend.md`「モックのレスポンスは実物のサンプルから作る」）。
 */

function fixtureBytes(name: string): Uint8Array {
  const buffer = readFileSync(
    fileURLToPath(new URL(`../../fixtures/edinet/${name}`, import.meta.url)),
  );
  return new Uint8Array(buffer);
}

describe('unzipSummaryCsv — 実物ZIP', () => {
  it('複数CSVの中から jpcrp030000-asr- で始まるファイルだけを選ぶ', () => {
    const result = unzipSummaryCsv(fixtureBytes('S100YKG2.zip'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // UTF-16(BOM付き)からデコードされ、ヘッダ行のタブ区切りテキストとして読める
    expect(result.value).toContain('要素ID');
    expect(result.value).toContain(
      'jpcrp_cor:BasicEarningsLossPerShareIFRSSummaryOfBusinessResults',
    );
    // 監査報告書系（jpaud-*）の内容は含まれない
    expect(result.value).not.toContain('jpaud-aai-cc-001');
  });

  it('BOM を含めてデコードする（本文の先頭に残らない）', () => {
    const result = unzipSummaryCsv(fixtureBytes('S100YKG2.zip'));
    if (!result.ok) throw new Error('展開に失敗した');
    expect(result.value.charCodeAt(0)).not.toBe(0xfeff);
  });
});

describe('unzipSummaryCsv — 異常系', () => {
  it('ZIPとして壊れたバイト列は malformed-response', () => {
    const result = unzipSummaryCsv(new Uint8Array([0x00, 0x01, 0x02, 0x03]));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('malformed-response');
  });

  it('空のZIPは csv-not-found', () => {
    // fflate の unzipSync は空バイト列でも例外にせず空オブジェクトを返しうる。
    // 有効なZIP形式だが対象ファイルが無いケースを別途確認する
    const emptyZip = new Uint8Array([
      0x50, 0x4b, 0x05, 0x06, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ]);
    const result = unzipSummaryCsv(emptyZip);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('csv-not-found');
  });

  // CR-12: 実運用で到達しうる「有効なZIPだが対象CSVが無い」を実物バイト列ベースの
  // 構成フィクスチャで検証する。`S100YKG2.zip`（実物）から `jpcrp030000-asr-*` だけを
  // 除いた構成（監査報告書系 `jpaud-*` の2ファイルのみ、生バイト列は実物のまま）。
  it('有効なZIPだが対象CSV（jpcrp030000-asr-*）が無い → csv-not-found（監査報告書系のみのZIPで確認）', () => {
    const result = unzipSummaryCsv(fixtureBytes('S100YKG2-no-asr.zip'));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('csv-not-found');
  });
});
