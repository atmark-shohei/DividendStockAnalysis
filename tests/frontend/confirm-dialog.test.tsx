import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * `<ConfirmDialog>`（T-105 確認事項B）の構造テスト。
 *
 * `window.confirm`（ブラウザネイティブ）を `<Dialog>` ベースの独自モーダルへ置き換えるための
 * 汎用コンポーネント。`@testing-library/react` は未導入のため、`readFileSync` + 正規表現で
 * ソースを直接検証する既存パターン（`tests/frontend/dialog.test.tsx` 等）を踏襲する。
 */
const confirmDialogSource = readFileSync(
  resolve(__dirname, '../../frontend/components/ConfirmDialog.tsx'),
  'utf-8',
);

describe('ConfirmDialog.tsx: <Dialog> をラップしている（フォーカストラップ・Escape・aria-modal を継承する）', () => {
  it('<Dialog> をインポートして使っている（独自にモーダルの土台を実装していない）', () => {
    expect(confirmDialogSource).toMatch(/import \{ Dialog \} from '\.\/Dialog';/);
    expect(confirmDialogSource).toMatch(/<Dialog\s/);
  });

  it('open/onClose/labelId を <Dialog> にそのまま渡している（onClose は onCancel に委譲）', () => {
    expect(confirmDialogSource).toMatch(
      /<Dialog open=\{open\} onClose=\{onCancel\} labelId=\{labelId\}>/,
    );
  });
});

describe('ConfirmDialog.tsx: 確認・キャンセルの2択ボタンを持つ', () => {
  it('確認ボタンが onConfirm を呼ぶ', () => {
    expect(confirmDialogSource).toMatch(/onClick=\{onConfirm\}/);
  });

  it('キャンセルボタンが onCancel を呼ぶ（button-outline で二次的なボタンとして表現する）', () => {
    expect(confirmDialogSource).toMatch(/className="button-outline" onClick=\{onCancel\}/);
  });

  it('確認・キャンセルの文言に既定値を持つ（呼び出し側は既存の window.confirm 文言を message として渡すだけでよい）', () => {
    expect(confirmDialogSource).toMatch(/confirmLabel = '削除する'/);
    expect(confirmDialogSource).toMatch(/cancelLabel = 'キャンセル'/);
  });
});

describe('ConfirmDialog.tsx: title/message を計算せず、そのまま描画する（判定ロジックを持たない）', () => {
  it('title を見出しとして描画する', () => {
    expect(confirmDialogSource).toMatch(/<h2 id=\{labelId\}>\{title\}<\/h2>/);
  });

  it('message をそのまま描画する', () => {
    expect(confirmDialogSource).toMatch(/<p>\{message\}<\/p>/);
  });
});

/**
 * CR-2: 開いた直後の初期フォーカスがキャンセルボタンへ着地する（破壊的操作である
 * 「削除する」ボタンに着地しない）。
 *
 * `@testing-library/react` 未導入（`vitest.unit.config.ts` は `environment: 'node'`）のため、
 * 実際に `.focus()` が呼ばれ `document.activeElement` が変わるかは検証できない
 * （`Dialog.tsx` 自体の「DOM 副作用のためここはテスト対象外」という既存方針と同じ区分）。
 * 代わりに、次の3点をソース上で直接検証することで「Enter/Space を押しても即座に
 * 削除確定しない」という設計が壊れていないことを保証する:
 *   1. `cancelButtonRef` がキャンセルボタンに付き、確認（削除）ボタンには付いていない
 *      （取り違えるとフォーカスが確認ボタンに残ってしまうため）
 *   2. `open` が true のときだけ `cancelButtonRef.current?.focus()` を呼ぶ `useEffect` がある
 *   3. `Dialog` 自身の「最初のフォーカス可能要素へ自動フォーカスする」ロジック
 *      （`Dialog.tsx` 側）は変更しない（`git diff` で別途確認する対象）
 */
describe('ConfirmDialog.tsx: 開いた直後の初期フォーカスをキャンセルボタンへ寄せる（CR-2）', () => {
  it('useRef/useEffect を react から import している', () => {
    expect(confirmDialogSource).toMatch(/import \{ useEffect, useRef \} from 'react';/);
  });

  it('cancelButtonRef が useRef<HTMLButtonElement>(null) で生成されている', () => {
    expect(confirmDialogSource).toMatch(
      /const cancelButtonRef = useRef<HTMLButtonElement>\(null\);/,
    );
  });

  it('キャンセルボタンに ref={cancelButtonRef} が付いている', () => {
    expect(confirmDialogSource).toMatch(
      /className="button-outline" onClick=\{onCancel\} ref=\{cancelButtonRef\}/,
    );
  });

  it('確認（削除）ボタンには ref={cancelButtonRef} が付いていない（取り違え防止）', () => {
    const confirmButtonMatch = confirmDialogSource.match(
      /<button type="button" onClick=\{onConfirm\}>[\s\S]*?<\/button>/,
    );
    expect(confirmButtonMatch).not.toBeNull();
    expect(confirmButtonMatch?.[0] ?? '').not.toMatch(/ref=\{cancelButtonRef\}/);
  });

  it('open のときだけ cancelButtonRef へフォーカスする useEffect がある', () => {
    expect(confirmDialogSource).toMatch(
      /useEffect\(\(\) => \{\s*if \(open\) cancelButtonRef\.current\?\.focus\(\);\s*\}, \[open\]\);/,
    );
  });
});
