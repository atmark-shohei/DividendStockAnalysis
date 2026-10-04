/**
 * `PasswordHasher` の Web Crypto 実装。PBKDF2-HMAC-SHA256（`crypto.subtle.deriveBits`）。
 *
 * `tests/integration/pbkdf2-iteration-benchmark.test.ts`（T-063）と同じ呼び出し形。
 * イテレーション数の実測・決定は `docs/adr/0013-multi-user-auth-small-scale.md` §決定3。
 *
 * ハッシュ・ソルトは16進文字列にエンコードして返す（`users.password_hash`/`password_salt`
 * は `text` カラムのため。バイト列を直接 `text` に入れない）。
 */

import { type PasswordCredential, type PasswordHasher } from '../../domain/auth/password-hasher';

const SALT_BYTES = 16;
const DERIVED_KEY_BITS = 256;

function toHex(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return Array.from(view, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

/**
 * 定数時間比較。`crypto.subtle.timingSafeEqual` は Workers に無いため自前で実装する。
 *
 * 単純な `===` は文字列比較の実装によっては早期リターンしうるため避ける
 * （ハッシュ値自体の総当たりへの実用的な脅威ではないが、念のため）。
 * 長さが違う場合は即座に不一致（ハッシュ長は固定なので、長さ自体は秘密情報ではない）。
 */
function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) {
    diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return diff === 0;
}

async function deriveHashHex(
  password: string,
  salt: Uint8Array,
  iterations: number,
): Promise<string> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const derived = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    keyMaterial,
    DERIVED_KEY_BITS,
  );
  return toHex(derived);
}

export class WebCryptoPasswordHasher implements PasswordHasher {
  async hash(password: string, iterations: number): Promise<PasswordCredential> {
    const saltBytes = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
    const salt = toHex(saltBytes);
    const hash = await deriveHashHex(password, saltBytes, iterations);
    return { hash, salt, iterations };
  }

  async verify(password: string, credential: PasswordCredential): Promise<boolean> {
    const saltBytes = fromHex(credential.salt);
    const computed = await deriveHashHex(password, saltBytes, credential.iterations);
    return timingSafeEqualHex(computed, credential.hash);
  }
}
