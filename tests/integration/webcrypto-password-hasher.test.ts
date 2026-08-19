import { describe, expect, it } from 'vitest';

import { WebCryptoPasswordHasher } from '@/infra/auth/webcrypto-password-hasher';

/**
 * `WebCryptoPasswordHasher` — PBKDF2-HMAC-SHA256 の実装確認。
 * `crypto.subtle` は Workers ランタイム依存のため workers 系統で実行する
 * （`tests/integration/pbkdf2-iteration-benchmark.test.ts` と同じ扱い）。
 */

const ITERATIONS = 10_000;

describe('hash', () => {
  it('同一パスワードでも、ソルトが毎回異なるためハッシュも異なる', async () => {
    const hasher = new WebCryptoPasswordHasher();
    const a = await hasher.hash('correct horse battery staple', ITERATIONS);
    const b = await hasher.hash('correct horse battery staple', ITERATIONS);

    expect(a.salt).not.toBe(b.salt);
    expect(a.hash).not.toBe(b.hash);
  });

  it('ハッシュ・ソルトは16進文字列（[0-9a-f]+）で返る', async () => {
    const hasher = new WebCryptoPasswordHasher();
    const credential = await hasher.hash('password', ITERATIONS);

    expect(credential.hash).toMatch(/^[0-9a-f]+$/);
    expect(credential.salt).toMatch(/^[0-9a-f]+$/);
    // SHA-256 の 256bit = 32byte = 64桁の16進
    expect(credential.hash).toHaveLength(64);
  });

  it('iterations を戻り値にそのまま含める', async () => {
    const hasher = new WebCryptoPasswordHasher();
    const credential = await hasher.hash('password', ITERATIONS);
    expect(credential.iterations).toBe(ITERATIONS);
  });
});

describe('verify', () => {
  it('正しいパスワードは true', async () => {
    const hasher = new WebCryptoPasswordHasher();
    const credential = await hasher.hash('correct horse battery staple', ITERATIONS);

    expect(await hasher.verify('correct horse battery staple', credential)).toBe(true);
  });

  it('誤ったパスワードは false', async () => {
    const hasher = new WebCryptoPasswordHasher();
    const credential = await hasher.hash('correct horse battery staple', ITERATIONS);

    expect(await hasher.verify('wrong password', credential)).toBe(false);
  });

  it('hash → verify の往復が一貫する（複数パスワードで確認）', async () => {
    const hasher = new WebCryptoPasswordHasher();
    for (const password of ['a', 'p@ssw0rd!', '日本語パスワード', 'x'.repeat(128)]) {
      const credential = await hasher.hash(password, ITERATIONS);
      expect(await hasher.verify(password, credential)).toBe(true);
    }
  });
});
