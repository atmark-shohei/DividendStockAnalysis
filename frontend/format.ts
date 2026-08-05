/**
 * 表示用の整形。**丸めるのはこのファイルの中だけ**（`.claude/rules/frontend.md`）。
 *
 * データが無い場合に `0` を表示しない。無配（0円）とデータ欠損は別物であり、
 * 混同すると利回り計算が壊れる。
 */

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

/** 採用した配当の出所。画面に必ず併記する（⑩ 設計書 §3.1） */
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
