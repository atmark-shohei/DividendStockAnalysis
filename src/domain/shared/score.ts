/**
 * スコア。**0〜10 の整数**（`docs/glossary.md`）。
 *
 * 用語集は当初「1〜10」としていたが、`scoring-requirements.md` §0.3 / §0.4 / §0.5 は
 * 赤字・無配・表外をいずれも **0点**と定めており、全指標の区分表に 0点の行がある。
 * 0 を作れない型にすると採点そのものが成立しないため 0〜10 とする。
 */

import { type DomainError } from './domain-error';
import { type Result, err, ok } from './result';

export type Score = number & { readonly __brand: 'Score' };

export const MIN_SCORE = 0;
export const MAX_SCORE = 10;

/**
 * スコアを作る唯一の入口。`as Score` のキャストはこのファイルの外で書かない
 * （`.claude/CLAUDE.md`）。範囲外・非整数はここで止める。
 */
export function createScore(value: number): Result<Score, DomainError> {
  if (!Number.isInteger(value) || value < MIN_SCORE || value > MAX_SCORE) {
    return err({ kind: 'ScoreOutOfRange', value });
  }
  return ok(value as Score);
}

/**
 * 区分表など、**定数として範囲内であることが確定している値**からスコアを作る。
 *
 * 区分表の定数は `assertValidBands` で検証済みという前提が立つ場所でだけ使う。
 * 前提が崩れたら黙って壊れず throw するので、テストで必ず踏むこと。
 *
 * @throws 範囲外の場合（プログラミングエラー）
 */
export function scoreFromValidatedBand(value: number): Score {
  const result = createScore(value);
  if (!result.ok) {
    throw new Error(`invalid score constant: ${value}`);
  }
  return result.value;
}
