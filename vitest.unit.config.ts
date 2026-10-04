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
    // `.tsx` は React コンポーネントのモジュールから import するテストだけ
    // （型チェックは `tsconfig.frontend.json` 側。JSX は書かない）
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    exclude: ['tests/integration/**'],
    environment: 'node',
  },
});
