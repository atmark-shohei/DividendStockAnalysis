import { defineConfig } from 'vitest/config';

/**
 * テストは2系統に分かれる。
 *
 * - `unit`: domain / usecase / handler。素の Node で動く。**大半はこちら**
 * - `workers`: infra（D1）と Worker 全体の結線。workerd 上で実際の D1 を使う
 *
 * ドメインが素TSであること（`.claude/CLAUDE.md`）の裏返しで、
 * 計算ロジックのテストは Cloudflare のランタイムを必要としない。
 */
export default defineConfig({
  test: {
    projects: ['vitest.unit.config.ts', 'vitest.workers.config.ts'],
  },
});
