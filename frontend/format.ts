/**
 * 表示用の整形。**丸めるのはこのファイルの中だけ**（`.claude/rules/frontend.md`）。
 *
 * データが無い場合に `0` を表示しない。無配（0円）とデータ欠損は別物であり、
 * 混同すると利回り計算が壊れる。
 */

import type { ScoringResponse } from './api';

/** データなしの表示。`0` と区別する */
export const NO_DATA = '—';

/** 判定不能の理由をユーザー向けの文言にする */
const REASON_TEXT: Readonly<Record<string, string>> = {
  'input-missing': 'データなし',
  'insufficient-history': '年数が足りません',
  'division-by-zero': '基準値が 0 のため算出できません',
  'undefined-growth': '基準値が負のため成長率を定義できません',
  'input-invalid': '入力値が不正です',
  'value-out-of-band': '区分表の範囲外です',
  'price-missing': '株価を入力してください',
  'price-zero': '株価が 0 です',
  'price-negative': '株価が負です',
  'price-too-large': '株価が大きすぎます（1株 1,000,000 円まで）',
  'price-invalid': '株価が不正です',
  'dividend-missing': '配当データがありません',
  'dividend-invalid': '配当データが不正です',
  /**
   * ④EPS CAGR・⑦売上高CAGR専用（`docs/02_design/logic/edinet-history-import.md` §4.3）。
   * EDINETの重複4期を突き合わせて遡及修正を検出したときに返る。文言は Manager決定
   * （2026-08-08。fe-plan.md §4.1 のドラフト案を採用・確定）。
   */
  'restated-history': '有価証券報告書の記載が年度をまたいで一致しないため、算出できません',
};

export function reasonText(reason: string | null): string {
  if (reason === null) return '';
  return REASON_TEXT[reason] ?? '判定できません';
}

/** 3桁区切り。**裸の数字を出さないため、単位は呼び出し側が必ず付ける** */
function grouped(value: number, fractionDigits: number): string {
  return value.toLocaleString('ja-JP', {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
}

/** 銭を「1,234 円」にする */
export function formatSen(sen: number | null): string {
  if (sen === null) return NO_DATA;
  return `${grouped(sen / 100, 2)} 円`;
}

/**
 * 指標の算出値を単位付きで整形する。
 *
 * ⑩ だけ値の単位が 1/100 % なので、パーセントへ戻してから丸める。
 * 判定は生値で行い、丸めるのはここだけ（⑩ 設計書 §2.2）。
 */
export function formatMetricValue(
  value: number | null,
  unit: string,
  isHundredthsPercent: boolean,
): string {
  if (value === null) return NO_DATA;
  const scaled = isHundredthsPercent ? value / 100 : value;
  if (unit === '年') return `${grouped(scaled, scaled % 1 === 0 ? 0 : 2)} 年`;
  if (unit === '倍') return `${grouped(scaled, 2)} 倍`;
  return `${grouped(scaled, 2)}%`;
}

/** UTC の ISO 文字列を JST 表示にする。**保存は UTC、表示だけ JST**（`CLAUDE.md`） */
export function formatFetchedAt(isoUtc: string): string {
  const date = new Date(isoUtc);
  if (Number.isNaN(date.getTime())) return NO_DATA;
  return `${date.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}（JST）`;
}

/**
 * 株価の観測時刻（`priceAsOf`）を JST 表示にする。**保存は UTC、表示だけ JST**
 * （`CLAUDE.md`）。
 *
 * `formatFetchedAt` とは別関数にしてある。`priceAsOf` は保存時刻ではなく
 * Yahoo が返した観測時刻そのもので、`null`（取れなかった）を受けたときの文言も違う
 * （`docs/02_design/logic/market-data-source.md` §7.4）。
 */
export function formatPriceAsOf(isoUtc: string | null): string {
  if (isoUtc === null) return '取得時刻不明';
  const date = new Date(isoUtc);
  if (Number.isNaN(date.getTime())) return '取得時刻不明';
  return `${date.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}（JST）`;
}

/**
 * 採用した配当の出所。画面に必ず併記する（⑩ 設計書 §3.1）。
 *
 * `'forecast' | 'actual' | null` → `'予想' | '実績' | NO_DATA` の汎用変換であり、
 * ⑩ 配当利回りの採用元表示だけでなく、③ 予想配当性向の採用元表示
 * （`payoutRatioBreakdownText` 内）にも共通利用する（型が同一のため）。
 */
export function dividendSourceText(source: 'forecast' | 'actual' | null): string {
  if (source === 'forecast') return '予想';
  if (source === 'actual') return '実績';
  return NO_DATA;
}

/**
 * ⑨ PER/PBR の出所。画面に併記する（2026-07-29 追加。
 * `docs/adr/0008-frontend-domain-runtime-import.md` の未解決事項への回答）。
 *
 * 値が空のときは何も出さない（データなし表示は入力欄自体が空欄で示すため、
 * ここで重ねて `—` を出さない）。
 */
export function multipleSourceText(
  source: 'forecast-eps' | 'actual-eps' | 'actual-bps' | 'manual' | null,
): string {
  switch (source) {
    case 'forecast-eps':
      return '予想EPSから算出';
    case 'actual-eps':
      return '実績EPSから算出（予想EPSなし）';
    case 'actual-bps':
      return '実績BPSから算出';
    case 'manual':
      return '手入力';
    case null:
      return '';
  }
}

/**
 * ③ 予想配当性向の内訳（予想または実績いずれか片側）の判定結果。
 * ハンドラ DTO の `ScoringResponse['payoutRatioForecast']`（`PayoutRatioSideView`。
 * `src/handler/dto/company-input.ts`）を type alias として使う。手書きで再定義しない
 * （`frontend/components/MetricTable.tsx` の書き方に揃える。二重定義しない）。
 */
type PayoutRatioBreakdown = ScoringResponse['payoutRatioForecast'];

/**
 * ③ 予想配当性向の内訳（予想/実績それぞれの算出値・スコア・採用元）を1行の文言にする。
 *
 * `docs/02_design/logic/payout-ratio-scoring.md` §7。判定不能（`null`）は `NO_DATA` +
 * 理由文言にする。無配（0%・判定可）は `0.00%` / `0点` を出す。**0 と null を混同しない**
 * （`.claude/rules/frontend.md`「データが無い場合に 0 を表示しない」）。
 */
export function payoutRatioBreakdownText(
  forecast: PayoutRatioBreakdown,
  actual: PayoutRatioBreakdown,
  source: 'forecast' | 'actual' | null,
): string {
  const part = (label: string, breakdown: PayoutRatioBreakdown): string => {
    const value = formatMetricValue(breakdown.value, '%', false);
    const score = breakdown.score === null ? NO_DATA : `${String(breakdown.score)} 点`;
    const reason =
      breakdown.unavailableReason === null ? '' : `（${reasonText(breakdown.unavailableReason)}）`;
    return `${label} ${value} / ${score}${reason}`;
  };
  return `${part('予想', forecast)}／${part('実績', actual)}／採用: ${dividendSourceText(source)}`;
}

/**
 * 決算年度を「2026年3月期」の形にする（`docs/02_design/logic/balance-sheet-derivation.md` §2.3）。
 *
 * ⑥ の入力（負債総額・前期末の配当総額）はどの決算年度の値かを持たないと、
 * 「3年前の負債総額」と「今期の配当総額」を混ぜたことに誰も気づけない。年度を
 * 画面に出して人が判断する。
 *
 * 決算月は取り込みで一意に定まらないことがある（決算期変更の疑いで
 * `fiscalYearEndMonth` が `null`。同 §10-3）。そのときは「2026年度」までにとどめ、
 * **月を推測しない。** 年度自体が無ければ `0年3月期` のような偽の期を作らず `—` を返す。
 */
export function fiscalPeriodLabel(fiscalYear: number | null, endMonth: number | null): string {
  if (fiscalYear === null) return NO_DATA;
  if (endMonth === null) return `${String(fiscalYear)}年度`;
  return `${String(fiscalYear)}年${String(endMonth)}月期`;
}

/**
 * 銭を編集可能なテキスト入力の初期値にする。**表示用の `formatSen` とは別物。**
 *
 * 3桁区切りや単位を付けない。ユーザーがそのまま編集を続けられる形（`yenToSen` が
 * 読める形）で返す（IRバンク取り込みのプレフィル。`CompanyForm.tsx`）。
 *
 * 銭は整数なので `/ 100` は常に小数第2位までの値になり、`toString()` の
 * 最短往復表現がそのまま正しい10進表記になる（二重丸めは起きない）。
 */
export function senToEditableText(sen: number | null): string {
  if (sen === null) return '';
  return (sen / 100).toString();
}

/**
 * ①線グラフ下の表・前年比（`docs/02_design/ui/pages/analysis-dialog.md` §5.1）。
 * `▲ +N円` / `▼ -N円` / `－ 据置` / `NO_DATA`（前年データが無い・当年データが無い）。
 * **`±0円` にしない**（データ欠損と「変化なし」を区別する。§9受入基準）。
 * 色は中立トークンのみ（Manager決定。`design-tokens.md` §2.2「スコア・増配率・成長率には
 * `--color-positive`/`--color-negative` を使わない」）。glyph＋文言で意味を示す。
 */
export function dividendYoyChangeText(
  currentSen: number | null,
  previousSen: number | null | undefined,
): string {
  if (currentSen === null || previousSen === null || previousSen === undefined) return NO_DATA;
  const diff = currentSen - previousSen;
  if (diff === 0) return '－ 据置';
  const sign = diff > 0 ? '▲ +' : '▼ -';
  return `${sign}${grouped(Math.abs(diff) / 100, 2)}円`;
}

/**
 * 比率（%・倍）を編集可能なテキスト入力の初期値にする。
 *
 * ROE・配当性向のようにソースが元々2桁程度の比率はそのまま返るが、
 * このアプリ内で除算して求めた値（営業利益率、PER/PBR）は浮動小数点の
 * 誤差で末尾が長く伸びる（例: `18.101785021694145`）。編集欄がそのまま
 * 送信対象にもなるため、`formatMetricValue` の表示丸め桁数（小数第2位）に
 * 揃えてここで丸める。判定（スコア計算）は別経路の生値で行うため影響しない。
 */
export function ratioToEditableText(value: number | null): string {
  if (value === null) return '';
  return (Math.round(value * 100) / 100).toString();
}
