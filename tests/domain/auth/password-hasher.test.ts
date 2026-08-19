import { describe, expect, it } from 'vitest';

import { PBKDF2_ITERATIONS } from '@/domain/auth/hash-policy';
import { DUMMY_PASSWORD_CREDENTIAL } from '@/domain/auth/password-hasher';

/**
 * `DUMMY_PASSWORD_CREDENTIAL`（タイミング攻撃対策用のダミー資格情報。
 * `docs/02_design/api/auth-api.md` §タイミング攻撃対策）の形が壊れていないことを見る回帰テスト。
 *
 * - `salt` は 16進文字列であること（BEレビュー CR-2。`WebCryptoPasswordHasher.verify()` が
 *   `fromHex()` で読む契約）
 * - `iterations` は `PBKDF2_ITERATIONS` を複製したマジックナンバーに戻っていないこと（CR-3）
 */
describe('DUMMY_PASSWORD_CREDENTIAL', () => {
  it('salt は16進文字列（0-9a-f）である', () => {
    expect(DUMMY_PASSWORD_CREDENTIAL.salt).toMatch(/^[0-9a-f]+$/);
  });

  it('salt は実際のソルト長（16バイト=32桁）と一致する', () => {
    expect(DUMMY_PASSWORD_CREDENTIAL.salt).toHaveLength(32);
  });

  it('iterations は PBKDF2_ITERATIONS と同じ値である（固定値に戻っていないこと）', () => {
    expect(DUMMY_PASSWORD_CREDENTIAL.iterations).toBe(PBKDF2_ITERATIONS);
  });
});
