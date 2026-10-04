/**
 * パスワードハッシュのポート。**計算自体は Web Crypto（`crypto.subtle`）依存であり
 * domain には置かない**（実装は `src/infra/auth/webcrypto-password-hasher.ts`）。
 *
 * `FinancialSource`/`MarketDataSource`/`EdinetHistorySource` と同じ
 * 「副作用はポート越し」の原則（`docs/adr/0013-multi-user-auth-small-scale.md`）。
 */

import { PBKDF2_ITERATIONS } from './hash-policy';

export interface PasswordCredential {
  readonly hash: string;
  readonly salt: string;
  readonly iterations: number;
}

export interface PasswordHasher {
  /** 新規ハッシュを生成する。ソルトは内部で乱数生成し、戻り値に含める */
  hash(password: string, iterations: number): Promise<PasswordCredential>;
  /** 平文パスワードが `credential` と一致するか検証する */
  verify(password: string, credential: PasswordCredential): Promise<boolean>;
}

/**
 * タイミング攻撃対策用のダミー資格情報（`docs/02_design/api/auth-api.md` §タイミング攻撃対策）。
 *
 * メールアドレスが存在しない場合も同じ計算コストの `verify()` を1回実行してから
 * 401 を返すことで、応答時間からアカウントの有無を推測できないようにする。
 * ソルト・イテレーション数は固定値でよい（攻撃者が知っていても情報にならない）。
 */
export const DUMMY_PASSWORD_CREDENTIAL: PasswordCredential = {
  hash: '0'.repeat(64),
  // 16進文字列（`WebCryptoPasswordHasher.verify()` が `fromHex()` で読む契約。CR-2）。
  // 実際のソルト長（`SALT_BYTES = 16` バイト = 32桁）に合わせる
  salt: '00'.repeat(16),
  iterations: PBKDF2_ITERATIONS, // CR-3: マジックナンバーの複製をやめ、実運用と同じ定数を使う
};
