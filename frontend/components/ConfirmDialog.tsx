import { useEffect, useRef } from 'react';

import { Dialog } from './Dialog';

/**
 * 破壊的操作（削除）の確認モーダル（T-105 確認事項B）。
 *
 * `window.confirm`（ブラウザネイティブ）を `<Dialog>` ベースの独自モーダルに置き換える
 * ための汎用コンポーネント。`HoldingsTable.tsx`（保有銘柄削除）・`PortfolioPage.tsx`
 * （ポートフォリオ削除）の両方から使う（個別実装しない。fe-plan.md §1 確認事項B）。
 *
 * `<Dialog>` を薄くラップするだけで、フォーカストラップ・Escape・`aria-modal` は
 * すべて `<Dialog>` 側の実装をそのまま継承する（このコンポーネント自体は持たない）。
 *
 * **計算・判定をしない。** 確認・キャンセルの結果は呼び出し側にそのまま委ねる
 * （`.claude/rules/frontend.md`）。
 */
export interface ConfirmDialogProps {
  readonly open: boolean;
  /** `<Dialog>` の `aria-labelledby` に渡す見出し要素のID */
  readonly labelId: string;
  readonly title: string;
  readonly message: string;
  readonly confirmLabel?: string;
  readonly cancelLabel?: string;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

export function ConfirmDialog({
  open,
  labelId,
  title,
  message,
  confirmLabel = '削除する',
  cancelLabel = 'キャンセル',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const cancelButtonRef = useRef<HTMLButtonElement>(null);

  /**
   * CR-2: 開いた直後の初期フォーカスを破壊的操作（削除する）ボタンではなく
   * キャンセルボタンへ着地させる。DOM 順は確認ボタンが先・キャンセルボタンが後のまま
   * （design_mock のボタン配置に影響させない）。
   *
   * `Dialog.tsx` の「開いた瞬間、カード内の最初のフォーカス可能要素へ自動フォーカスする」
   * 一般ロジック（`Dialog.tsx:64-77`）自体は変更しない。React の effect は子（`Dialog`
   * 内部）から先に発火するため、まず `Dialog` が確認ボタンへフォーカスし、直後にこの
   * effect がキャンセルボタンへフォーカスを奪い直す。結果として最終的な初期フォーカスは
   * 常にキャンセルボタンに着地する。
   */
  useEffect(() => {
    if (open) cancelButtonRef.current?.focus();
  }, [open]);

  return (
    <Dialog open={open} onClose={onCancel} labelId={labelId}>
      <h2 id={labelId}>{title}</h2>
      <p>{message}</p>
      <button type="button" onClick={onConfirm}>
        {confirmLabel}
      </button>
      <button type="button" className="button-outline" onClick={onCancel} ref={cancelButtonRef}>
        {cancelLabel}
      </button>
    </Dialog>
  );
}
