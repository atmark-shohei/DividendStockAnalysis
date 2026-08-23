/**
 * リポジトリIF: ユーザーの指標カスタマイズ設定。
 *
 * 実装は `src/infra/d1/user-indicator-settings-repository.ts`（D1・Drizzleを知るのはそこだけ。
 * `.claude/CLAUDE.md`）。
 */

import { type UserIndicatorSettings } from './user-indicator-settings';

export interface UserIndicatorSettingsRepository {
  /**
   * 保存済みの設定を返す。**未設定（行が0件）なら `null`**（404にしない）。
   * デフォルト設定へのフォールバックは usecase 層の責務（`get-indicator-settings.ts` /
   * `resolve-scoring-bands.ts`）。
   */
  findByUserId(userId: number): Promise<UserIndicatorSettings | null>;

  /**
   * 全置換（`portfolio-api.md` PUTの仕様。部分更新ではない）。
   * 実装は「該当 `userId` の行を全削除 → 新しい選択ぶんを INSERT」の1トランザクション
   * （`schema.md` §user_indicator_settings）。
   */
  replaceAll(userId: number, settings: UserIndicatorSettings): Promise<void>;
}
