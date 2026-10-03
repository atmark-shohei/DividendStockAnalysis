import type { ReactNode } from 'react';

/**
 * 各画面の見出しブロック（`docs/02_design/ui/components.md` §1 `<PageHeader>`）。
 *
 * 英字の eyebrow は画面の「索引ラベル」で、装飾として SR から隠す（見出しの読み上げを
 * 二重にしない）。画面名そのものは `<h2>` が担う。
 *
 * 表示専用。データ取得も判定もしない（`.claude/rules/frontend.md`）。
 */
export function PageHeader({
  eyebrow,
  title,
  lead,
  aside,
}: {
  /** 英字の索引ラベル（例: `01 — SCREENER`）。装飾扱い */
  readonly eyebrow: string;
  readonly title: string;
  /** 画面の目的を1〜2文で。無ければ `null` */
  readonly lead: string | null;
  /** 見出しの右側に置く補助要素（件数・カウンターなど） */
  readonly aside?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div className="page-header-text">
        <p className="page-eyebrow" aria-hidden="true">
          {eyebrow}
        </p>
        <h2 className="page-title">{title}</h2>
        {lead !== null && <p className="page-lead">{lead}</p>}
      </div>
      {aside !== undefined && <div className="page-header-aside">{aside}</div>}
    </header>
  );
}
