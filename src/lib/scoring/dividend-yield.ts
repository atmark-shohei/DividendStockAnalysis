/**
 * 指標⑩ 配当利回りのスコアリング。
 *
 * 仕様: `docs/02_design/logic/dividend-yield-scoring.md`
 * スコア表の原典: `docs/01_requirements/scoring-requirements.md` の指標⑩
 *
 * この層は純粋関数のみ。DB にも HTTP にも触らない（`.claude/rules/backend.md`）。
 */

import { lookupPoints, type ScoreBand } from './score-table';

/** 金額は銭単位の整数。浮動小数点を金額計算に使わない（`CLAUDE.md`）。 */
export type Sen = number;

/** 採用した配当が予想か実績か。画面に併記する（§3.1）。 */
export type DividendSource = 'forecast' | 'actual';

/** 配当履歴の「区分」列。`修正` は予想の更新版として扱う。 */
export type DividendRecordKind = 'forecast' | 'revised' | 'actual';

export interface DividendRecord {
  /** 決算年度。2024年3月期なら 2024 */
  readonly fiscalYear: number;
  readonly kind: DividendRecordKind;
  /** 年間配当の合計（銭）。その年のデータが無ければ `null`（0 ではない） */
  readonly annualAmountSen: Sen | null;
}

export interface SelectedDividend {
  readonly amountSen: Sen;
  readonly source: DividendSource;
}

/**
 * 判定できなかった理由。設計書 §4 の表の行と 1 対 1 で対応させる。
 * 「計算できなかった」と「計算した結果が最低点」を区別するために持つ。
 *
 * `price-too-large` / `price-invalid` / `dividend-invalid` は原典に無い防御的な分類。
 * 外部データは常に壊れている前提で扱う規約（`.claude/rules/backend.md`）に基づく。
 * 詳細は設計書 §6 の変更点を参照。
 *
 * 配当額が負は**理由コードを持たない**。判定不能ではなく 0点（無配と同じ扱い）。
 */
export type YieldUnavailableReason =
  | 'price-missing'
  | 'price-zero'
  | 'price-negative'
  | 'price-too-large'
  | 'price-invalid'
  | 'dividend-missing'
  | 'dividend-invalid';

export interface DividendYieldInput {
  /** 現在の株価（銭）。ユーザーの手入力。未入力なら `null` */
  readonly priceSen: Sen | null;
  /** 採用した年間配当。配当データが1件も無ければ `null` */
  readonly dividend: SelectedDividend | null;
}

export interface DividendYieldResult {
  /** 0〜10。判定不能なら `null`（0 ではない） */
  readonly score: number | null;
  /** 表示用の利回り。1/100 % 単位の整数（550 = 5.50%）。判定不能なら `null` */
  readonly yieldHundredthsPercent: number | null;
  readonly dividendSource: DividendSource | null;
  readonly unavailableReason: YieldUnavailableReason | null;
}

/**
 * スコア表。閾値は 1/100 % 単位の整数（550 = 5.50%）。
 * 小数で持つと閾値そのものが丸め誤差を抱えるため、整数で持つ。
 *
 * 穴・重複が無いことは `score-table.test.ts` で `assertContiguous` により検証する。
 */
export const DIVIDEND_YIELD_BANDS: readonly ScoreBand[] = [
  { minInclusive: 550, maxExclusive: null, points: 10 },
  { minInclusive: 525, maxExclusive: 550, points: 9 },
  { minInclusive: 500, maxExclusive: 525, points: 8 },
  { minInclusive: 475, maxExclusive: 500, points: 7 },
  { minInclusive: 450, maxExclusive: 475, points: 6 },
  { minInclusive: 425, maxExclusive: 450, points: 5 },
  { minInclusive: 400, maxExclusive: 425, points: 4 },
  { minInclusive: 375, maxExclusive: 400, points: 3 },
  { minInclusive: 350, maxExclusive: 375, points: 2 },
  { minInclusive: 325, maxExclusive: 350, points: 1 },
  { minInclusive: 0, maxExclusive: 325, points: 0 },
];

/** 同一年度に複数の区分が並んだときの優先度。修正は予想の更新版なので上。 */
const KIND_PRIORITY: Readonly<Record<DividendRecordKind, number>> = {
  revised: 2,
  forecast: 1,
  actual: 0,
};

type UsableRecord = DividendRecord & { readonly annualAmountSen: Sen };

function pickLatest(
  records: readonly UsableRecord[],
  kinds: readonly DividendRecordKind[],
): UsableRecord | null {
  let best: UsableRecord | null = null;
  for (const record of records) {
    if (!kinds.includes(record.kind)) continue;
    if (best === null || record.fiscalYear > best.fiscalYear) {
      best = record;
      continue;
    }
    // 配列の並び順に結果が左右されないよう、同年度は区分の優先度で決める
    if (
      record.fiscalYear === best.fiscalYear &&
      KIND_PRIORITY[record.kind] > KIND_PRIORITY[best.kind]
    ) {
      best = record;
    }
  }
  return best;
}

/**
 * 配当履歴から利回り計算に使う年間配当を選ぶ（§2.1）。
 *
 * **取り込んだデータの最新年度に「予想（または修正）」があればそれを採用し、
 * 最新年度に予想が無い場合のみ最新の「実績」を採用する**（2026-07-27 決定）。
 *
 * 年度を見ずに予想を一律優先すると、FY2019 の予想が FY2024 の実績を上書きし、
 * 画面には「予想」とだけ出るのでいつ時点の値か分からなくなる
 * （`CLAUDE.md`「古いデータを最新として表示しない」に反する）。
 *
 * 採用元を返すのは、画面に「予想」か「実績」かを併記するため。
 *
 * @returns 使える配当が1件も無ければ `null`
 */
export function selectAnnualDividend(records: readonly DividendRecord[]): SelectedDividend | null {
  // 金額が null の年は「データなし」。0 とは違うので採用対象から外す。
  // 年度が壊れているレコードも外す。混ざると「最新年度」の判定ごと壊れる
  const usable = records.filter(
    (r): r is UsableRecord => r.annualAmountSen !== null && Number.isSafeInteger(r.fiscalYear),
  );
  if (usable.length === 0) return null;

  const latestYear = usable.reduce(
    (max, record) => (record.fiscalYear > max ? record.fiscalYear : max),
    Number.NEGATIVE_INFINITY,
  );
  const latestForecast = pickLatest(
    usable.filter((record) => record.fiscalYear === latestYear),
    ['forecast', 'revised'],
  );
  if (latestForecast !== null) {
    return { amountSen: latestForecast.annualAmountSen, source: 'forecast' };
  }

  const actual = pickLatest(usable, ['actual']);
  if (actual !== null) return { amountSen: actual.annualAmountSen, source: 'actual' };

  // 最新年度のレコードは予想か実績のどちらかなので、通常ここには来ない。
  // 区分が増えたときに黙って壊れないよう残してある
  return null;
}

/**
 * 業務上の株価上限。1株 1,000,000 円（2026-07-27 決定）。
 *
 * これを超える株価は日本株には事実上存在しないので、桁の打ち間違いとみなして弾く。
 * 画面側の入力欄もこの値で範囲検証すること（`.claude/rules/frontend.md`）。
 */
export const MAX_PRICE_SEN = 1_000_000 * 100;

/**
 * 判定式が扱える配当の上限。`配当 * 10000` が安全整数に収まる範囲。
 *
 * **オペランドが安全整数でも、積は安全整数とは限らない。**
 * `Number.isSafeInteger` を通った値でも積が範囲を超えると比較結果が静かに逆転する
 * （実測: 株価 9007199254740991 銭で 5.25% の判定が 9点 / 厳密には 8点）。
 * 「整数比較だから厳密」という前提を成立させるには、積のほうを縛る必要がある。
 *
 * 株価側は業務上限 `MAX_PRICE_SEN` が算術上の安全域よりはるかに小さいので、
 * 業務上限だけ見れば足りる（`閾値 * 株価` は最大でも 550 * 1e8 = 5.5e10）。
 * この関係が崩れていないことは `dividend-yield.test.ts` で検証する。
 */
export const MAX_DIVIDEND_SEN = Math.floor(Number.MAX_SAFE_INTEGER / 10_000);

/**
 * 銭として扱える値か。`NaN` / `Infinity` / 小数 / 安全整数の範囲外を弾く。
 *
 * これを通さないと `NaN` が比較のガードをすべて素通りする。
 * `NaN < 0` も `NaN >= 0` も false なので、判定不能ではなく**最高点**に落ちる。
 */
function isValidSen(value: number): boolean {
  return Number.isSafeInteger(value);
}

/**
 * 配当利回りを算出し、スコア表で採点する。
 *
 * **判定は丸めていない値で行う**（§2.2）。丸めてから判定すると境界で結果が変わる:
 * 実際の利回り 5.4951% は、丸めると 5.50% で 10点、丸めなければ 9点。
 */
export function calculateDividendYield(input: DividendYieldInput): DividendYieldResult {
  const { priceSen, dividend } = input;

  const unavailable = (reason: YieldUnavailableReason): DividendYieldResult => ({
    score: null,
    yieldHundredthsPercent: null,
    dividendSource: null,
    unavailableReason: reason,
  });

  if (priceSen === null) return unavailable('price-missing');
  if (!isValidSen(priceSen)) return unavailable('price-invalid');
  // §4 は 0 と負で別のメッセージを出すよう定めているので、理由コードも分ける
  if (priceSen === 0) return unavailable('price-zero');
  if (priceSen < 0) return unavailable('price-negative');
  if (priceSen > MAX_PRICE_SEN) return unavailable('price-too-large');

  if (dividend === null) return unavailable('dividend-missing');
  if (!isValidSen(dividend.amountSen) || dividend.amountSen > MAX_DIVIDEND_SEN) {
    return unavailable('dividend-invalid');
  }

  // 配当が負になるのは制度上ありえない。データの都合で負が入ってきたときは
  // 無配（0円）と同じ扱いにする（2026-07-27 決定。§4 / §6 変更点5）。
  // 判定不能に倒さないのは、③⑤⑥⑨ の「負の値は 0点」と方針を揃えるため。
  const dividendSen = Math.max(0, dividend.amountSen);

  // 利回り(%) = 配当 / 株価 * 100。閾値は 1/100 % 単位なので
  //   配当 / 株価 * 100 * 100 >= 閾値  <=>  配当 * 10000 >= 閾値 * 株価
  // 両辺とも整数で、除算を経由しない。これが「判定は生値」の実装（§2.2）。
  // 上のガードで両辺とも安全整数に収まることが保証されている。
  const compareToThreshold = (thresholdHundredths: number): number =>
    dividendSen * 10_000 - thresholdHundredths * priceSen;

  return {
    score: lookupPoints(DIVIDEND_YIELD_BANDS, compareToThreshold),
    // 表示用の値だけは丸める。丸めるのはここ1箇所（`.claude/rules/frontend.md`）
    yieldHundredthsPercent: Math.round((dividendSen * 10_000) / priceSen),
    dividendSource: dividend.source,
    unavailableReason: null,
  };
}
