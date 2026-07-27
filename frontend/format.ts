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

/** 採用した配当の出所。画面に必ず併記する（⑩ 設計書 §3.1） */
export function dividendSourceText(source: 'forecast' | 'actual' | null): string {
  if (source === 'forecast') return '予想';
  if (source === 'actual') return '実績';
  return NO_DATA;
}
