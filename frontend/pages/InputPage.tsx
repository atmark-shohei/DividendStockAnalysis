import type { AnalyzeCompanyRequest } from '../api';
import { CompanyForm } from '../components/CompanyForm';

/**
 * データ入力だけの画面（`/input`）。
 *
 * 解析に成功したら一覧画面（`/?code=...`）へ遷移する。結果をここに出さないのは
 * 「入力と保存済み銘柄を完全に分ける」という決定による（`screen-list.md`）。
 * 遷移は `App` が行う。この画面はデータ取得も遷移もしない。
 */
export function InputPage({
  onSubmit,
  disabled,
}: {
  readonly onSubmit: (payload: AnalyzeCompanyRequest) => void;
  readonly disabled: boolean;
}) {
  return (
    <section>
      <h2>データ入力</h2>
      <p className="meta">
        解析すると保存され、一覧画面へ移動して結果を表示します。入力内容は保存後に破棄されます。
      </p>
      <CompanyForm onSubmit={onSubmit} disabled={disabled} />
    </section>
  );
}
