import { useEffect, useRef, type ReactNode } from 'react';

/**
 * 解析ダイアログの土台（`docs/02_design/ui/components.md` §3 `<Dialog>`）。
 *
 * **開閉状態自体は持たない。** `open` を受けて描画するだけで、開閉の制御は
 * 呼び出し側（`ListPage`/`App`）が URL 経由で行う（`.claude/rules/frontend.md`
 * 「選択中の銘柄コードは URL に置く」と同じ扱い。`docs/adr/0014-analysis-dialog-url-state.md`）。
 *
 * `open === false` のときは `null` を返す（DOM から完全に外す。`display: none` にしない。
 * フォーカストラップの対象が存在しない状態を作らないため）。
 *
 * フォーカストラップ・`aria-modal`・Escape・背景クリックはこのコンポーネント内部に閉じる
 * （`docs/02_design/ui/pages/analysis-dialog.md` §8。呼び出し側に実装させない）。
 */

/**
 * フォーカス可能要素のセレクタ。定番の一覧（button・リンク・フォーム部品・
 * `tabindex="-1"` を除く tabindex 指定要素）。コンポーネント外に export し、
 * DOM に依存しない形でテスト可能にする。
 */
export function getFocusableSelector(): string {
  return 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
}

/**
 * Tab / Shift+Tab で次にフォーカスすべき要素のインデックスを計算する（循環）。
 * DOM に触らない純粋関数（テスト対象）。
 *
 * `currentIndex` がフォーカス可能要素の配列に見つからない場合（-1）は、
 * Tab なら先頭（0）、Shift+Tab なら末尾（`count - 1`）に着地する
 * （`currentIndex <= 0` の判定に -1 も含まれるため自然にそうなる）。
 */
export function nextFocusIndex(currentIndex: number, count: number, shiftKey: boolean): number {
  if (count === 0) return -1;
  if (shiftKey) return currentIndex <= 0 ? count - 1 : currentIndex - 1;
  return currentIndex >= count - 1 ? 0 : currentIndex + 1;
}

export interface DialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
  /** `aria-labelledby` に渡す要素ID（銘柄名の見出し要素。`analysis-dialog.md` §8） */
  readonly labelId: string;
  readonly children: ReactNode;
}

export function Dialog({ open, onClose, labelId, children }: DialogProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  // 開く直前の `document.activeElement`。閉じたときにここへフォーカスを戻す
  // （`analysis-dialog.md` §8「閉じたらフォーカスを元の呼び出し元（一覧の行ボタン）に戻す」）
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  /**
   * 開いた瞬間: 直前のフォーカスを保存し、ダイアログ内の最初のフォーカス可能要素
   * （✕ ボタン想定）へ移動する。見つからなければカード要素自体（`tabIndex={-1}`）へ。
   *
   * 閉じた瞬間: 保存しておいた要素へフォーカスを戻す。
   *
   * ⚠️ **DOM 副作用のためここはテスト対象外。** `.focus()` の実呼び出し・
   * `document.activeElement` の追跡は `@testing-library/react` 等が無いと検証できない
   * （`frontend/use-route.ts` の `selectHistoryMethod` コメントと同じ区分）。
   */
  useEffect(() => {
    if (open) {
      previouslyFocusedRef.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const card = cardRef.current;
      if (card === null) return;
      const focusable = card.querySelectorAll<HTMLElement>(getFocusableSelector());
      const first = focusable[0];
      if (first !== undefined) {
        first.focus();
      } else {
        card.focus();
      }
      return;
    }
    previouslyFocusedRef.current?.focus();
    previouslyFocusedRef.current = null;
  }, [open]);

  /**
   * Escape で閉じる ＋ Tab をダイアログ内で循環させる。
   * `document` への `keydown` 購読は `use-route.ts` の `subscribe`（`popstate`）と
   * 同じクリーンアップ書式（登録に対応する解除を `return`）。
   *
   * ⚠️ **DOM 副作用のためここはテスト対象外。** イベント配線そのもの（正しいハンドラが
   * 呼ばれるか）は検証できない。循環先インデックスの計算ロジックだけを
   * `nextFocusIndex` として切り出し、そちらをテストする。
   */
  useEffect(() => {
    if (!open) return;

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const card = cardRef.current;
      if (card === null) return;
      const focusable = Array.from(card.querySelectorAll<HTMLElement>(getFocusableSelector()));
      if (focusable.length === 0) return;
      event.preventDefault();
      const currentIndex = focusable.indexOf(document.activeElement as HTMLElement);
      const next = nextFocusIndex(currentIndex, focusable.length, event.shiftKey);
      focusable[next]?.focus();
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="dialog-scrim"
      onClick={(event) => {
        // scrim 自身がクリックされたときだけ閉じる。カード内部のクリックが
        // バブリングしてもここには来ない（`event.target` はクリックされた実要素、
        // `event.currentTarget` は常にこの scrim div）。`stopPropagation` は使わない
        // （`analysis-dialog.md` §2「背景クリックは指標詳細でもダイアログごと閉じる」）
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={cardRef}
        className="dialog-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelId}
        tabIndex={-1}
      >
        {children}
      </div>
    </div>
  );
}
