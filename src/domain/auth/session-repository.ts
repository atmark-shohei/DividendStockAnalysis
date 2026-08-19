/**
 * セッションの永続化インターフェース。**定義はドメイン側に置く**（`.claude/CLAUDE.md`）。
 * 実装は `src/infra/d1/session-repository.ts`。
 *
 * 期限切れセッションの一括掃除（`schema.md` §未実装・検討事項）は本タスクのスコープ外。
 * `GET /me` 相当の usecase（`get-current-user.ts`）が期限切れを検出した時点で
 * `deleteById` する遅延削除だけを実装する（auth-api.md §セッションが明示的に許容する方式）。
 */

import { type Session } from './session';

export interface SessionRepository {
  insert(session: Session): Promise<void>;
  findById(id: string): Promise<Session | null>;
  deleteById(id: string): Promise<void>;
}
