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

/** ③ が予想EPSと年度を突き合わせるための予想配当（`docs/adr/0009-dividend-single-source.md`） */
export interface ForecastDividend {
  readonly fiscalYear: number;
  readonly amountSen: number;
}

/**
 * ③ の実績側が実績EPSと年度を突き合わせるための実績配当。
 *
 * `ForecastDividend` を再利用しない理由: 既存の型自体が「予想配当」という名を持ち、
 * 実績側に使うと読み手が混乱する。`PerSource`（`forecast-eps`/`actual-eps`）と同じく、
 * 予想・実績を対にした命名をこのコードベースは既に多用している。
 */
export interface ActualDividend {
  readonly fiscalYear: number;
  readonly amountSen: number;
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

/** `actualDividendSeriesWithYear` の1要素。年度と、その年度にフレーム化された金額の組 */
export interface ActualDividendSeriesYear {
  /** 決算年度。2024年3月期なら 2024 */
  readonly fiscalYear: number;
  /** 年間配当の合計（銭）。null=データなし（枠はあるがその年度の実績が無い） */
  readonly amountSen: number | null;
}

/**
 * 実績配当（`kind === 'actual'`）を**年度に揃えて**年度降順で取り出す。①②⑩ が使う。
 *
 * 規則は `company.ts` の `seriesOf` と同じ（最新の実績年度から1年刻みで枠を作り、
 * 無い年は `null`。データが尽きた先までは埋めない）。
 * **単に `map()` すると欠損年で添字が詰まり、① の「5年前」が実際には7年前になる。**
 *
 * `actualDividendSeries()`（年度なし版）はこの関数の薄いラッパー（`amountSen` だけを
 * 写す）。② 連続非減配年数の年次リスト（`describeConsecutiveYearRows`）が年度ラベル
 * 込みで必要とするため切り出した（T-098）。
 *
 * @param years 枠の長さ。指標が必要とする年数より短くしない
 */
export function actualDividendSeriesWithYear(
  dividends: readonly DividendRecord[],
  years: number,
): readonly ActualDividendSeriesYear[] {
  const actuals = dividends.filter((record) => record.kind === 'actual');
  if (actuals.length === 0) return [];

  const latestYear = actuals.reduce(
    (max, record) => (record.fiscalYear > max ? record.fiscalYear : max),
    Number.NEGATIVE_INFINITY,
  );
  if (!Number.isFinite(latestYear)) return [];

  const oldestYear = actuals.reduce(
    (min, record) => (record.fiscalYear < min ? record.fiscalYear : min),
    Number.POSITIVE_INFINITY,
  );

  const byYear = new Map<number, DividendRecord>();
  for (const record of actuals) {
    if (!byYear.has(record.fiscalYear)) byYear.set(record.fiscalYear, record);
  }

  const length = Math.min(years, latestYear - oldestYear + 1);
  return Array.from({ length }, (_, offset) => {
    const fiscalYear = latestYear - offset;
    const record = byYear.get(fiscalYear);
    return { fiscalYear, amountSen: record === undefined ? null : record.annualAmountSen };
  });
}

/**
 * `actualDividendSeriesWithYear()` の年度なし版。既存呼び出し元（`score-company.ts`
 * の指標①⑩ 計算等）との後方互換のため、外部シグネチャ・戻り値は変更しない。
 */
export function actualDividendSeries(
  dividends: readonly DividendRecord[],
  years: number,
): (number | null)[] {
  return actualDividendSeriesWithYear(dividends, years).map((year) => year.amountSen);
}

/**
 * 予想配当（`forecast` / `revised`）のうち最新年度のものを返す。修正を優先する。
 *
 * ③ 予想配当性向が、予想EPSの年度と突き合わせるために年度も一緒に返す
 * （ADR-0009「決定した結合規則」）。年度を見ずに割ると
 * 「今期予想EPS ÷ 別年度の予想配当」になり、配当性向が静かに誤る。
 *
 * @returns 使える予想配当が1件も無ければ `null`
 */
export function selectLatestForecastDividend(
  records: readonly DividendRecord[],
): ForecastDividend | null {
  const usable = records.filter(
    (r): r is UsableRecord => r.annualAmountSen !== null && Number.isSafeInteger(r.fiscalYear),
  );
  const latest = pickLatest(usable, ['forecast', 'revised']);
  if (latest === null) return null;
  return { fiscalYear: latest.fiscalYear, amountSen: latest.annualAmountSen };
}

/** 年度ごとに1件へ集約した配当履歴（①配当推移の折れ線グラフ・②連続非減配年数のリストが使う） */
export interface DividendHistoryYear {
  /** 決算年度。2024年3月期なら 2024 */
  readonly fiscalYear: number;
  /** 年間配当の合計（銭）。null=データなし。0=無配（別物） */
  readonly amountSen: number | null;
  /** true: forecast/revised が採用された年。false: actual が採用された年 */
  readonly isForecast: boolean;
}

/**
 * 同一年度に複数区分が並んだときの優先度（`GET /api/companies/:code/dividends` 用）。
 *
 * `KIND_PRIORITY`（上）とは意味が逆（`actual` が最優先）。あちらは「最新年度に
 * 予想があれば予想を採る」ための優先度で、こちらは「過去の年度をどう1点に
 * 集約するか」の優先度（設計書 `company-api.md` 545-586行目）。数値の意味を
 * 混同しないよう別定数にする。
 */
const HISTORY_KIND_PRIORITY: Readonly<Record<DividendRecordKind, number>> = {
  actual: 2,
  revised: 1,
  forecast: 0,
};

/**
 * 配当履歴を**年度ごとに1件へ集約**し、年度昇順（古い年→新しい年）で返す
 * （`GET /api/companies/:code/dividends`。設計書 `company-api.md` 545-586行目）。
 *
 * 同一年度に複数区分がある場合は `actual > revised > forecast` の優先順位で選ぶ。
 * **金額が `null` の行も除外しない**（「その年度は存在しない」と「値が無い」を
 * 区別するため。`.claude/CLAUDE.md`「`null`（判定不能）と0点は別物」）。
 * 優先順位の判定も値の有無では条件分岐しない（`actual` が `null` でも `actual` を採用する）。
 *
 * `fiscalYear` が壊れている（`Number.isSafeInteger` でない）行は他の選択関数と同じ方針で除外する。
 */
export function dividendHistoryByYear(records: readonly DividendRecord[]): DividendHistoryYear[] {
  const byYear = new Map<number, DividendRecord>();
  for (const record of records) {
    if (!Number.isSafeInteger(record.fiscalYear)) continue;

    const current = byYear.get(record.fiscalYear);
    if (
      current === undefined ||
      HISTORY_KIND_PRIORITY[record.kind] > HISTORY_KIND_PRIORITY[current.kind]
    ) {
      byYear.set(record.fiscalYear, record);
    }
  }

  return [...byYear.values()]
    .sort((a, b) => a.fiscalYear - b.fiscalYear)
    .map((record) => ({
      fiscalYear: record.fiscalYear,
      amountSen: record.annualAmountSen,
      isForecast: record.kind !== 'actual',
    }));
}

/**
 * 実績配当（`kind === 'actual'`）のうち最新年度のものを返す。
 *
 * ③ 実績側が、実績EPSの年度と突き合わせるために年度も一緒に返す
 * （ADR-0009「決定した結合規則」を実績側にも適用。設計書 §2 / §6.4.1）。
 *
 * @returns 使える実績配当が1件も無ければ `null`
 */
export function selectLatestActualDividend(
  records: readonly DividendRecord[],
): ActualDividend | null {
  const usable = records.filter(
    (r): r is UsableRecord => r.annualAmountSen !== null && Number.isSafeInteger(r.fiscalYear),
  );
  const latest = pickLatest(usable, ['actual']);
  if (latest === null) return null;
  return { fiscalYear: latest.fiscalYear, amountSen: latest.annualAmountSen };
}
