/**
 * 会社の配当履歴と、そこからどの年間配当を採用するか。
 *
 * **採点ではなく会社側の関心事**なので `domain/company` に置く。
 * 「どの配当を採用するか」は ①③⑩ から使う共通の判断であり、
 * ⑩ のスコアリングに閉じ込めると他の指標から呼べない。
 */

/**
 * ⚠️ **この型群は `Sen`（検証済みを表す branded type）を使わない。**
 *
 * 配当履歴は TSV/CSV を貼り付けた**未検証の入力**であり、`Sen` は
 * 「検証を通った金額」を意味する。未検証の値に `Sen` を付けると branding が
 * 「検証済み」を保証しなくなり、型が嘘をつく。
 *
 * 検証は ⑩ の `calculateDividendYield`（`isSen` で `NaN` / `Infinity` /
 * 小数 / 安全整数外を弾く）が担う。取り込み層が検証済みの値を作るように
 * なったら、その時点でここを `Sen` に上げる。
 */

/** 採用した配当が予想か実績か。画面に併記する（⑩ 設計書 §3.1）。 */
export type DividendSource = 'forecast' | 'actual';

/** 配当履歴の「区分」列。`修正` は予想の更新版として扱う。 */
export type DividendRecordKind = 'forecast' | 'revised' | 'actual';

export interface DividendRecord {
  /** 決算年度。2024年3月期なら 2024 */
  readonly fiscalYear: number;
  readonly kind: DividendRecordKind;
  /** 年間配当の合計（銭）。その年のデータが無ければ `null`（0 ではない） */
  readonly annualAmountSen: number | null;
}

export interface SelectedDividend {
  readonly amountSen: number;
  readonly source: DividendSource;
}

/**
 * 業務上の株価上限。1株 1,000,000 円（2026-07-27 決定）。
 *
 * これを超える株価は日本株には事実上存在しないので、桁の打ち間違いとみなして弾く。
 * 画面側の入力欄もこの値で範囲検証すること（`.claude/rules/frontend.md`）。
 */
export const MAX_PRICE_SEN = 1_000_000 * 100;

/** 同一年度に複数の区分が並んだときの優先度。修正は予想の更新版なので上。 */
const KIND_PRIORITY: Readonly<Record<DividendRecordKind, number>> = {
  revised: 2,
  forecast: 1,
  actual: 0,
};

type UsableRecord = DividendRecord & { readonly annualAmountSen: number };

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
 * 配当履歴から利回り計算に使う年間配当を選ぶ（⑩ 設計書 §2.1）。
 *
 * **取り込んだデータの最新年度に「予想（または修正）」があればそれを採用し、
 * 最新年度に予想が無い場合のみ最新の「実績」を採用する**（2026-07-27 決定 / T-049）。
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
