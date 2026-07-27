# ADR-0001: ランタイムを Cloudflare Workers + Hono + D1 にする

- ステータス: ✅ 採用
- 日付: 2026-07-28
- 関連: [migration-plan.md](../migration-plan.md), `CLAUDE.md`, `.claude/CLAUDE.md`

## 背景

規約が2つ存在し、**両立しない技術スタックを指していた**。

| 項目           | `CLAUDE.md`（git 管理下） | `.claude/CLAUDE.md`（未コミットだった） |
| -------------- | ------------------------- | --------------------------------------- |
| ランタイム     | Next.js App Router        | Cloudflare Workers                      |
| API            | Next.js API Route         | Hono                                    |
| DB             | 未定                      | D1 + Drizzle                            |
| フロント       | 同一プロジェクト          | 別ディレクトリ React + Vite             |
| パッケージ管理 | npm（実測）               | pnpm                                    |

この状態のまま軽量DDD への移行を始めると、層構造だけを移すのか、ランタイムごと
載せ替えるのかで作業量が1桁変わり、途中でやり直しになる恐れがあった。

## 決定

**`.claude/CLAUDE.md` を正とし、Cloudflare Workers + Hono + D1 + Drizzle +
React/Vite/Recharts へ載せ替える。** Next.js は削除した。

## 理由

- 実装済みだったのは指標⑩の純粋関数だけで、Next.js 側の資産は
  プレースホルダのページ2枚しか無かった。載せ替えの実コストが小さい時期だった
- ドメイン層が素TSであることは規約の中核（`.claude/CLAUDE.md`「依存ルール（絶対厳守）」）で、
  この制約はランタイムに依存しない。**先に層を作ってから載せ替えても二度手間になる**
- D1 は SQLite なので、「金額は整数（銭）で持つ」という本プロジェクトの前提と相性が良い

## 影響

- `next` / `eslint-config-next` を削除し、`hono` / `zod` / `drizzle-orm` /
  `wrangler` / `vite` / `recharts` を導入
- `src/app/` を廃止。フロントは `frontend/` へ分離
- tsconfig を Worker 用（`lib: ES2022`）とフロント用（`lib: DOM`）に分割
- テストが2系統になった（素の Node と workerd + D1）

## 検証（2026-07-28 実測）

- `npm test` → **379 passed（17 files）**。うち16件は実 workerd + D1 上の結線テスト
- `npm run typecheck` / `npm run lint` → エラーなし
- `wrangler dev` で起動し、`POST /api/companies` が10指標を採点して 74/100（有効 10/10）を返すことを確認

## 代替案

- **層構造だけ導入し Next.js を据え置く。** 既存96テストを保ったまま数ステップで
  終わる案だったが、`.claude/CLAUDE.md` が Workers 前提で書かれており、
  規約と実装の食い違いが残り続ける
- **段階移行（層 → 後日ランタイム）。** `infra` / `handler` を2回書くコストが乗る
