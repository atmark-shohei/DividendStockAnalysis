import type { ScoringResponse } from '../api';
import {
  payoutRatioAdoptedBadgeText,
  payoutRatioEquationText,
  payoutRatioEvidenceText,
  payoutRatioSideNoteText,
  payoutRatioSideScoreText,
} from '../format';

const SIDE_LABEL: Readonly<Record<'forecast' | 'actual', string>> = {
  forecast: '予想',
  actual: '実績',
};

export interface PayoutRatioSideCardProps {
  readonly side: 'forecast' | 'actual';
  readonly view: ScoringResponse['payoutRatioForecast'];
  readonly source: ScoringResponse['payoutRatioSource'];
}

/**
 * ③ 予想配当性向の詳細の、予想／実績カード1枚
 * （`docs/02_design/ui/pages/analysis-dialog.md` §5.3.1）。
 *
 * **データ取得も判定もしない。** 状態ごとの出し分け（赤字・無配・年度の食い違い・
 * 判定不能）は `format.ts` の関数に寄せてあり、ここは「文言が空か」「式が null か」
 * だけで描画を分ける。
 */
export function PayoutRatioSideCard({ side, view, source }: PayoutRatioSideCardProps) {
  const badge = payoutRatioAdoptedBadgeText(side, source);
  const equation = payoutRatioEquationText(view);
  const note = payoutRatioSideNoteText(view);

  return (
    <article className="payout-ratio-card">
      <header className="payout-ratio-card-header">
        <h3>{SIDE_LABEL[side]}</h3>
        {badge !== '' && <span className="adopted-badge">{badge}</span>}
      </header>
      <dl className="payout-ratio-evidence">
        <div className="payout-ratio-evidence-row">
          <dt>1株配当</dt>
          <dd className="numeric">
            {payoutRatioEvidenceText(view.dividendSen, view.dividendFiscalYear)}
          </dd>
        </div>
        <div className="payout-ratio-evidence-row">
          <dt>EPS</dt>
          <dd className="numeric">{payoutRatioEvidenceText(view.epsSen, view.epsFiscalYear)}</dd>
        </div>
      </dl>
      {/* 代入式は §5.3.1 の図どおり左寄せの等幅にする（`.numeric` は右寄せのため `.mono`） */}
      {equation !== null && <p className="mono">{equation}</p>}
      <p>スコア {payoutRatioSideScoreText(view)}</p>
      {note !== '' && <p className="meta">{note}</p>}
    </article>
  );
}
