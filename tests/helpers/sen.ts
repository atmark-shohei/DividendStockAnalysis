import { type Sen, createSen } from '@/domain/shared/sen';

/**
 * テストから銭を作る。失敗したらテストごと落とす。
 *
 * 本番コードでこの形（失敗を throw に変える）を書かないこと。`Result` を
 * 導入した意味が消える。テストは「不正な定数を書いたら即座に落ちる」ほうが良い。
 */
export function sen(value: number): Sen {
  const result = createSen(value);
  if (!result.ok) throw new Error(`テストの銭が不正: ${value}`);
  return result.value;
}

/** `null` をそのまま通す版。欠損のテストで使う */
export function senOrNull(value: number | null): Sen | null {
  return value === null ? null : sen(value);
}
