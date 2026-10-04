/**
 * URL を単一の情報源にする画面遷移フック。DOM に触るのはこのファイルだけで、
 * URL の解釈そのものは `routes.ts`（純関数）に置いている。
 */

import { useCallback, useMemo, useSyncExternalStore } from 'react';

import { LIST_PATH, parseRoute, routeToPath, type Route } from './routes';

/**
 * `history.pushState` は `popstate` を発火しない（発火するのは戻る/進むだけ）。
 * 自前で通知しないと、リンクを踏んでも画面が変わらない。
 */
const listeners = new Set<() => void>();

function subscribe(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  window.addEventListener('popstate', onStoreChange);
  return () => {
    listeners.delete(onStoreChange);
    window.removeEventListener('popstate', onStoreChange);
  };
}

function currentHref(): string {
  return `${window.location.pathname}${window.location.search}`;
}

export interface NavigateOptions {
  /**
   * `true` なら `history.replaceState`（履歴を汚さない）。既定は `pushState`。
   * 検索ボックスのデバウンス確定時に使う（`search-page.md` §2「検索語の途中経過で
   * 履歴を汚さない」）。ソート・ページ変更は既定どおり push する。
   */
  readonly replace?: boolean;
}

/**
 * `replace` オプションから使う History API のメソッドを選ぶだけの純粋関数（CR-8）。
 * `navigate` から分岐だけを切り出してテスト可能にする。**`window.history` の実呼び出し・
 * `popstate` 購読・React フックとしての結線（`useSyncExternalStore` 等）はここでは検証できない**
 * （`jsdom`/`@testing-library/react` 未導入のため。フル結線のテストが必要になったら、
 * これらの追加要否を判断すること）。
 */
export function selectHistoryMethod(
  historyLike: Pick<History, 'pushState' | 'replaceState'>,
  replace: boolean | undefined,
): Pick<History, 'pushState' | 'replaceState'>['pushState'] {
  return replace === true
    ? historyLike.replaceState.bind(historyLike)
    : historyLike.pushState.bind(historyLike);
}

export function useRoute(): readonly [Route, (route: Route, options?: NavigateOptions) => void] {
  // スナップショットは文字列にする。オブジェクトを返すと毎回参照が変わり再描画が止まらない
  const href = useSyncExternalStore(subscribe, currentHref, () => LIST_PATH);
  const route = useMemo(() => parseRoute(href), [href]);

  const navigate = useCallback((next: Route, options?: NavigateOptions) => {
    const path = routeToPath(next);
    if (path === currentHref()) return;
    selectHistoryMethod(window.history, options?.replace)(null, '', path);
    for (const listener of listeners) listener();
  }, []);

  return [route, navigate];
}
