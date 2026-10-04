/**
 * ヘッダーの「管理者」バッジ専用。常に `--color-caution`（`design-tokens.md` §2.2）。
 *
 * `<Badge>`（`docs/02_design/ui/components.md` §5）とは別コンポーネントにしてある。
 * `<Badge>` は文言に応じて色が変わりうるが、`<RoleBadge>` は「ユーザーの権限」という
 * 1つの意味にしか使わない。色の役割の排他ルールを型で守るための分離（同 §5）。
 */
export function RoleBadge({ role }: { readonly role: 'admin' }) {
  // 現状 'admin' 固定。将来ロールが増えたときに文言を分岐する余地として引数化してある
  return (
    <span className="role-badge" data-role={role}>
      管理者
    </span>
  );
}
