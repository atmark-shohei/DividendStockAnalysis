import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { METRIC_FORMULA, PAYOUT_RATIO_FORMULA } from '../../frontend/pages/criteria-content';

/**
 * ③ 予想配当性向の詳細（T-108・`docs/02_design/ui/pages/analysis-dialog.md` §5.3.1、§9.1）の
 * 構造検証。
 *
 * `@testing-library/react` は未導入のため DOM 描画結果は検証できない。状態ごとの文言は
 * `format.test.ts` で純関数として押さえ、ここではソースをテキストとして読む既存の手法
 * （`criteria-page.test.tsx` / `style-tokens.test.ts`）で、描画の構造と「判定しない」ことを固定する。
 */

const frontendDir = resolve(__dirname, '../../frontend');
const readFrontend = (relativePath: string): string =>
  readFileSync(resolve(frontendDir, relativePath), 'utf-8');

const detailSource = readFrontend('components/PayoutRatioDetail.tsx');
const sideCardSource = readFrontend('components/PayoutRatioSideCard.tsx');
const bandTableSource = readFrontend('components/PayoutRatioBandTable.tsx');
const dialogBodySource = readFrontend('components/AnalysisDialogBody.tsx');
const appSource = readFrontend('App.tsx');

const payoutRatioComponents: readonly (readonly [string, string])[] = [
  ['PayoutRatioDetail.tsx', detailSource],
  ['PayoutRatioSideCard.tsx', sideCardSource],
  ['PayoutRatioBandTable.tsx', bandTableSource],
];

const FORMULA_LITERAL = '配当性向 = 配当金 ÷ EPS × 100';

describe('記号式は /criteria と同じ定数から描画する（§9.1）', () => {
  it('PAYOUT_RATIO_FORMULA は式の文字列そのもの', () => {
    expect(PAYOUT_RATIO_FORMULA).toBe(FORMULA_LITERAL);
  });

  it('/criteria の METRIC_FORMULA.payoutRatio は1文字も変わっていない', () => {
    expect(METRIC_FORMULA.payoutRatio).toBe(
      '配当性向 = 配当金 ÷ EPS × 100\n' +
        '予想・実績の両方を算出する。採点には既定で予想を採用し、予想が判定不能なときのみ' +
        '実績にフォールバックする（実績を優先して使うかどうかは解析ダイアログ側で指定できる）。',
    );
  });

  it('frontend/ 配下に式の文字列リテラルがちょうど1箇所しかない', () => {
    const files = readdirSync(frontendDir, { recursive: true, encoding: 'utf-8' }).filter(
      (file) => file.endsWith('.ts') || file.endsWith('.tsx'),
    );
    const occurrences = files.reduce(
      (count, file) => count + readFrontend(file).split(FORMULA_LITERAL).length - 1,
      0,
    );
    expect(occurrences).toBe(1);
  });

  it('PayoutRatioDetail.tsx は {PAYOUT_RATIO_FORMULA} を1回だけ描画する（カードに繰り返さない）', () => {
    expect(detailSource.match(/\{PAYOUT_RATIO_FORMULA\}/g) ?? []).toHaveLength(1);
    expect(detailSource).toMatch(
      /<pre className="criteria-formula">\{PAYOUT_RATIO_FORMULA\}<\/pre>/,
    );
    expect(sideCardSource).not.toContain('PAYOUT_RATIO_FORMULA');
  });
});

describe('PayoutRatioDetail.tsx の構成（§5.3.1）', () => {
  it('予想・実績の2カードを条件なしで常に描画する（片側が判定不能でも消さない）', () => {
    const cards = detailSource.match(/<PayoutRatioSideCard\b/g) ?? [];
    expect(cards).toHaveLength(2);
    expect(detailSource).toMatch(
      /<div className="payout-ratio-cards">\s*<PayoutRatioSideCard\s+side="forecast"/,
    );
    expect(detailSource).toMatch(/\/>\s*<PayoutRatioSideCard\s+side="actual"/);
    expect(detailSource).not.toMatch(/(&&|\?)\s*\(?\s*<PayoutRatioSideCard/);
  });

  it('入力日時を formatFetchedAt(scoring.fetchedAt) で numeric 付きで出す', () => {
    expect(detailSource).toMatch(/className="numeric">\{formatFetchedAt\(scoring\.fetchedAt\)\}/);
  });

  it('要約行は payoutRatioBreakdownText をそのまま使う', () => {
    expect(detailSource).toContain('payoutRatioBreakdownText(');
  });

  it('予想カードには予想側、実績カードには実績側の view を渡す（取り違えない）', () => {
    expect(detailSource).toMatch(/side="forecast"\s+view=\{scoring\.payoutRatioForecast\}/);
    expect(detailSource).toMatch(/side="actual"\s+view=\{scoring\.payoutRatioActual\}/);
  });

  it('区分表の caption 用に metricLabel をそのまま渡す', () => {
    expect(detailSource).toContain('label={metricLabel}');
  });

  it('区分表は採点に使った表（scoring.payoutRatioBands）と BE の matchedBandIndex を渡す', () => {
    expect(detailSource).toContain('bands={scoring.payoutRatioBands}');
    expect(detailSource).toContain('forecastIndex={scoring.payoutRatioForecast.matchedBandIndex}');
    expect(detailSource).toContain('actualIndex={scoring.payoutRatioActual.matchedBandIndex}');
  });
});

describe('AnalysisDialogBody.tsx の分岐（§9.1「準備中」が出ない）', () => {
  it("activeMetric.key === 'payoutRatio' で PayoutRatioDetail を描画する", () => {
    expect(dialogBodySource).toMatch(
      /activeMetric\.key === 'payoutRatio' \? \(\s*<PayoutRatioDetail scoring=\{scoring\} metricLabel=\{activeMetric\.label\} \/>/,
    );
  });

  it('③の分岐は dividendHistory を参照しない（追加の API 呼び出しは無い）', () => {
    const branch = /activeMetric\.key === 'payoutRatio' \? \(([\s\S]*?)\) : \(/.exec(
      dialogBodySource,
    );
    expect(branch).not.toBeNull();
    expect(branch?.[1]).not.toContain('dividendHistory');
  });

  it("App.tsx の isDividendHistoryMetricOpen に 'payoutRatio' が入っていない（/dividends を呼ばない）", () => {
    const declaration = /const isDividendHistoryMetricOpen =([\s\S]*?);/.exec(appSource);
    expect(declaration).not.toBeNull();
    expect(declaration?.[1]).not.toContain('payoutRatio');
  });
});

describe.each(payoutRatioComponents)('%s: データ取得も判定もしない', (_name, source) => {
  it('「実績配当性向を採点に使う」チェックボックスを置かない（§5.3.1「置かないもの」）', () => {
    expect(source).not.toContain('type="checkbox"');
    expect(source).not.toContain('実績配当性向を採点に使う');
  });

  it('minInclusive / maxExclusive を比較演算子で値と比べない（区分の判定をしない）', () => {
    expect(source).not.toMatch(/(minInclusive|maxExclusive)\s*(<=?|>=?)/);
    expect(source).not.toMatch(/(<=?|>=?)\s*[\w.]*(minInclusive|maxExclusive)/);
  });

  it('区分表のリテラル（points: 数値）を持たない', () => {
    expect(source).not.toMatch(/points:\s*\d+/);
  });

  it('../api からは import type だけ（fetch しない）', () => {
    const apiImports = source.match(/^import .* from '\.\.\/api';$/gm) ?? [];
    for (const line of apiImports) expect(line).toMatch(/^import type /);
    expect(source).not.toMatch(/\bfetch\(/);
  });

  it('null を 0 に丸めるコード（?? 0 / Number(）を書かない', () => {
    expect(source).not.toMatch(/\?\?\s*0\b/);
    expect(source).not.toMatch(/\bNumber\(/);
  });
});

describe('PayoutRatioSideCard.tsx の描画（§5.3.1）', () => {
  it('1株配当の行は dividendSen と dividendFiscalYear を組で出す（EPS 側と取り違えない）', () => {
    expect(sideCardSource).toMatch(
      /<dt>1株配当<\/dt>\s*<dd className="numeric">\s*\{payoutRatioEvidenceText\(view\.dividendSen, view\.dividendFiscalYear\)\}/,
    );
  });

  it('EPS の行は epsSen と epsFiscalYear を組で出す（配当側と取り違えない）', () => {
    expect(sideCardSource).toMatch(
      /<dt>EPS<\/dt>\s*<dd className="numeric">\s*\{payoutRatioEvidenceText\(view\.epsSen, view\.epsFiscalYear\)\}/,
    );
  });

  it('代入式は payoutRatioEquationText(view) が null のときだけ出さない', () => {
    expect(sideCardSource).toContain('const equation = payoutRatioEquationText(view);');
    expect(sideCardSource).toContain('{equation !== null && <p className="mono">{equation}</p>}');
  });

  it('スコアは payoutRatioSideScoreText(view) で出す', () => {
    expect(sideCardSource).toContain('payoutRatioSideScoreText(view)');
  });

  it('注記は payoutRatioSideNoteText(view) を meta で出す', () => {
    expect(sideCardSource).toContain('const note = payoutRatioSideNoteText(view);');
    expect(sideCardSource).toContain('<p className="meta">{note}</p>');
  });

  it('採用バッジは payoutRatioAdoptedBadgeText(side, source) の文言を adopted-badge で出す', () => {
    expect(sideCardSource).toContain('const badge = payoutRatioAdoptedBadgeText(side, source);');
    expect(sideCardSource).toContain('<span className="adopted-badge">{badge}</span>');
  });

  it('ヒーロー行用の dialog-hero クラスを流用しない（CR-1）', () => {
    expect(sideCardSource).not.toContain('dialog-hero');
  });
});

describe('PayoutRatioBandTable.tsx の区分表（§5.3.1・§9.1）', () => {
  it('BE の bands をそのまま bands.map で描画する', () => {
    expect(bandTableSource).toMatch(/bands\.map\(/);
  });

  it('マーカーは行の添字と予想・実績の matchedBandIndex から format.ts で決める', () => {
    expect(bandTableSource).toContain('bands.map((band, index)');
    expect(bandTableSource).toContain(
      'const marker = payoutRatioBandMarkerText(index, forecastIndex, actualIndex);',
    );
  });

  it('条件列は formatPayoutRatioBandRange(band) で出す', () => {
    expect(bandTableSource).toContain('<td>{formatPayoutRatioBandRange(band)}</td>');
  });

  it('caption は「<指標名> の区分表」', () => {
    expect(bandTableSource).toContain('<caption>{`${label} の区分表`}</caption>');
  });

  it('マーカーの ▶ は aria-hidden で、文言で区別する', () => {
    expect(bandTableSource).toContain('<span aria-hidden="true">▶</span> {marker}');
  });

  it('境界の注記を表の下に出す（criteria-tab.md §2.3 と同じ文言）', () => {
    expect(bandTableSource).toContain('各区分は下限以上・上限未満（最上位のみ上が開く）');
  });

  it('点数列は numeric（右寄せ・等幅）', () => {
    expect(bandTableSource).toMatch(
      /<td className="numeric">\{`\$\{String\(band\.points\)\} 点`\}<\/td>/,
    );
  });
});
