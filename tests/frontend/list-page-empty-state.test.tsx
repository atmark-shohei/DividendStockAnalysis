import { describe, expect, it } from 'vitest';

import { emptyStateContent } from '../../frontend/pages/ListPage';

/**
 * 検索一覧の空状態の見出し・補助文の出し分け（`docs/02_design/ui/pages/search-page.md` §5）。
 * `@testing-library/react` 未導入のため、`ListPage.tsx` から切り出した純粋関数を直接テストする
 * （`tests/frontend/nav-bar.test.tsx` と同じ方針）。
 */
describe('emptyStateContent', () => {
  it('q が空文字なら「保存された銘柄がありません」（補助文なし）', () => {
    expect(emptyStateContent('')).toEqual({
      heading: '保存された銘柄がありません',
      description: null,
    });
  });

  it('q が空白のみなら trim して空扱いにする', () => {
    expect(emptyStateContent('   ')).toEqual({
      heading: '保存された銘柄がありません',
      description: null,
    });
  });

  it('q が非空なら検索語を見出しに含め、補助文を付ける', () => {
    expect(emptyStateContent('トヨタ')).toEqual({
      heading: '「トヨタ」に一致する銘柄はありません',
      description: '検索語を変えるか、コードで検索してください',
    });
  });

  it('q の前後の空白は見出しに含めない（trim する）', () => {
    expect(emptyStateContent('  7203  ')).toEqual({
      heading: '「7203」に一致する銘柄はありません',
      description: '検索語を変えるか、コードで検索してください',
    });
  });

  it('q に記号・日本語を含む場合もそのまま見出しに埋め込む', () => {
    expect(emptyStateContent('東京<script>')).toEqual({
      heading: '「東京<script>」に一致する銘柄はありません',
      description: '検索語を変えるか、コードで検索してください',
    });
  });
});
