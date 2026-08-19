/** セッション。Cookie の値そのものを `id`（不透明トークン）として持つ */
export interface Session {
  readonly id: string;
  readonly userId: number;
  /** UTC ISO 8601 */
  readonly expiresAt: string;
  /** UTC ISO 8601 */
  readonly createdAt: string;
}
