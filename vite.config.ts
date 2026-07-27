import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * フロントエンド（React）のビルド設定。
 *
 * 出力先は `dist/frontend`。`wrangler.jsonc` の `assets.directory` と揃えてある。
 * ここを変えるなら両方を直すこと。
 */
export default defineConfig({
  root: fileURLToPath(new URL('./frontend', import.meta.url)),
  plugins: [react()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: {
    outDir: fileURLToPath(new URL('./dist/frontend', import.meta.url)),
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      // 開発中は wrangler dev（8787）へ API を中継する
      '/api': { target: 'http://127.0.0.1:8787', changeOrigin: true },
    },
  },
});
