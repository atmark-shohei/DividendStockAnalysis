/**
 * ユーザーの永続化インターフェース。**定義はドメイン側に置く**（`.claude/CLAUDE.md`）。
 * 実装は `src/infra/d1/user-repository.ts`。
 */

import { type Result } from '../shared/result';
import { type LoginAttemptOutcome } from './login-policy';
import { type PasswordCredential } from './password-hasher';
import { type NewUser, type User } from './user';

export interface UserRepository {
  findByEmail(email: string): Promise<User | null>;
  findById(id: number): Promise<User | null>;
  /** サインアップ可否判定・最初の登録者判定に使う */
  count(): Promise<number>;
  /** `email` の UNIQUE 制約違反を `Result` で返す（例外にしない） */
  insert(user: NewUser): Promise<Result<User, { readonly kind: 'email-already-exists' }>>;
  /** ログイン試行の結果（失敗回数・ロック期限）を更新する */
  updateLoginAttempt(userId: number, outcome: LoginAttemptOutcome): Promise<void>;
  /** イテレーション数の段階的移行（ADR-0013 §決定3）。ログイン成功時に再ハッシュして呼ぶ */
  updatePasswordHash(userId: number, credential: PasswordCredential): Promise<void>;
}
