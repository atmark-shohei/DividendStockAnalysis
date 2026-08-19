/**
 * セッショントークン生成のポート。乱数（`crypto.getRandomValues`）も
 * Web Crypto 依存であり domain には置かない（`password-hasher.ts` と同じ理由）。
 */
export interface SessionTokenGenerator {
  /** 不透明・推測不能なセッショントークンを生成する */
  generate(): string;
}
