import type { ScoringBandsResponse } from '../api';

/**
 * `MetricKey`（`src/domain/shared/metric-key.ts`）を frontend からランタイム import しない
 * （ADR-0008 の allowlist は `src/domain/company/` の副作用なし関数限定で `shared/` は対象外）。
 * BE DTO（`ScoringBandsResponse`）が既に持つ型から type alias として取り出す
 * （`frontend/format.ts` の `PayoutRatioBreakdown` と同じ手法。二重定義しない）。
 */
type MetricKey = ScoringBandsResponse['metrics'][number]['key'];

/**
 * 各指標の1行説明（`criteria-tab.md` §2.0「1行の説明」）。
 *
 * BE の区分表DTOにこのフィールドは無い（`src/handler/dto/scoring-bands.ts`）。
 * 「スコア表をこの画面にハードコードしない」（`criteria-tab.md` §3）の禁止対象は
 * **数値の区分表**であり、説明文・計算式は対象外という解釈（fe-plan.md §7確認事項C）で
 * FE 側の静的テキストとして持つ。各指標の `docs/02_design/logic/*-scoring.md` §1「概要」から
 * 書き起こした。
 *
 * `CriteriaPage.tsx`（コンポーネント）から分離し、静的テキストのみのデータ定義として
 * 独立したファイルに置く（CR-6。`.claude/rules/frontend.md`「1コンポーネント1ファイル。
 * 100行を超えたら分割を検討する」）。
 */
export const METRIC_DESCRIPTION: Readonly<Record<MetricKey, string>> = {
  dividendGrowthRate:
    '直近5年間の配当金の年平均成長率（CAGR）。連続年数が長くても増配幅が小さい銘柄を見分ける。',
  consecutiveYears:
    '直近から過去18年前まで遡り、前年比で減配していない連続年数。据置は継続とみなす。',
  payoutRatio:
    '今期予想の当期純利益（EPS）に対する配当金の割合。低いほど増配余力が大きいと判断する。',
  epsCagr: '1株あたり純利益の年平均成長率。配当性向を据え置いたまま増配するにはEPS成長が要る。',
  roeAverage: '自己資本利益率の直近5年単純平均。配当原資とBPSの蓄積速度を測る。',
  dividendSustainability: '手元のネットキャッシュだけで現行の配当総額を何年維持できるか。',
  revenueCagr: '売上高の年平均成長率。持続的な増配の最終的な裏付けになる。',
  operatingMargin:
    '売上高に対する営業利益の割合の直近5年平均。高いほど業績悪化時の減配リスクが低い。',
  mixCoefficient: '割安度の指標。PERとPBRを掛け合わせて算出する。',
  dividendYield:
    '現在の株価と年間配当金から算出する配当利回り。予想と実績のどちらを採用したかを併記する。',
};

/**
 * 計算式（同 §2.0「計算式」）。等幅フォントのブロックで表示する。
 * `docs/02_design/logic/*-scoring.md` §3「計算式」から書き起こした静的テキスト
 * （数値の区分表は含まない。§7確認事項Cと同じ解釈）。
 *
 * ⑩配当利回りは、採用する配当（予想/実績）の選択ルールと判定不能時の扱いも文章で説明する
 * （fe-plan.md §7確認事項D。個社データを扱う機能は作らず、静的な説明文で対応する）。
 *
 * ③予想配当性向は、予想/実績どちらを採点に使うかの既定の優先順（既定は予想、判定不能なら
 * 実績にフォールバック）も文章で説明する（`payout-ratio-scoring.md` §7 決定3・4）。
 * **この評価基準タブ（`/criteria`）はログイン不要の静的な公開画面であり、採点ソースを
 * 切り替える操作は存在しない**（切り替えのチェックボックスは解析ダイアログ側にある。CR-5）。
 * 「画面で切り替えられる」という文言は解析ダイアログの操作をこの画面の説明として
 * 誤って書いたものだったため、実際の挙動（既定の優先順とフォールバック規則）に直した。
 */
export const METRIC_FORMULA: Readonly<Record<MetricKey, string>> = {
  dividendGrowthRate: 'CAGR = (昨年の配当金 ÷ 5年前の配当金)^(1/5) − 1\n（分割調整後の値を使用）',
  consecutiveYears:
    '直近年から過去へ走査し、当年 < 前年 となった時点で打ち切る（当年 = 前年は継続）。',
  payoutRatio:
    '配当性向 = 配当金 ÷ EPS × 100\n' +
    '予想・実績の両方を算出する。採点には既定で予想を採用し、予想が判定不能なときのみ' +
    '実績にフォールバックする（実績を優先して使うかどうかは解析ダイアログ側で指定できる）。',
  epsCagr:
    'CAGR = (直近3年の中央値 ÷ 5年前から遡った3年の中央値)^(1/3) − 1\n（単年同士では比較しない）',
  roeAverage: 'ROE(%) = 純利益 ÷ 期末自己資本 × 100\n直近5年の単純平均を使用する。',
  dividendSustainability:
    '配当維持可能年数 = ネットキャッシュ ÷ 前期末の配当総額\nネットキャッシュ = (流動資産 + 投資有価証券 × 0.7) − 負債総額',
  revenueCagr: 'CAGR = (現在の売上高 ÷ 5年前の売上高)^(1/5) − 1',
  operatingMargin: '営業利益率(%) = 営業利益 ÷ 売上高 × 100\n直近5年の単純平均を使用する。',
  mixCoefficient: 'MIX係数 = PER（会社予想） × PBR（実績）',
  dividendYield:
    '配当利回り(%) = 年間配当金 ÷ 現在の株価 × 100\n' +
    '年間配当金は、最新年度に予想（または修正）があればそれを優先し、無ければ直近の実績を採用する。\n' +
    '採用できる配当データが無い場合は判定不能とし、「—」と理由を表示する（0.00%や0点にはしない）。',
};
