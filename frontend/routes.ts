/**
 * URL と画面の対応。**DOM に触らない純関数だけを置く。**
 *
 * 画面状態を URL に載せるのは `.claude/rules/frontend.md` の要求。旧実装
 * （`reference/legacy-web/`）はタブ切り替えを class の付け替えだけで行っており、
 * リロードと共有で選択が失われた。同じ作りにしない。
 *
 * DOM を触る側は `use-route.ts`。分けてあるのは、ここを素の Node でテストするため。
 */

/**
 * 銘柄コード。4文字固定、先頭3文字は数字・末尾1文字は数字または英大文字
 * （handler の `companyCode` と同じ形式）。
 */
const COMPANY_CODE = /^\d{3}[0-9A-Z]$/;

export type Route =
  | {
      readonly kind: 'list';
      readonly selectedCode: string | null;
      /**
       * ③ 予想配当性向の採点に実績を使うか（チェックボックス）。
       * 「リクエスト単位の一時指定」（`docs/02_design/logic/payout-ratio-scoring.md` §7 決定5）
       * を URL 状態として扱う。省略時は `false`（Manager決定、2026-08-06）。
       */
      readonly useActualForScoring: boolean;
    }
  | { readonly kind: 'input' };

export const LIST_PATH = '/';
export const INPUT_PATH = '/input';

/** 末尾スラッシュを落とす。`/input/` と `/input` を別画面にしない */
function normalizePathname(pathname: string): string {
  return pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
}

/**
 * `location.pathname + location.search` 相当の文字列から画面を決める。
 *
 * 未知のパスは一覧へ倒す。Worker の `not_found_handling: single-page-application`
 * がどんなパスでも `index.html` を返すので、ここには何が来てもおかしくない。
 */
export function parseRoute(href: string): Route {
  const queryIndex = href.indexOf('?');
  const pathname = normalizePathname(queryIndex === -1 ? href : href.slice(0, queryIndex));
  if (pathname === INPUT_PATH) return { kind: 'input' };

  const search = queryIndex === -1 ? '' : href.slice(queryIndex + 1);
  const params = new URLSearchParams(search);
  const code = params.get('code');
  // 形式不正のコードは「選択なし」にする。API へ渡す前にここで弾く
  return {
    kind: 'list',
    selectedCode: code !== null && COMPANY_CODE.test(code) ? code : null,
    // 真偽値は文字列 "true" のときだけ true にする（`api.ts` の `useActualForScoring` と同じ形式）
    useActualForScoring: params.get('useActualForScoring') === 'true',
  };
}

export function routeToPath(route: Route): string {
  if (route.kind === 'input') return INPUT_PATH;

  const params = new URLSearchParams();
  if (route.selectedCode !== null) params.set('code', route.selectedCode);
  // 既定値（false）は URL に出さない。既存の `/?code=7203` の見た目を変えないため
  if (route.useActualForScoring) params.set('useActualForScoring', 'true');

  const query = params.toString();
  return query === '' ? LIST_PATH : `${LIST_PATH}?${query}`;
}
