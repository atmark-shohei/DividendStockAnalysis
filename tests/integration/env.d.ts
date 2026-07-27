import type { D1Migration } from '@cloudflare/vitest-pool-workers';

/**
 * `cloudflare:test` の `env` にテスト専用のバインディングを足す。
 *
 * `DB` / `ASSETS` は `wrangler types` が生成した `Cloudflare.Env` に入っている。
 * ここで重ねて宣言しない（生成物とずれる）。
 */
declare global {
  namespace Cloudflare {
    interface Env {
      /** `vitest.workers.config.ts` が読み込んだマイグレーション */
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}

export {};
