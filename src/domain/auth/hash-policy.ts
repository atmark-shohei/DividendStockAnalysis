/**
 * PBKDF2 のイテレーション数（`docs/adr/0013-multi-user-auth-small-scale.md` §決定3。
 * 2026-08-17 実測確定）。
 *
 * **Workers Free プラン（CPU 時間10ms上限）を維持するための明示的なリスク受容。**
 * OWASP 最小推奨（210,000回）の約1/21。Paid プラン移行時は引き上げる。
 * 既存ユーザーは `users.password_iterations` に実際の回数を保存しているため、
 * 定数を上げても既存ハッシュはそのまま検証でき、次回ログイン成功時に段階的に移行する
 * （`src/usecase/login.ts`）。
 */
export const PBKDF2_ITERATIONS = 10_000;
