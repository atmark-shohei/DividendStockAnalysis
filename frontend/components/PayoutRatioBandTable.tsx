import type { ScoringResponse } from '../api';
import { formatPayoutRatioBandRange, payoutRatioBandMarkerText } from '../format';

export interface PayoutRatioBandTableProps {
  /** 採点に実際に使った区分表（指標カスタマイズ時は上書き後の表）。`GET /api/scoring/bands` は使わない */
  readonly bands: ScoringResponse['payoutRatioBands'];
  /** 予想側の `matchedBandIndex`。判定不能・0点規則のときは `null`（マーカーを出さない） */
  readonly forecastIndex: number | null;
  /** 実績側の `matchedBandIndex`。同上 */
  readonly actualIndex: number | null;
  /** 指標名（caption 用） */
  readonly label: string;
}

/**
 * ③ 予想配当性向の詳細の区分表＋該当マーカー（`analysis-dialog.md` §5.3.1）。
 *
 * **区分の判定をしない。** マーカーは BE の `matchedBandIndex` と行の添字が等しいかだけで
 * 決め、`minInclusive`/`maxExclusive` と値を比べない。`/criteria` の `MetricCriteriaCard` とは
 * マーカー列があるため共有しない（§5.3.1「置かないもの」）。
 */
export function PayoutRatioBandTable({
  bands,
  forecastIndex,
  actualIndex,
  label,
}: PayoutRatioBandTableProps) {
  return (
    <div>
      <table className="metric-table">
        <caption>{`${label} の区分表`}</caption>
        <thead>
          <tr>
            <th scope="col">条件</th>
            <th scope="col" className="numeric">
              点数
            </th>
            <th scope="col">該当</th>
          </tr>
        </thead>
        <tbody>
          {bands.map((band, index) => {
            const marker = payoutRatioBandMarkerText(index, forecastIndex, actualIndex);
            return (
              // BE DTO に安定した ID が無いため index を使う（`MetricCriteriaCard.tsx` と同じ理由）。
              // `matchedBandIndex` もこの添字を指す
              <tr key={index}>
                <td>{formatPayoutRatioBandRange(band)}</td>
                <td className="numeric">{`${String(band.points)} 点`}</td>
                <td>
                  {marker !== '' && (
                    <>
                      <span aria-hidden="true">▶</span> {marker}
                    </>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {/* criteria-tab.md §2.3 と同じ文言（T-108 Q4: 定数化せずリテラルで持つ） */}
      <p className="criteria-note">各区分は下限以上・上限未満（最上位のみ上が開く）</p>
    </div>
  );
}
