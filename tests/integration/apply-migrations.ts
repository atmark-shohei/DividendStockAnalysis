import { applyD1Migrations, env } from 'cloudflare:test';
import { beforeAll } from 'vitest';

/**
 * テスト用 D1 にマイグレーションを適用する。
 *
 * スキーマをテスト側で手書きしない。手書きすると本番のマイグレーションと
 * ずれても気付けず、「テストは通るが本番で落ちる」状態になる。
 */
beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});
