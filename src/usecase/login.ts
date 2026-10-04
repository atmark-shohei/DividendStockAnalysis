/**
 * ログイン。仕様: `docs/02_design/api/auth-api.md` §POST /api/auth/login・§レート制限・
 * §タイミング攻撃対策。
 */

import { PBKDF2_ITERATIONS } from '../domain/auth/hash-policy';
import {
  type LoginError,
  isAccountLocked,
  recordFailedLogin,
  recordSuccessfulLogin,
} from '../domain/auth/login-policy';
import { DUMMY_PASSWORD_CREDENTIAL, type PasswordHasher } from '../domain/auth/password-hasher';
import { type Session } from '../domain/auth/session';
import { sessionExpiresAt } from '../domain/auth/session-policy';
import { type SessionRepository } from '../domain/auth/session-repository';
import { type SessionTokenGenerator } from '../domain/auth/session-token-generator';
import { type User } from '../domain/auth/user';
import { type UserRepository } from '../domain/auth/user-repository';
import { type Result, err, ok } from '../domain/shared/result';

export interface LoginDependencies {
  readonly userRepository: UserRepository;
  readonly sessionRepository: SessionRepository;
  readonly passwordHasher: PasswordHasher;
  readonly sessionTokenGenerator: SessionTokenGenerator;
}

export async function login(
  deps: LoginDependencies,
  email: string,
  password: string,
  now: () => Date,
): Promise<Result<{ readonly user: User; readonly session: Session }, LoginError>> {
  const currentTime = now();
  const user = await deps.userRepository.findByEmail(email);

  if (user === null) {
    // タイミング攻撃対策: メール不存在でも同じ計算コストの verify を1回行う。
    // 結果は使わない（応答時間だけを揃えるため）
    await deps.passwordHasher.verify(password, DUMMY_PASSWORD_CREDENTIAL);
    return err({ kind: 'invalid-credentials' });
  }

  if (isAccountLocked(user.lockedUntil, currentTime)) {
    // ロック中は常に同じ扱いにする。パスワードの正誤を検証しない
    // （検証してから拒否すると応答内容から漏れる余地がある。auth-api.md §レート制限）
    return err({ kind: 'account-locked' });
  }

  const matched = await deps.passwordHasher.verify(password, {
    hash: user.passwordHash,
    salt: user.passwordSalt,
    iterations: user.passwordIterations,
  });

  if (!matched) {
    const outcome = recordFailedLogin(user.failedLoginCount, currentTime);
    await deps.userRepository.updateLoginAttempt(user.id, outcome);
    return err({ kind: 'invalid-credentials' });
  }

  await deps.userRepository.updateLoginAttempt(user.id, recordSuccessfulLogin());

  // 段階的移行（ADR-0013 §決定3）。イテレーション数を上げたときだけ実際に発火する
  if (user.passwordIterations < PBKDF2_ITERATIONS) {
    const credential = await deps.passwordHasher.hash(password, PBKDF2_ITERATIONS);
    await deps.userRepository.updatePasswordHash(user.id, credential);
  }

  const session: Session = {
    id: deps.sessionTokenGenerator.generate(),
    userId: user.id,
    expiresAt: sessionExpiresAt(currentTime),
    createdAt: currentTime.toISOString(),
  };
  await deps.sessionRepository.insert(session);

  return ok({ user, session });
}
