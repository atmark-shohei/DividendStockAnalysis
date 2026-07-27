import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * 依存の向きを**機械的に**強制する（`.claude/CLAUDE.md`「依存ルール（絶対厳守）」）。
 *
 * 規約に書くだけでは守られない。`handler -> usecase -> domain <- infra` の向きと、
 * 「domain は外部パッケージを import しない（素TS）」をここで落とす。
 */

/** domain が触れてはいけないもの。フレームワーク・DB・検証ライブラリ・実行環境 */
const FORBIDDEN_IN_DOMAIN = [
  { group: ['hono', 'hono/*'], message: 'domain は Hono を知らない。HTTP は handler の責務' },
  {
    group: ['drizzle-orm', 'drizzle-orm/*'],
    message: 'domain は ORM を知らない。永続化は infra の責務',
  },
  {
    group: ['zod', 'zod/*'],
    message: 'zod は handler の入出力検証だけ。domain の不変条件は domain 自身が守る',
  },
  { group: ['cloudflare:*'], message: 'Cloudflare 固有の API は infra と index.ts だけ' },
  { group: ['react', 'react-dom', 'react/*', 'recharts'], message: 'domain は画面を知らない' },
  {
    group: ['../usecase/*', '../../usecase/*', '@/usecase/*'],
    message: '依存の向きが逆（usecase -> domain）',
  },
  {
    group: ['../infra/*', '../../infra/*', '@/infra/*'],
    message: '依存の向きが逆（infra -> domain）',
  },
  {
    group: ['../handler/*', '../../handler/*', '@/handler/*'],
    message: '依存の向きが逆（handler -> domain）',
  },
  {
    group: ['../lib/*', '../../lib/*', '@/lib/*'],
    message: 'src/lib は移行ブリッジ。domain から参照しない',
  },
];

/** usecase が触れてはいけないもの。実装の詳細（DB・HTTP） */
const FORBIDDEN_IN_USECASE = [
  { group: ['hono', 'hono/*'], message: 'usecase は HTTP を知らない' },
  {
    group: ['drizzle-orm', 'drizzle-orm/*'],
    message: 'usecase は ORM を知らない。リポジトリIF越しに使う',
  },
  { group: ['cloudflare:*'], message: 'Cloudflare 固有の API は infra と index.ts だけ' },
  {
    group: ['../infra/*', '@/infra/*'],
    message: 'usecase は infra の実装を知らない。IF は domain 側にある',
  },
  { group: ['../handler/*', '@/handler/*'], message: '依存の向きが逆（handler -> usecase）' },
];

export default tseslint.config(
  {
    // reference/ は移植元のスナップショット。原本のまま残すため lint しない。
    ignores: [
      'dist/**',
      'node_modules/**',
      'coverage/**',
      'reference/**',
      '.wrangler/**',
      // Next.js 時代のビルド出力。ランタイム載せ替えに伴い削除予定
      '.next/**',
      // Claude 向けのツール（skill のドライバ等）。アプリのコードではない
      '.claude/**',
      // `wrangler types` の生成物。手で直さないので lint しない
      'worker-configuration.d.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Worker 側とフロントエンドで tsconfig が違う（lib と jsx が異なるため）
    files: ['src/**/*.ts', 'tests/**/*.ts', 'drizzle.config.ts', 'vitest*.config.ts'],
    languageOptions: {
      parserOptions: { project: './tsconfig.json', tsconfigRootDir: import.meta.dirname },
    },
  },
  {
    files: ['frontend/**/*.{ts,tsx}', 'vite.config.ts'],
    languageOptions: {
      parserOptions: { project: './tsconfig.frontend.json', tsconfigRootDir: import.meta.dirname },
    },
  },
  {
    rules: {
      // 全角スペース（U+3000）は正規表現の中では**意図的な文字**。
      // 日本語環境の入力正規化に必要なので、正規表現内だけ許可する
      'no-irregular-whitespace': ['error', { skipRegExps: true }],
    },
  },
  {
    // 移行ブリッジは残しておくが、新しい参照が増えていないか見えるようにする
    files: ['src/**/*.ts', 'frontend/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'warn',
        {
          patterns: [
            {
              group: ['@/lib/*', '../lib/*', '../../lib/*'],
              message: 'src/lib は移行ブリッジ（@deprecated）。新規参照は増やさない',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/domain/**/*.ts'],
    rules: { 'no-restricted-imports': ['error', { patterns: FORBIDDEN_IN_DOMAIN }] },
  },
  {
    files: ['src/usecase/**/*.ts'],
    rules: { 'no-restricted-imports': ['error', { patterns: FORBIDDEN_IN_USECASE }] },
  },
  {
    files: ['tests/**/*.ts'],
    rules: {
      // テストは移行ブリッジ経由の呼び出しも検証するので、この警告の対象外にする
      'no-restricted-imports': 'off',
    },
  },
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': ['warn', { fixStyle: 'inline-type-imports' }],
    },
  },
);
