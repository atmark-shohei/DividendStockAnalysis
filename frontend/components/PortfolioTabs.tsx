import type { PortfolioSummary } from '../api';

/**
 * ポートフォリオ切替のピル状タブ列＋「＋ 追加」＋件数表示
 * （`docs/02_design/ui/pages/portfolio-page.md` §3）。
 *
 * `NavBar.tsx` と同じ `<button>` の集合方式にする（§9「ポートフォリオ切替タブは
 * role="tablist"/role="tab" または <button> の集合」の後者を選択。`div`+`onClick` にしない）。
 */
export function PortfolioTabs({
  portfolios,
  activeId,
  maxPortfolios,
  onSelect,
  onAdd,
  canAdd,
}: {
  readonly portfolios: readonly PortfolioSummary[];
  readonly activeId: string | null;
  readonly maxPortfolios: number;
  readonly onSelect: (id: string) => void;
  readonly onAdd: () => void;
  /** 10個未満のときだけ活性（§3「上限到達時はボタン自体を無効化」） */
  readonly canAdd: boolean;
}) {
  return (
    <div className="portfolio-tabs">
      {portfolios.map((portfolio) => (
        <button
          key={portfolio.id}
          type="button"
          aria-current={portfolio.id === activeId ? 'true' : undefined}
          onClick={() => {
            onSelect(portfolio.id);
          }}
        >
          {portfolio.name}
        </button>
      ))}
      <button type="button" className="portfolio-tabs-add" onClick={onAdd} disabled={!canAdd}>
        ＋ 追加
      </button>
      <span className="meta numeric">
        {portfolios.length} / {maxPortfolios}
      </span>
    </div>
  );
}
