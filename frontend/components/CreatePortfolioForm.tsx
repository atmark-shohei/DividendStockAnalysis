import { useState } from 'react';

import { portfolioNameErrorText } from '../pages/portfolio-page-logic';

/**
 * 「＋ 作成」フォーム（T-103）。ポートフォリオ名だけを入力する最小フォーム。
 *
 * TODO(T-103・推測実装): `docs/02_design/ui/pages/portfolio-page.md` はポートフォリオ本体の
 * 作成フォームのUI形式（モーダル/インライン）を明記していない（§5 が言及するのは
 * 「＋ 銘柄を追加」フォームのみ）。保有銘柄追加フォームと一貫させるため、同じ
 * `<Dialog>` モーダル方式を採用した（fe-plan.md §1 確認事項D の決定を、設計書に
 * 記載の無いポートフォリオ作成フォームにも類推適用。Manager確認が必要な場合は本コメントを参照）。
 *
 * ローカル state で編集中値を持つ（`.claude/rules/frontend.md`「フォームの編集中値は
 * 一時的にコピーせざるを得ない」）。
 */
export function CreatePortfolioForm({
  onSubmit,
  onCancel,
  submitting,
  submitError,
}: {
  readonly onSubmit: (name: string) => void;
  readonly onCancel: () => void;
  readonly submitting: boolean;
  readonly submitError: string | null;
}) {
  const [name, setName] = useState('');
  const error = name === '' ? null : portfolioNameErrorText(name);
  const canSubmit = portfolioNameErrorText(name) === null;

  return (
    <div>
      <h2 id="create-portfolio-title">ポートフォリオを作成</h2>
      <label>
        名前
        <input
          type="text"
          value={name}
          disabled={submitting}
          aria-invalid={error !== null}
          onChange={(event) => {
            setName(event.target.value);
          }}
        />
      </label>
      {error !== null && (
        <p className="warning" role="alert">
          {error}
        </p>
      )}
      {submitError !== null && (
        <p className="error" role="alert">
          {submitError}
        </p>
      )}
      <button
        type="button"
        onClick={() => {
          if (canSubmit) onSubmit(name.trim());
        }}
        disabled={submitting || !canSubmit}
      >
        作成する
      </button>
      <button type="button" className="button-outline" onClick={onCancel} disabled={submitting}>
        キャンセル
      </button>
    </div>
  );
}
