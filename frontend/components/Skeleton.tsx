/**
 * 一覧のロード中プレースホルダ（`docs/02_design/ui/pages/search-page.md` §6）。
 * テーブルと同じ行高・列幅の想定でダミー行を並べ、実データ取得後にレイアウトが飛ばないようにする。
 */
export function Skeleton({ rows }: { readonly rows: number }) {
  return (
    <div className="skeleton" role="status" aria-live="polite" aria-label="読み込み中">
      {Array.from({ length: rows }, (_unused, index) => (
        // 静的なプレースホルダ行。実データの識別子を持たないため index キーで問題ない
        <div key={index} className="skeleton-row" />
      ))}
    </div>
  );
}
