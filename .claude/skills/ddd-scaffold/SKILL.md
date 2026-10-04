---
name: ddd-scaffold
description: 値オブジェクト・エンティティ・集約・リポジトリ・ユースケースの雛形をこのプロジェクトの規約（branded type + Result型）に沿って作成する。
---

# DDD Scaffold (TypeScript / Cloudflare Workers 版)

CLAUDE.md の規約に従い、以下のテンプレートで雛形を生成する。生成前に `docs/glossary.md` で命名を確認すること。

## 値オブジェクト (src/domain/<context>/)

```ts
import { Result, ok, err } from '../shared/result';
import { DomainError } from '../shared/error';

export type Score = number & { readonly __brand: 'Score' };

export type ScoreError = DomainError<'ScoreOutOfRange' | 'ScoreNotInteger'>;

export function createScore(value: number): Result<Score, ScoreError> {
  if (!Number.isInteger(value)) return err({ kind: 'ScoreNotInteger', value });
  if (value < 1 || value > 10) return err({ kind: 'ScoreOutOfRange', value });
  return ok(value as Score); // as キャストはこのファクトリ内のみ許可
}
export class UserScoringPolicy {
  private constructor(
    private readonly _userId: UserId,
    private _thresholds: Map<MetricKey, ScoreThreshold>,
  ) {}

  static create(userId: UserId): UserScoringPolicy { ... }
  static reconstruct(/* 永続化データから */): UserScoringPolicy { ... }

  /** 閾値を上書きする。不変条件はメソッド内で守る */
  overrideThreshold(metric: MetricKey, t: ScoreThreshold): Result<void, PolicyError> { ... }

  /** 永続化用スナップショット (infra 費用) */
}

## リポジトリIF (domain側) と実装 (infra側)

// src/domain/scoring/repository.ts
export interface UserScoringPolicyRepository {
  findByUserId(userId: UserId): Promise<UserScoringPolicy null |>;
  save(policy: UserScoringPolicy): Promise<void>;
}

// src/infra/d1/user-scoring-policy-repository.ts
export class D1UserScoringPolicyRepository implements UserScoringPolicyRepository {
  constructor(private readonly db: DrizzleD1Database) {}
  // toSnapshot / reconstruct を介して変換。ドメインオブジェクトを直接シリアライズしない
}

## ユースケース (src/usecase/)

export class UpdateThresholdUseCase {
  constructor(private readonly repo: UserScoringPolicyRepository) {}
  async execute(input: UpdateThresholdInput): Promise<Result<void, UpdateThresholdError>> {
    // 1集約の取得 -> メソッド呼び出し -> 保存。ロジックは書かない
  }
}

## Hono ハンドラ (src/handler/)

app.put('/api/users/:userId/thresholds/:metric',
  zValidator('json', updateThresholdSchema), // zodはここだけ
  async (c) => {
    const result = await c.var.updateThreshold.execute(...);
    if (!result.ok) return c.json({ error: result.error.kind }, toStatus(result.error));
    return c.body(null, 204);
  });

## 生成手順
1. 生成対象の名前を glossary.md と照合（なければ追加を促す）
2. 雛形生成 -> 同階層に `*.test.ts` の骨子も生成（test-writer agent に委譲可）
```
