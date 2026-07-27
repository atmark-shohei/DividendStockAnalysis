import { defineConfig } from 'drizzle-kit';

/**
 * マイグレーション生成専用の設定。
 *
 * 生成: `npm run db:generate` → `db/migrations/*.sql`
 * 適用: `npm run db:migrate`（ローカル） / `npm run db:migrate:remote`（本番）
 *
 * **手動で ALTER TABLE を書かない**（`.claude/rules/backend.md`）。
 * スキーマを変えたら必ずここから生成する。
 */
export default defineConfig({
  schema: './src/infra/d1/schema.ts',
  out: './db/migrations',
  dialect: 'sqlite',
});
