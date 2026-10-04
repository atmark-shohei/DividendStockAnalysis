/**
 * 評価基準タブ（T-099）専用の「自動計算済／未実装」バッジ。
 *
 * `<RoleBadge>`（`RoleBadge.tsx`）とは意味が違う（権限 vs 実装状態）ため流用しない
 * （`RoleBadge.tsx` のコメント「色の役割の排他ルールを型で守るための分離」と同じ方針）。
 *
 * 配色は CSS 側（`.implementation-badge[data-status]`）で出し分ける。
 * **色だけで区別せず、必ず文言を出す**（`criteria-tab.md` §2.2）。
 */
export function implementationBadgeLabel(implemented: boolean): string {
  return implemented ? '自動計算済' : '未実装';
}

export function ImplementationBadge({ implemented }: { readonly implemented: boolean }) {
  return (
    <span className="implementation-badge" data-status={implemented ? 'done' : 'pending'}>
      {implementationBadgeLabel(implemented)}
    </span>
  );
}
