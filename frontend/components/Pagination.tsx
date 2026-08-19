/**
 * ページング UI（`docs/02_design/ui/components.md` §3 `<Pagination>`）。
 * 前後端で「← 前へ」「次へ →」が disabled（見た目・機能の両方）。
 */

/**
 * 総ページ数。`total===0` でも最小1ページ扱いにする（0ページは表示上成立しないため。
 * `perPage<=0` は既定の1ページ扱いでゼロ除算を避ける）。
 */
export function computePageCount(total: number, perPage: number): number {
  if (perPage <= 0) return 1;
  return Math.max(1, Math.ceil(total / perPage));
}

/** 先頭ページでは「← 前へ」を disabled にする */
export function isPrevDisabled(page: number): boolean {
  return page <= 1;
}

/** 最終ページでは「次へ →」を disabled にする */
export function isNextDisabled(page: number, pageCount: number): boolean {
  return page >= pageCount;
}

export function Pagination({
  page,
  pageCount,
  onChange,
}: {
  readonly page: number;
  readonly pageCount: number;
  readonly onChange: (page: number) => void;
}) {
  return (
    <nav className="pagination" aria-label="ページ切り替え">
      <button type="button" onClick={() => onChange(page - 1)} disabled={isPrevDisabled(page)}>
        ← 前へ
      </button>
      <span className="pagination-status numeric">
        {page} / {pageCount}
      </span>
      <button
        type="button"
        onClick={() => onChange(page + 1)}
        disabled={isNextDisabled(page, pageCount)}
      >
        次へ →
      </button>
    </nav>
  );
}
