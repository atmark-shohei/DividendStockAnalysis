import { fileURLToPath } from 'node:url';

import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

/**
 * infra（D1）と Worker 全体の結線テスト。**実際の workerd と D1 の上で走る。**
 *
 * マイグレーションはテスト実行前に読み込み、バインディング経由で渡す。
 * 「スキーマ変更はマイグレーションで行う」（`.claude/rules/backend.md`）を
 * テスト側でも守り、スキーマを手で組み立てない。
 *
 * ⚠️ vitest 4 対応版（pool-workers 0.18）から `defineWorkersProject` は廃止され、
 * `cloudflareTest()` プラグインを使う形になった。古い書き方の記事が多いので注意。
 */
export default defineConfig(async () => {
  const migrations = await readD1Migrations(
    fileURLToPath(new URL('./db/migrations', import.meta.url)),
  );

  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: './wrangler.jsonc' },
        miniflare: {
          bindings: { TEST_MIGRATIONS: migrations },
        },
      }),
    ],
    resolve: {
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
    test: {
      name: 'workers',
      include: ['tests/integration/**/*.test.ts'],
      setupFiles: ['./tests/integration/apply-migrations.ts'],
    },
  };
});
