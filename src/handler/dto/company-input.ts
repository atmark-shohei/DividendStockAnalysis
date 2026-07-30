/**
 * API の入出力 DTO と zod スキーマ。
 *
 * **zod は handler の境界でだけ使う**（`.claude/CLAUDE.md`）。
 * ドメインの不変条件はドメイン自身が守るので、ここで二重定義しない。
 * ここが守るのは「外から来た JSON が期待した形か」だけ。
 */

import { z } from 'zod';

import { type Company } from '../../domain/company/company';
import { MAX_PRICE_SEN } from '../../domain/company/dividend-record';
import {
  type MetricKey,
  METRIC_KEYS,
  METRIC_LABEL,
  METRIC_NUMBER,
  METRIC_UNIT,
} from '../../domain/shared/metric-key';
import { type CompanyScoring } from '../../usecase/score-company';

/**
 * 銘柄コード。4文字固定。先頭3文字は数字、末尾1文字は数字または英大文字（例: 130A）。
 * JPX が 2024 年以降に採番している英字混じりコードに対応する。
 */
const companyCode = z
  .string()
  .trim()
  .regex(
    /^\d{3}[0-9A-Z]$/,
    '銘柄コードは4文字（先頭3桁は数字、末尾1桁は数字か英大文字）で指定する',
  );

/** 銭。整数のみ。小数を受け取ったら弾く（金額に浮動小数点を使わない） */
const senValue = z.number().int().safe();
const nullableSen = senValue.nullable();
/** 比率・倍率。金額ではないので実数でよいが、NaN / Infinity は弾く */
const nullableRatio = z.number().finite().nullable();

const financialRecordInput = z.object({
  fiscalYear: z.number().int().min(1900).max(2200),
  isForecast: z.boolean(),
  epsSen: nullableSen,
  roePercent: nullableRatio,
  revenueSen: nullableSen,
  operatingMarginPercent: nullableRatio,
  dividendPerShareSen: nullableSen,
});

const dividendRecordInput = z.object({
  fiscalYear: z.number().int().min(1900).max(2200),
  kind: z.enum(['forecast', 'revised', 'actual']),
  annualAmountSen: nullableSen,
});

export const analyzeCompanyRequest = z.object({
  code: companyCode,
  name: z.string().trim().min(1, '銘柄名を入力してください').max(100),
  records: z.array(financialRecordInput).max(60),
  dividends: z.array(dividendRecordInput).max(60),
  balanceSheet: z.object({
    currentAssetsSen: nullableSen,
    investmentSecuritiesSen: nullableSen,
    totalLiabilitiesSen: nullableSen,
    previousDividendTotalSen: nullableSen,
  }),
  multiples: z.object({
    per: nullableRatio,
    /** `per` の出所。`per` が null なら null にする（画面側で揃える） */
    perSource: z.enum(['forecast-eps', 'actual-eps', 'manual']).nullable(),
    pbr: nullableRatio,
    pbrSource: z.enum(['actual-bps', 'manual']).nullable(),
  }),
  /**
   * 株価（銭）。**業務上限は 1株 1,000,000 円**。
   * 画面側にも同じ範囲検証を置くが、外から直接叩かれる経路もあるのでここでも見る。
   */
  priceSen: senValue.min(0).max(MAX_PRICE_SEN).nullable(),
});

export type AnalyzeCompanyRequest = z.infer<typeof analyzeCompanyRequest>;

/**
 * DTO をドメインの型へ詰め替える。**年度降順に並べ替えるのはここ**。
 *
 * 並べ替えを層をまたいで二重に行うと、どちらが正か分からなくなる。
 * ドメインは「降順で来る」ことを前提にしてよい。
 */
export function toCompany(request: AnalyzeCompanyRequest, fetchedAt: string): Company {
  return {
    code: request.code,
    name: request.name,
    records: [...request.records].sort((a, b) => b.fiscalYear - a.fiscalYear),
    dividends: [...request.dividends].sort((a, b) => b.fiscalYear - a.fiscalYear),
    balanceSheet: request.balanceSheet,
    multiples: request.multiples,
    priceSen: request.priceSen,
    fetchedAt,
  };
}

export interface MetricView {
  readonly key: MetricKey;
  readonly number: number;
  readonly label: string;
  readonly unit: string;
  readonly score: number | null;
  readonly value: number | null;
  readonly unavailableReason: string | null;
}

export interface ScoringResponse {
  readonly totalScore: number;
  readonly maxTotalScore: number;
  readonly effectiveMetricCount: number;
  readonly totalMetricCount: number;
  readonly dividendSource: 'forecast' | 'actual' | null;
  /** ⑨ PER の出所。予想EPS / 実績EPS / 手入力のどれで算出したか。§3.5 */
  readonly perSource: 'forecast-eps' | 'actual-eps' | 'manual' | null;
  /** ⑨ PBR の出所 */
  readonly pbrSource: 'actual-bps' | 'manual' | null;
  readonly fetchedAt: string;
  readonly metrics: readonly MetricView[];
}

/**
 * 採点結果を画面向けの形にする。
 *
 * **丸めない。** 丸めるのは表示層の1箇所だけ（`.claude/rules/frontend.md`）。
 * 判定不能は `null` のまま返す。**0 を返すと画面が「0点」と誤表示する。**
 */
export function toScoringResponse(scoring: CompanyScoring): ScoringResponse {
  return {
    totalScore: scoring.card.totalScore,
    maxTotalScore: scoring.card.maxTotalScore,
    effectiveMetricCount: scoring.card.effectiveMetricCount,
    totalMetricCount: scoring.card.totalMetricCount,
    dividendSource: scoring.dividendSource,
    perSource: scoring.perSource,
    pbrSource: scoring.pbrSource,
    fetchedAt: scoring.fetchedAt,
    metrics: METRIC_KEYS.map((key) => {
      const metric = scoring.card.metrics[key];
      return {
        key,
        number: METRIC_NUMBER[key],
        label: METRIC_LABEL[key],
        unit: METRIC_UNIT[key],
        score: metric.score,
        value: metric.value,
        unavailableReason: metric.unavailableReason,
      };
    }),
  };
}
