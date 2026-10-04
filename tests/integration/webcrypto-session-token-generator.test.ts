import { describe, expect, it } from 'vitest';

import { WebCryptoSessionTokenGenerator } from '@/infra/auth/webcrypto-session-token-generator';

describe('WebCryptoSessionTokenGenerator', () => {
  it('16進文字列（[0-9a-f]+）を返す', () => {
    const generator = new WebCryptoSessionTokenGenerator();
    expect(generator.generate()).toMatch(/^[0-9a-f]+$/);
  });

  it('32byte（256bit）相当の長さ = 64桁の16進文字列', () => {
    const generator = new WebCryptoSessionTokenGenerator();
    expect(generator.generate()).toHaveLength(64);
  });

  it('生成のたびに異なる値になる（実測的に一意性を確認）', () => {
    const generator = new WebCryptoSessionTokenGenerator();
    const tokens = new Set(Array.from({ length: 100 }, () => generator.generate()));
    expect(tokens.size).toBe(100);
  });
});
