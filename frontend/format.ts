/**
 * 表示用の整形。**丸めるのはこのファイルの中だけ**（`.claude/rules/frontend.md`）。
 *
 * データが無い場合に `0` を表示しない。無配（0円）とデータ欠損は別物であり、
 * 混同すると利回り計算が壊れる。
 */

import type { ConsecutiveYearRowResponse, ScoringResponse } from './api';

/** データなしの表示。`0` と区別する */
export const NO_DATA = '—';

/**
 * 「総合点は比較不能」の注記（ADR-0012 §決定D-3）。指標カスタマイズ画面
 * （`IndicatorCustomPage.tsx`）と解析ダイアログ（`ListPage.tsx` の `ScoringBody`）の
 * 両方から同一文言を import し、文言の食い違いを防ぐ。**常時表示・非表示にできない**
 * （両画面とも条件付きレンダリングにしないこと）。
 *
 * TODO(T-101・推測実装): 解析ダイアログ側にこの注記を出す際の正確な文言は
 * `docs/02_design/ui/pages/indicator-custom-page.md` §2 の ASCII 図から採録したもので、
 * 解析ダイアログ側の文言そのものは設計書に指定が無い。指標カスタマイズ画面と
 * 同一文言を流用する判断（推測実装）。
 */
export const TOTAL_SCORE_COMPARISON_NOTE =
  '※ 指標の選択・基準値が異なる相手とは総合点を単純比較できません';

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
 * ②連続非減配年数の年次リストが使う型（`docs/02_design/ui/pages/analysis-dialog.md` §5.2）。
 * BE `src/domain/scoring/consecutive-years.ts` の `ConsecutiveYearState` そのもの
 * （`ConsecutiveYearRowResponse['state']` として type alias。二重定義しない）。
 *
 * **増配／据置／減配の判定はBE domain側で確定済み**（`GET /api/companies/:code/dividends`
 * の `consecutiveYearRows[].state`）。①の `dividendYoyChangeText` と異なり、
 * FEは差分の符号を再計算しない。glyph・状態語への変換のみを担う
 * （`.claude/rules/frontend.md`「計算・判定をしない」）。
 */
type ConsecutiveYearState = ConsecutiveYearRowResponse['state'];

/**
 * ②年次リストの glyph（`▲`/`－`/`▼`）。`state` が `null`（先頭行・判定不能）は NO_DATA。
 * 色は中立トークンのみ（design-tokens.md §2.2「スコア・増配率・成長率には
 * `--color-positive`/`--color-negative` を使わない」。①と同じ方針）。
 */
export function dividendYoyGlyph(state: ConsecutiveYearState): string {
  if (state === 'increase') return '▲';
  if (state === 'decrease') return '▼';
  if (state === 'flat') return '－';
  return NO_DATA;
}

/** ②年次リストの状態語（増配／据置／減配）。`state` が `null` は NO_DATA */
export function dividendYoyStateLabel(state: ConsecutiveYearState): string {
  if (state === 'increase') return '増配';
  if (state === 'decrease') return '減配';
  if (state === 'flat') return '据置';
  return NO_DATA;
}

/**
 * ②年次リストの前年差（金額のみ。glyphは含まない。§5.2 は glyph・状態語・金額・前年差を
 * 別要素として要求するため、①の `dividendYoyChangeText`（glyph+符号+金額を1文字列に
 * 結合）とは別関数にする）。
 *
 * `diffSen` はBEが算出済みの値（`ConsecutiveYearRowResponse.diffSen`）をそのまま整形する。
 * **FEでは current - previous を再計算しない。**
 * "+100.00円" / "-100.00円" / "0円"（本当に差が0）/ NO_DATA（前年比較ができない）。
 * **`±0円` にしない**（データ欠損と「変化なし」を区別する。①と同じ判断）。
 */
export function dividendYoyDiffText(diffSen: number | null): string {
  if (diffSen === null) return NO_DATA;
  if (diffSen === 0) return '0円';
  const sign = diffSen > 0 ? '+' : '-';
  return `${sign}${grouped(Math.abs(diffSen) / 100, 2)}円`;
}

/**
 * ②年次リスト末尾の要約行（`analysis-dialog.md` §5.2「減配のない状態が
 * `consecutiveYears`年 継続中です。」）。`consecutiveYears` は `activeMetric.value`
 * （BEのスコアリング結果。`consecutive-years-scoring.md`）をそのまま使う。
 *
 * **`0`年は判定可能な結果であり NO_DATA にしない**（直近が減配でも0年という
 * 確定した答え。`consecutive-years-scoring.md` §6.3）。`null`（判定不能。配当履歴が
 * 空、または判定範囲内に欠損）のときだけ NO_DATA を返す。
 */
export function consecutiveYearsSummaryText(consecutiveYears: number | null): string {
  if (consecutiveYears === null) return NO_DATA;
  return `減配のない状態が${String(consecutiveYears)}年継続中です。`;
}

/**
 * 評価基準タブ（T-099）の区分表1行を「◯以上 ◯未満」の文言にする。
 *
 * **計算・判定はしない。** BE（`GET /api/scoring/bands`）が返した
 * `minInclusive`/`maxExclusive` をそのまま整形するだけ（`.claude/rules/frontend.md`）。
 * 丸め・単位付与は既存の `formatMetricValue` を再利用する（⑩の1/100%スケーリングも
 * そちらに内包済みのため、ここで二重実装しない）。
 *
 * `minInclusive === null` は下限なし（⑤ROEの最下段のみ。`bands.ts` の不変条件）、
 * `maxExclusive === null` は上限なし（最上位区分）。**両方が `null` の行は
 * 区分表として不正**（`bands.ts` の不変条件を BE が破った場合）なので、
 * non-null assertion で無言クラッシュさせず `NO_DATA` を返す。
 */
export function formatBandRange(
  band: { readonly minInclusive: number | null; readonly maxExclusive: number | null },
  unit: string,
  isHundredthsPercent: boolean,
): string {
  const bound = (value: number): string => formatMetricValue(value, unit, isHundredthsPercent);
  const { minInclusive, maxExclusive } = band;

  // ネストした if で分岐する（型アサーションを使わないため。`minInclusive === null &&
  // maxExclusive === null` のような && 条件をトップレベルの早期 return にすると、
  // TypeScript の制御フロー解析は「少なくとも一方は非 null」までしか推論できず、
  // 後続の分岐で他方が非 null であることを narrowing できない。ネストにすることで
  // 各分岐内で該当プロパティが number であることをそのまま narrowing させる）
  if (minInclusive === null) {
    if (maxExclusive === null) return NO_DATA;
    return `${bound(maxExclusive)}未満`;
  }
  if (maxExclusive === null) return `${bound(minInclusive)}以上`;
  return `${bound(minInclusive)}以上 ${bound(maxExclusive)}未満`;
}

/**
 * ポートフォリオの評価損益（T-103・`docs/02_design/ui/pages/portfolio-page.md` §4.3）。
 * `▲ +82,340.00 円` / `▼ -12,000.00 円` / `－ 0.00 円`。**FEは符号判定のみ行い、
 * 差分自体（評価額 - 取得総額）はBEが計算済みの値をそのまま使う**
 * （`.claude/rules/frontend.md`「計算・判定をしない」）。金額部分は `formatSen` と
 * 同じ書式（3桁区切り・小数第2位・末尾スペース+円）に揃え、先頭に glyph+符号だけ足す。
 * `null`（現在株価未取得等でBEが算出不能）は NO_DATA。**`±0.00 円` にしない**
 * （据置き=0と判定不能=null を区別する。`dividendYoyChangeText` と同じ判断）。
 */
export function formatUnrealizedGainLossSen(sen: number | null): string {
  if (sen === null) return NO_DATA;
  if (sen === 0) return `－ ${formatSen(0)}`;
  const sign = sen > 0 ? '▲ +' : '▼ -';
  return `${sign}${grouped(Math.abs(sen) / 100, 2)} 円`;
}

/**
 * 評価損益の色クラス（`pl-positive`/`pl-negative`）。**評価損益専用**
 * （`design-tokens.md` §2.2「スコア・利回り・増配率には使わない」。`portfolio-page.md` §4.3）。
 * `0`・`null` は色なし（`undefined`）。色だけで増減を表さないため、
 * 呼び出し側は必ず `formatUnrealizedGainLossSen`（▲/▼ の glyph）とセットで使うこと。
 */
export function unrealizedGainLossColorClass(
  sen: number | null,
): 'pl-positive' | 'pl-negative' | undefined {
  if (sen === null || sen === 0) return undefined;
  return sen > 0 ? 'pl-positive' : 'pl-negative';
}

/**
 * ポートフォリオのスコア平均（T-103・`portfolio-page.md` §4「スコア平均: 小数第1位」）。
 * `formatMetricValue` は単位（%・倍・年）付き整形のため使えない（スコア平均は単位なしの
 * 素の数値）。保有0件（BE側が `null` を返す。ゼロ除算を「0点」と誤表示しない）は NO_DATA。
 */
export function formatScoreAverage(value: number | null): string {
  if (value === null) return NO_DATA;
  return grouped(value, 1);
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
