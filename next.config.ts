import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // ホームディレクトリに無関係な package-lock.json があるため、Next が
  // ワークスペースルートを C:\Users\Mining-Base と誤検出する。ここで明示する。
  outputFileTracingRoot: process.cwd(),
};

export default nextConfig;
