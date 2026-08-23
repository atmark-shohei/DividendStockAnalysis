/**
 * ポートフォリオIDの生成ポート。乱数（`crypto.getRandomValues`）は Web Crypto 依存であり
 * domain には置かない（`session-token-generator.ts` と同じ理由）。
 */
export interface PortfolioIdGenerator {
  /** `pf_` + 不透明な文字列を返す（例 `pf_1a2b3c4d5e6f7089`）。実装は infra 側 */
  generate(): string;
}
