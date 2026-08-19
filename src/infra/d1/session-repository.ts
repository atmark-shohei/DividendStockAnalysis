/**
 * `SessionRepository` の D1 実装。ここだけが Drizzle と `D1Database` を知る。
 */

import { eq } from 'drizzle-orm';
import { type DrizzleD1Database, drizzle } from 'drizzle-orm/d1';

import { type Session } from '../../domain/auth/session';
import { type SessionRepository } from '../../domain/auth/session-repository';
import { sessions } from './schema';

export class D1SessionRepository implements SessionRepository {
  private readonly db: DrizzleD1Database;

  constructor(database: D1Database) {
    this.db = drizzle(database);
  }

  async insert(session: Session): Promise<void> {
    await this.db.insert(sessions).values({
      id: session.id,
      userId: session.userId,
      expiresAt: session.expiresAt,
      createdAt: session.createdAt,
    });
  }

  async findById(id: string): Promise<Session | null> {
    const rows = await this.db.select().from(sessions).where(eq(sessions.id, id)).limit(1);
    const row = rows[0];
    if (row === undefined) return null;
    return { id: row.id, userId: row.userId, expiresAt: row.expiresAt, createdAt: row.createdAt };
  }

  async deleteById(id: string): Promise<void> {
    await this.db.delete(sessions).where(eq(sessions.id, id));
  }
}
