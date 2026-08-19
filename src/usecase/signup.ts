/**
 * サインアップ。仕様: `docs/02_design/api/auth-api.md` §POST /api/auth/signup。
 *
 * ⚠️ **人数上限チェックと INSERT の間の競合状態は許容する**（auth-api.md 明記）。
 * トランザクション分離は行わない。
 */

import { PBKDF2_ITERATIONS } from '../domain/auth/hash-policy';
import { type PasswordHasher } from '../domain/auth/password-hasher';
import { type Session } from '../domain/auth/session';
import { type SessionRepository } from '../domain/auth/session-repository';
import { type SessionTokenGenerator } from '../domain/auth/session-token-generator';
import { sessionExpiresAt } from '../domain/auth/session-policy';
import {
  type SignupError,
  evaluateSignupEligibility,
  roleForNewSignup,
} from '../domain/auth/signup-policy';
import { type User } from '../domain/auth/user';
import { type UserRepository } from '../domain/auth/user-repository';
import { type Result, err, ok } from '../domain/shared/result';

export interface SignupDependencies {
  readonly userRepository: UserRepository;
  readonly sessionRepository: SessionRepository;
  readonly passwordHasher: PasswordHasher;
  readonly sessionTokenGenerator: SessionTokenGenerator;
  readonly signupEnabled: boolean;
  readonly maxUsers: number;
}

export async function signup(
  deps: SignupDependencies,
  email: string,
  password: string,
  now: () => Date,
): Promise<Result<{ readonly user: User; readonly session: Session }, SignupError>> {
  const currentTime = now();
  const existingUserCount = await deps.userRepository.count();

  const eligibility = evaluateSignupEligibility({
    signupEnabled: deps.signupEnabled,
    existingUserCount,
    maxUsers: deps.maxUsers,
  });
  if (!eligibility.ok) return err({ kind: eligibility.kind });

  const credential = await deps.passwordHasher.hash(password, PBKDF2_ITERATIONS);
  const role = roleForNewSignup(existingUserCount);

  const inserted = await deps.userRepository.insert({
    email,
    passwordHash: credential.hash,
    passwordSalt: credential.salt,
    passwordIterations: credential.iterations,
    role,
    createdAt: currentTime.toISOString(),
  });
  if (!inserted.ok) return err({ kind: 'email-already-exists' });

  const session: Session = {
    id: deps.sessionTokenGenerator.generate(),
    userId: inserted.value.id,
    expiresAt: sessionExpiresAt(currentTime),
    createdAt: currentTime.toISOString(),
  };
  await deps.sessionRepository.insert(session);

  return ok({ user: inserted.value, session });
}
