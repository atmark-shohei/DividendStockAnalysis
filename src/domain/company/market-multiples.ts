/**
 * 株価と EPS / BPS から PER / PBR を導出する。
 *
 * ⑨ MIX係数の入力である `MarketMultiples`（`company.ts`）は、これまで
 * ユーザーが画面へ直接タイプする前提だった。IRバンク取り込み
 * （`docs/02_design/logic/irbank-json-import.md`）で EPS / BPS が手に入るようになり、
 * 株価さえ分かれば算出できる。
 *
 * **PER は予想EPSを優先する。** `MarketMultiples.per` は「会社予想PER」を
 * 名乗るので、予想EPSが取れる銘柄（業績ブロックに予想行がある）ではそれを使う。
 * 予想EPSが無い銘柄（§6 のとおり業績ブロックに予想行が無いことがある）だけ、
 * 直近実績のEPSで代用する。どちらを使ったかは `perSource` に残す
 * （2026-07-29 決定。`docs/adr/0008-frontend-domain-runtime-import.md` の
 * 未解決事項だった「出所を保存後も追跡するか」への回答）。
 *
 * **PBR は実績のみ。** IRバンクの財務ブロックに予想行が現れたことは無いため、
 * `forecast-bps` は存在しない。
 */

import { type MarketMultiples } from './company';

export interface DeriveMarketMultiplesInput {
  /** ユーザーが入力した現在株価（銭）。未入力なら `null` */
  readonly priceSen: number | null;
  /** 直近予想の1株利益（銭）。取れない銘柄では `null` */
  readonly latestForecastEpsSen: number | null;
  /** 直近実績の1株利益（銭） */
  readonly latestActualEpsSen: number | null;
  /** 直近実績の1株純資産（銭） */
  readonly latestActualBpsSen: number | null;
}

/** 株価を基準値で割る。基準が 0 以下ならゼロ除算・符号反転を避けて `null` */
function divide(priceSen: number, baseSen: number | null): number | null {
  if (baseSen === null || baseSen <= 0) return null;
  return priceSen / baseSen;
}

/**
 * PER / PBR を算出する。**株価が未入力なら両方 `null`**（判定不能。0 ではない）。
 *
 * 銭どうしの比なので単位は打ち消し合い、そのまま倍率になる。
 */
export function deriveMarketMultiples(input: DeriveMarketMultiplesInput): MarketMultiples {
  if (input.priceSen === null) {
    return { per: null, perSource: null, pbr: null, pbrSource: null };
  }

  const forecastPer = divide(input.priceSen, input.latestForecastEpsSen);
  const per = forecastPer ?? divide(input.priceSen, input.latestActualEpsSen);
  const perSource = forecastPer !== null ? 'forecast-eps' : per !== null ? 'actual-eps' : null;

  const pbr = divide(input.priceSen, input.latestActualBpsSen);
  const pbrSource = pbr !== null ? 'actual-bps' : null;

  return { per, perSource, pbr, pbrSource };
}
