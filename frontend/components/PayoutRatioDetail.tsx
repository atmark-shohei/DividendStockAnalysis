import type { ScoringResponse } from '../api';
import { formatFetchedAt, payoutRatioBreakdownText } from '../format';
import { PAYOUT_RATIO_FORMULA } from '../pages/criteria-content';
import { PayoutRatioBandTable } from './PayoutRatioBandTable';
import { PayoutRatioSideCard } from './PayoutRatioSideCard';

export interface PayoutRatioDetailProps {
  readonly scoring: ScoringResponse;
  /** 指標名（区分表の caption 用。`activeMetric.label`） */
  readonly metricLabel: string;
}

/**
 * ③ 予想配当性向の指標詳細（`docs/02_design/ui/pages/analysis-dialog.md` §5.3.1、T-108）。
 * 入力日時 → 記号式 → 要約行 → 予想／実績の2カード → 区分表 の順に描画する。
 *
 * **データ取得しない。** 必要な値はすべて `GET /api/companies/:code` の `ScoringResponse` に
 * 含まれる（追加の API 呼び出しは無い）。判定（区分・0点規則・年度比較）も BE で確定済み。
 *
 * 採点ソースを切り替えるチェックボックスは置かない（概要モードにだけ置く。§5.3.1「置かないもの」）。
 */
export function PayoutRatioDetail({ scoring, metricLabel }: PayoutRatioDetailProps) {
  return (
    <div>
      <p className="meta">
        入力日時: <span className="numeric">{formatFetchedAt(scoring.fetchedAt)}</span>
      </p>
      {/* `/criteria` と同じ定数から描画する。カードには繰り返さない */}
      <pre className="criteria-formula">{PAYOUT_RATIO_FORMULA}</pre>
      <p className="meta">
        {payoutRatioBreakdownText(
          scoring.payoutRatioForecast,
          scoring.payoutRatioActual,
          scoring.payoutRatioSource,
        )}
      </p>
      {/* 片側が判定不能でも2枚とも常に出す（§5.3.1「カード」） */}
      <div className="payout-ratio-cards">
        <PayoutRatioSideCard
          side="forecast"
          view={scoring.payoutRatioForecast}
          source={scoring.payoutRatioSource}
        />
        <PayoutRatioSideCard
          side="actual"
          view={scoring.payoutRatioActual}
          source={scoring.payoutRatioSource}
        />
      </div>
      <PayoutRatioBandTable
        bands={scoring.payoutRatioBands}
        forecastIndex={scoring.payoutRatioForecast.matchedBandIndex}
        actualIndex={scoring.payoutRatioActual.matchedBandIndex}
        label={metricLabel}
      />
    </div>
  );
}
