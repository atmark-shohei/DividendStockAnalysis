import { describe, expect, it } from 'vitest';

import { type Session } from '@/domain/auth/session';
import { type SessionRepository } from '@/domain/auth/session-repository';
import { logout } from '@/usecase/logout';

function fakeSessionRepository(): SessionRepository & { deleteByIdCalls: string[] } {
  const deleteByIdCalls: string[] = [];
  return {
    deleteByIdCalls,
    insert: (): Promise<void> => {
      throw new Error('このテストで insert が呼ばれるのは想定外');
    },
    findById: (): Promise<Session | null> => Promise.resolve(null),
    deleteById: (id: string) => {
      deleteByIdCalls.push(id);
      return Promise.resolve();
    },
  };
}

describe('logout', () => {
  it('存在するセッションを削除する', async () => {
    const sessionRepository = fakeSessionRepository();
    await logout(sessionRepository, 'session-1');
    expect(sessionRepository.deleteByIdCalls).toEqual(['session-1']);
  });

  it('sessionId が undefined（未ログイン）でもエラーにならず、削除も呼ばない', async () => {
    const sessionRepository = fakeSessionRepository();
    await expect(logout(sessionRepository, undefined)).resolves.toBeUndefined();
    expect(sessionRepository.deleteByIdCalls).toEqual([]);
  });

  it('存在しないセッションIDでもエラーにならない（deleteById は0件ヒットでも例外にしない）', async () => {
    const sessionRepository = fakeSessionRepository();
    await expect(logout(sessionRepository, 'no-such-session')).resolves.toBeUndefined();
    expect(sessionRepository.deleteByIdCalls).toEqual(['no-such-session']);
  });
});
