/**
 * ドメイン層の戻り値。例外を投げずに成否を値で返す（`.claude/CLAUDE.md`）。
 *
 * 例外にしないのは、失敗が「想定内の分岐」だからである。閾値が昇順でない、
 * スコアが範囲外、といった失敗は呼び出し側が必ず扱う必要がある。throw にすると
 * 握り潰しても型検査を通ってしまい、`catch {}` の有無がレビュー任せになる。
 */
export type Result<T, E> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E };

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

/**
 * 成功なら値を、失敗なら `fallback` を返す。
 *
 * テストや、失敗が起こりえないと**その場で証明できる**箇所でのみ使う。
 * 「とりあえず取り出す」用途に使うと `Result` を導入した意味が消える。
 */
export function unwrapOr<T, E>(result: Result<T, E>, fallback: T): T {
  return result.ok ? result.value : fallback;
}
