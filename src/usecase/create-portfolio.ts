/**
 * ユースケース: ポートフォリオを新規作成する。`POST /api/portfolios`（`portfolio-api.md`）。
 *
 * `name` の1〜50文字・空文字禁止は handler の zod 境界で検証済み。ここでは
 * 上限（10件。`isPortfolioLimitReached`）だけを見る。
 *
 * ID衝突（`repository.insert()` が `id-conflict` を返す）時は、上限チェックを再実行せずに
 * IDだけ生成し直して最大 `MAX_ID_GENERATION_ATTEMPTS` 回まで再試行する（BEレビュー CR-2）。
 * 衝突確率は `WebCryptoPortfolioIdGenerator` の実装コメントのとおり実用上無視できるほど
 * 低いが、コスト小さく自動復旧できるリトライを設けることで、ユーザーに内部情報の無い500を
 * 返す前に救える経路を作る。
 */

import { type Portfolio, isPortfolioLimitReached } from '../domain/portfolio/portfolio';
import { type PortfolioIdGenerator } from '../domain/portfolio/portfolio-id-generator';
import { type PortfolioRepository } from '../domain/portfolio/portfolio-repository';
import { type Result, err, ok } from '../domain/shared/result';

export type CreatePortfolioError =
  | { readonly kind: 'portfolio-limit-reached' }
  /**
   * 理論上ほぼ到達しない防御的分岐（`MAX_ID_GENERATION_ATTEMPTS` 回連続でID衝突）。
   * `add-holding.ts` の `insert-verification-failed` と同型
   */
  | { readonly kind: 'id-generation-failed' };

export interface CreatePortfolioDependencies {
  readonly repository: PortfolioRepository;
  readonly idGenerator: PortfolioIdGenerator;
}

const MAX_ID_GENERATION_ATTEMPTS = 3;

export async function createPortfolio(
  deps: CreatePortfolioDependencies,
  userId: number,
  name: string,
  now: () => Date,
): Promise<Result<Portfolio, CreatePortfolioError>> {
  const existingCount = await deps.repository.countByUserId(userId);
  if (isPortfolioLimitReached(existingCount)) {
    return err({ kind: 'portfolio-limit-reached' });
  }

  const createdAt = now().toISOString();
  for (let attempt = 0; attempt < MAX_ID_GENERATION_ATTEMPTS; attempt += 1) {
    const portfolio: Portfolio = {
      id: deps.idGenerator.generate(),
      userId,
      name,
      createdAt,
    };
    const inserted = await deps.repository.insert(portfolio);
    if (inserted.ok) return ok(portfolio);
    // id-conflict のみ再試行する。他の失敗はここに来ない（Result のエラー種別が id-conflict のみ）
  }

  return err({ kind: 'id-generation-failed' });
}
