export interface BalanceSheetFieldProps {
  readonly yen: string;
  readonly onChange: (value: string) => void;
  /** 欄の直下に出す注記。複数行になりうる。空文字は空の <p> として出す（既存の表示を維持） */
  readonly notes: readonly string[];
}

export interface BalanceSheetFieldsProps {
  readonly currentAssets: BalanceSheetFieldProps;
  readonly investmentSecurities: BalanceSheetFieldProps;
  readonly totalLiabilities: BalanceSheetFieldProps;
  readonly previousDividendTotal: BalanceSheetFieldProps;
}

/**
 * ⑥配当維持可能年数が使う貸借対照表4欄（流動資産・投資有価証券・負債総額・
 * 前期末の配当総額）の入力欄+注記。**データ取得・計算をしない。props を描画するだけ**
 * （`.claude/rules/frontend.md`）。ラベル文言・「IRバンクからは取り込めません」の
 * 固定注記はこのコンポーネントに閉じたレイアウト情報としてハードコードする
 * （4欄専用の切り出しであり、汎用フィールドコンポーネントではないため）。
 *
 * 注記の文言計算（`edinetAmountNoteText` / `importedAmountNoteText` /
 * `resolveEditedAmountNote` の呼び出し）は呼び出し元（`CompanyForm.tsx`）側で行い、
 * 完成済みの文字列だけを `notes` で受け取る（fe-fix-plan.md §4。`CompanyForm.tsx`
 * 内定義の非公開ロジックをこちらへ二重に import させないため）。
 */
export function BalanceSheetFields({
  currentAssets,
  investmentSecurities,
  totalLiabilities,
  previousDividendTotal,
}: BalanceSheetFieldsProps) {
  return (
    <>
      <label>
        流動資産（円）
        <input
          value={currentAssets.yen}
          onChange={(event) => currentAssets.onChange(event.target.value)}
          inputMode="decimal"
        />
      </label>
      {currentAssets.notes.map((note, index) => (
        <p className="meta" key={index}>
          {note}
        </p>
      ))}
      <label>
        投資有価証券（円）
        <input
          value={investmentSecurities.yen}
          onChange={(event) => investmentSecurities.onChange(event.target.value)}
          inputMode="decimal"
        />
      </label>
      {investmentSecurities.notes.map((note, index) => (
        <p className="meta" key={index}>
          {note}
        </p>
      ))}
      <label>
        負債総額（円）
        <input
          value={totalLiabilities.yen}
          onChange={(event) => totalLiabilities.onChange(event.target.value)}
          inputMode="decimal"
        />
      </label>
      {totalLiabilities.notes.map((note, index) => (
        <p className="meta" key={index}>
          {note}
        </p>
      ))}
      <label>
        前期末の配当総額（円）
        <input
          value={previousDividendTotal.yen}
          onChange={(event) => previousDividendTotal.onChange(event.target.value)}
          inputMode="decimal"
        />
      </label>
      {previousDividendTotal.notes.map((note, index) => (
        <p className="meta" key={index}>
          {note}
        </p>
      ))}
    </>
  );
}
