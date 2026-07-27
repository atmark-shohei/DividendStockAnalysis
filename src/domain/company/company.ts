/**
 * 会社（集約ルート）と、その財務レコード。
 *
 * 取り込んだ CSV/TSV を10指標が使える形にまとめたもの。
 * **年度降順**（先頭が直近）で持つ。並び順を層をまたいで再解釈しないため、
 * 並べ替えは取り込み層で完了させる。
 *
 * 金額はすべて銭単位の整数。比率は %、倍率は倍（`docs/glossary.md`）。
 *
 * ⚠️ `Sen` ではなく `number` で持つのは、これが**未検証の入力**だから。
 * `Sen` は「検証を通った金額」を意味する（`shared/sen.ts`）。
 * 検証は各指標の計算関数が担う。
 */

import { type DividendRecord } from './dividend-record';

/** 1年度ぶんの財務レコード */
export interface FinancialRecord {
  /** 決算年度。2024年3月期なら 2024 */
  readonly fiscalYear: number;
  /** 予想か実績か。予想は ③ の配当性向にだけ使う */
  readonly isForecast: boolean;
  /** 1株利益（銭） */
  readonly epsSen: number | null;
  /** 自己資本利益率（%） */
  readonly roePercent: number | null;
  /** 売上高（銭） */
  readonly revenueSen: number | null;
  /** 営業利益率（%）。CSV に列があればこちらを使う */
  readonly operatingMarginPercent: number | null;
  /** 1株配当（銭）。**分割調整後**の値（`scoring-requirements.md` §2.2） */
  readonly dividendPerShareSen: number | null;
}

/** ⑥ が使う貸借対照表の項目。年度をまたがないので会社直下に持つ */
export interface BalanceSheetSnapshot {
  readonly currentAssetsSen: number | null;
  readonly investmentSecuritiesSen: number | null;
  readonly totalLiabilitiesSen: number | null;
  /** 前期末の配当総額（銭） */
  readonly previousDividendTotalSen: number | null;
}

/** ⑨ が使う市場指標 */
export interface MarketMultiples {
  /** PER（会社予想）。倍 */
  readonly per: number | null;
  /** PBR（実績）。倍 */
  readonly pbr: number | null;
}

export interface Company {
  /** 銘柄コード（例: 9433） */
  readonly code: string;
  readonly name: string;
  /** 年度降順の財務レコード */
  readonly records: readonly FinancialRecord[];
  /** 年度降順の配当履歴。⑩ の採用判定に使う */
  readonly dividends: readonly DividendRecord[];
  readonly balanceSheet: BalanceSheetSnapshot;
  readonly multiples: MarketMultiples;
  /** ユーザーが手入力した現在株価（銭）。未入力なら `null` */
  readonly priceSen: number | null;
  /** 入力（解析）した日時。UTC の ISO 8601 文字列 */
  readonly fetchedAt: string;
}

/** 実績のレコードだけを年度降順で返す。平均・CAGR 系は予想を混ぜない */
export function actualRecords(company: Company): readonly FinancialRecord[] {
  return company.records.filter((record) => !record.isForecast);
}

/** 最新の予想レコード。③ が使う。無ければ `null` */
export function latestForecastRecord(company: Company): FinancialRecord | null {
  let latest: FinancialRecord | null = null;
  for (const record of company.records) {
    if (!record.isForecast) continue;
    if (latest === null || record.fiscalYear > latest.fiscalYear) latest = record;
  }
  return latest;
}

/**
 * 実績系列から指定した列を**年度に揃えて**年度降順で取り出す。
 *
 * ⚠️ **添字を年数として使えるようにするのがこの関数の役目。**
 * 10指標のうち ①④⑦ は「5年前」を、② は「1年前」を**添字で**参照する。
 * 単に `records.map()` すると、途中の年度が欠けている会社で添字が詰まり、
 * 「5年前」が実際には7年前になって成長率が過小に出る。
 *
 * そこで最新の実績年度から1年刻みで枠を作り、**その年のレコードが無ければ
 * `null` を置く**。欠損は欠損として下流に伝わり、各指標が
 * 「データなし」として判定不能に倒す（0 に丸めない）。
 *
 * 同じ年度のレコードが複数あった場合は最初に見つかったものを採る。
 * 重複は取り込み層（自然キーの UNIQUE）で防ぐ前提。
 *
 * @param years 枠の長さ。指標が必要とする年数より短くしない
 */
export function seriesOf(
  company: Company,
  select: (record: FinancialRecord) => number | null,
  years: number,
): (number | null)[] {
  const actuals = actualRecords(company);
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

  const byYear = new Map<number, FinancialRecord>();
  for (const record of actuals) {
    if (!byYear.has(record.fiscalYear)) byYear.set(record.fiscalYear, record);
  }

  // **データが尽きた先まで埋めない。** 埋めると「途中の年度が欠けている」と
  // 「そこで履歴が終わっている」が区別できなくなり、② 連続非減配年数が
  // 「判定不能」に倒れてしまう（履歴の末尾は減配でも欠損でもない）。
  const length = Math.min(years, latestYear - oldestYear + 1);

  return Array.from({ length }, (_, offset) => {
    const record = byYear.get(latestYear - offset);
    return record === undefined ? null : select(record);
  });
}
