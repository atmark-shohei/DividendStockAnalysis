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

export function useRoute(): readonly [Route, (route: Route) => void] {
  // スナップショットは文字列にする。オブジェクトを返すと毎回参照が変わり再描画が止まらない
  const href = useSyncExternalStore(subscribe, currentHref, () => LIST_PATH);
  const route = useMemo(() => parseRoute(href), [href]);

  const navigate = useCallback((next: Route) => {
    const path = routeToPath(next);
    if (path === currentHref()) return;
    window.history.pushState(null, '', path);
    for (const listener of listeners) listener();
  }, []);

  return [route, navigate];
}
