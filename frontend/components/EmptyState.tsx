/**
 * 検索0件・登録0件の空状態カード（破線枠、`docs/02_design/ui/pages/search-page.md` §5）。
 *
 * 文言の出し分け（q の有無）は呼び出し側（`ListPage.tsx` の `emptyStateContent`）が決める。
 * このコンポーネントは受け取った文言を描画するだけ。
 */

export interface EmptyStateCta {
  readonly label: string;
  readonly onClick: () => void;
}

export function EmptyState({
  heading,
  description,
  cta,
}: {
  readonly heading: string;
  readonly description: string | null;
  /** admin にのみ「銘柄登録」への誘導を出す（Manager決定。guest/user には出さない） */
  readonly cta?: EmptyStateCta;
}) {
  return (
    <div className="empty-state">
      <p className="empty-state-heading">{heading}</p>
      {description !== null && <p className="empty-state-description">{description}</p>}
      {cta !== undefined && (
        <button type="button" onClick={cta.onClick}>
          {cta.label}
        </button>
      )}
    </div>
  );
}
