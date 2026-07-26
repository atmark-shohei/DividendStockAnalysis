import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FlatCompat } from '@eslint/eslintrc';

// eslint-config-next 15.x は eslintrc 形式のみを提供しているため、
// ESLint 9 の flat config から使うには FlatCompat を挟む必要がある。
const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) });

const config = [
  {
    // reference/ は移植元のスナップショット。原本のまま残すため lint しない。
    ignores: ['.next/**', 'node_modules/**', 'next-env.d.ts', 'coverage/**', 'reference/**'],
  },
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
];

export default config;
