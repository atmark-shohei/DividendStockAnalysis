import { describe, expect, it } from 'vitest';

/**
 * 開発環境の疎通確認（T-013）。
 * ドメインロジックのテストが入り次第、この 2 本目以降に置き換えていく。
 */
describe('test environment', () => {
  it('runs a test', () => {
    expect(1 + 1).toBe(2);
  });

  it('supports async tests', async () => {
    await expect(Promise.resolve('ok')).resolves.toBe('ok');
  });

  it('runs on Node 20 or newer', () => {
    const major = Number(process.versions.node.split('.')[0]);
    expect(major).toBeGreaterThanOrEqual(20);
  });
});
