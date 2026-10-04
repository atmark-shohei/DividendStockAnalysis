/**
 * ユーザー（集約ルート）。
 *
 * `Company` と同じ「interface（readonly フィールド）+ 純関数」パターンで実装する
 * （クラス化しない。既存実装済みパターンに合わせる）。
 *
 * `email` / `role` は zod（handler 境界）で形式検証済みの値をそのまま持つ素の型にする。
 * `Score`/`Sen` のような branded type にしないのは、これらが算術・範囲不変条件を
 * 持たない単純な保存値だからである（`Company.code` と同じ扱い）。
 */

/** `guest`（未ログイン）は行を持たないので、この型には現れない（`schema.md`） */
export type Role = 'user' | 'admin';

export interface User {
  readonly id: number;
  readonly email: string;
  readonly passwordHash: string;
  readonly passwordSalt: string;
  readonly passwordIterations: number;
  readonly role: Role;
  readonly failedLoginCount: number;
  /** ロック解除時刻。UTC ISO 8601。ロックなしは `null` */
  readonly lockedUntil: string | null;
  /** UTC ISO 8601 */
  readonly createdAt: string;
}

/** 新規作成時（id 未採番）の入力形 */
export interface NewUser {
  readonly email: string;
  readonly passwordHash: string;
  readonly passwordSalt: string;
  readonly passwordIterations: number;
  readonly role: Role;
  readonly createdAt: string;
}
