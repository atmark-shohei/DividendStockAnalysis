import { describe, expect, it } from 'vitest';

import * as domainConstants from '@/domain/company/import-review';
import * as infraConstants from '@/infra/irbank/parse-fy-data';

/**
 * `src/domain/company/import-review.ts` と `src/infra/irbank/parse-fy-data.ts` は
 * ブロック名・列名の定数を独立に持っている（domain は infra を import できないため。
 * `.claude/CLAUDE.md` 依存ルール）。この重複が黙って食い違わないことを検査する。
 *
 * code-reviewer 指摘（2026-07-30）: どちらか片方だけを直すと `resolveField` が
 * 対応する欄を見つけられなくなり、警告が静かに `field: null`（行外）へ落ちるが、
 * 双方が自分のローカルな文字列でテストしているため既存テストでは検出できない。
 */
describe('domain と infra の区画名・列名が一致している', () => {
  it.each([
    ['BLOCK_PERFORMANCE', domainConstants.BLOCK_PERFORMANCE, infraConstants.BLOCK_PERFORMANCE],
    ['BLOCK_DIVIDEND', domainConstants.BLOCK_DIVIDEND, infraConstants.BLOCK_DIVIDEND],
    ['COLUMN_EPS', domainConstants.COLUMN_EPS, infraConstants.COLUMN_EPS],
    ['COLUMN_ROE', domainConstants.COLUMN_ROE, infraConstants.COLUMN_ROE],
    ['COLUMN_REVENUE', domainConstants.COLUMN_REVENUE, infraConstants.COLUMN_REVENUE],
    [
      'COLUMN_DIVIDEND_PER_SHARE',
      domainConstants.COLUMN_DIVIDEND_PER_SHARE,
      infraConstants.COLUMN_DIVIDEND_PER_SHARE,
    ],
  ])('%s', (_name, domainValue, infraValue) => {
    expect(domainValue).toBe(infraValue);
  });
});
