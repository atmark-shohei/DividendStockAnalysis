import { fileURLToPath } from 'node:url';

import { defineProject } from 'vitest/config';

/** domain / usecase / handler のテスト。Cloudflare のランタイムを使わない */
export default defineProject({
  resolve: {
    // tsconfig の paths (@/* -> ./src/*) と揃える
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    name: 'unit',
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/integration/**'],
    environment: 'node',
  },
});
