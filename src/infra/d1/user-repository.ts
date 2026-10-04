/**
 * `UserRepository` の D1 実装。ここだけが Drizzle と `D1Database` を知る
 * （`.claude/CLAUDE.md`）。ドメインへはドメインの型（`User`）に詰め替えて返す。
 */

import { eq, sql } from 'drizzle-orm';
import { type DrizzleD1Database, drizzle } from 'drizzle-orm/d1';

import { type LoginAttemptOutcome } from '../../domain/auth/login-policy';
import { type PasswordCredential } from '../../domain/auth/password-hasher';
import { type Role, type NewUser, type User } from '../../domain/auth/user';
import { type UserRepository } from '../../domain/auth/user-repository';
import { type Result, err, ok } from '../../domain/shared/result';
import { users } from './schema';

const ROLES: readonly Role[] = ['user', 'admin'];

/** DB の文字列をロールへ戻す。未知の値はデータ不整合なので `user`（安全側）に倒す */
function toRole(raw: string): Role {
  return ROLES.includes(raw as Role) ? (raw as Role) : 'user';
}

function toUser(row: typeof users.$inferSelect): User {
  return {
    id: row.id,
    email: row.email,
    passwordHash: row.passwordHash,
    passwordSalt: row.passwordSalt,
    passwordIterations: row.passwordIterations,
    role: toRole(row.role),
    failedLoginCount: row.failedLoginCount,
    lockedUntil: row.lockedUntil,
    createdAt: row.createdAt,
  };
}

/**
 * D1 の `UNIQUE` 制約違反かどうかを判別する。
 *
 * Drizzle が投げる例外は `Failed query: insert into ...` という上位メッセージを持ち、
 * 実際の `UNIQUE constraint failed: users.email` は `error.cause`（さらにその `cause`）に
 * 連鎖している（実測確認。2026-08-18）。専用のエラークラスは無いため、
 * `cause` チェーンを辿ってメッセージの部分一致で判別する。
 */
function isUniqueConstraintError(error: unknown): boolean {
  let current: unknown = error;
  // 循環参照に対する保険として最大10段までしか辿らない
  for (let depth = 0; depth < 10 && current instanceof Error; depth += 1) {
    if (current.message.includes('UNIQUE constraint failed')) return true;
    current = current.cause;
  }
  return false;
}

export class D1UserRepository implements UserRepository {
  private readonly db: DrizzleD1Database;

  constructor(database: D1Database) {
    this.db = drizzle(database);
  }

  async findByEmail(email: string): Promise<User | null> {
    const rows = await this.db.select().from(users).where(eq(users.email, email)).limit(1);
    const row = rows[0];
    return row === undefined ? null : toUser(row);
  }

  async findById(id: number): Promise<User | null> {
    const rows = await this.db.select().from(users).where(eq(users.id, id)).limit(1);
    const row = rows[0];
    return row === undefined ? null : toUser(row);
  }

  async count(): Promise<number> {
    const rows = await this.db.select({ count: sql<number>`count(*)` }).from(users);
    return rows[0]?.count ?? 0;
  }

  async insert(user: NewUser): Promise<Result<User, { readonly kind: 'email-already-exists' }>> {
    let inserted: (typeof users.$inferSelect)[];
    try {
      inserted = await this.db
        .insert(users)
        .values({
          email: user.email,
          passwordHash: user.passwordHash,
          passwordSalt: user.passwordSalt,
          passwordIterations: user.passwordIterations,
          role: user.role,
          failedLoginCount: 0,
          lockedUntil: null,
          createdAt: user.createdAt,
        })
        .returning();
    } catch (error) {
      // ここに来る例外は INSERT 自体の失敗のみ（UNIQUE制約 or その他のDBエラー）。
      // 「行が返らなかった」という応答自体の異常とは構造的に分離する（CR-6）
      if (isUniqueConstraintError(error)) {
        return err({ kind: 'email-already-exists' });
      }
      throw error;
    }

    const row = inserted[0];
    if (row === undefined) {
      // D1 が UNIQUE 違反以外で成功応答なのに行を返さないのは想定外（防御的分岐）。
      // UNIQUE 制約判定とは無関係なので、try/catch の外で明示的に throw する
      throw new Error('insert did not return the created row');
    }
    return ok(toUser(row));
  }

  async updateLoginAttempt(userId: number, outcome: LoginAttemptOutcome): Promise<void> {
    await this.db
      .update(users)
      .set({ failedLoginCount: outcome.failedLoginCount, lockedUntil: outcome.lockedUntil })
      .where(eq(users.id, userId));
  }

  async updatePasswordHash(userId: number, credential: PasswordCredential): Promise<void> {
    await this.db
      .update(users)
      .set({
        passwordHash: credential.hash,
        passwordSalt: credential.salt,
        passwordIterations: credential.iterations,
      })
      .where(eq(users.id, userId));
  }
}
