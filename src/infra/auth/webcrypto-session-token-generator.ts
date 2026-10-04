/**
 * `SessionTokenGenerator` の Web Crypto 実装。
 * `crypto.getRandomValues(32bytes)` を16進文字列化する（256bit相当のエントロピー）。
 */

import { type SessionTokenGenerator } from '../../domain/auth/session-token-generator';

const TOKEN_BYTES = 32;

export class WebCryptoSessionTokenGenerator implements SessionTokenGenerator {
  generate(): string {
    const bytes = crypto.getRandomValues(new Uint8Array(TOKEN_BYTES));
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  }
}
