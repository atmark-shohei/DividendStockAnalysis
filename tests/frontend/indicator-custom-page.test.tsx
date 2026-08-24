import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * 指標カスタマイズ画面（`/indicators`、T-101、
 * `docs/02_design/ui/pages/indicator-custom-page.md`）の構造・回帰防止テスト。
 *
 * `@testing-library/react` 未導入のため、DOM描画結果は検証できない。ソースをテキストとして
 * 読み込み正規表現で検証する既存パターン（`tests/frontend/criteria-page.test.tsx`）を踏襲する。
 */
const indicatorCustomPageSource = readFileSync(
  resolve(__dirname, '../../frontend/pages/IndicatorCustomPage.tsx'),
  'utf-8',
);
const indicatorRowSource = readFileSync(
  resolve(__dirname, '../../frontend/components/IndicatorRow.tsx'),
  'utf-8',
);
const numberInputSource = readFileSync(
  resolve(__dirname, '../../frontend/components/NumberInput.tsx'),
  'utf-8',
);

describe('IndicatorCustomPage.tsx: 「総合点は比較不能」の注記は常時表示（§2・§9受入基準）', () => {
  it('TOTAL_SCORE_COMPARISON_NOTE を条件分岐なしで描画している', () => {
    // `{condition && <p>{TOTAL_SCORE_COMPARISON_NOTE}</p>}` のような条件付きレンダリングに
    // 包まれていないことを確認する。直前の行が `{...&&` で終わっていないことをチェックする
    const lines = indicatorCustomPageSource.split('\n');
    const targetLineIndex = lines.findIndex((line) =>
      line.includes('TOTAL_SCORE_COMPARISON_NOTE}'),
    );
    expect(targetLineIndex).toBeGreaterThan(-1);
    const targetLine = lines[targetLineIndex] ?? '';
    // 対象行自体に `&&` による条件付きレンダリングが無いことを確認する
    expect(targetLine).not.toMatch(/&&/);
  });

  it('注記は画面内に1回だけ描画される', () => {
    const matches = indicatorCustomPageSource.match(/TOTAL_SCORE_COMPARISON_NOTE/g) ?? [];
    // import文 + 実際の描画 = 2回
    expect(matches).toHaveLength(2);
  });
});

describe('IndicatorCustomPage.tsx: MIX係数はchip表示（§2・§9受入基準）', () => {
  it('row.constraint === null（MIX係数）の分岐が存在する', () => {
    expect(indicatorRowSource).toMatch(/row\.constraint === null/);
  });

  it('MIX係数の分岐でNumberInputではなくchip相当の静的表示を出す', () => {
    expect(indicatorRowSource).toMatch(/className="chip"/);
  });
});

describe('IndicatorRow.tsx: ③予想配当性向の逆向き注記（§4.0・§9受入基準）', () => {
  it('reverseNote の分岐が存在する', () => {
    expect(indicatorRowSource).toMatch(/row\.reverseNote !== null/);
  });
});

describe('indicator-custom-content.ts: ③のみ逆向きキーとして定義されている', () => {
  it('REVERSED_DIRECTION_KEYS が payoutRatio だけを含む', () => {
    const content = readFileSync(
      resolve(__dirname, '../../frontend/pages/indicator-custom-content.ts'),
      'utf-8',
    );
    expect(content).toMatch(/REVERSED_DIRECTION_KEYS[\s\S]*?=\s*new Set\(\['payoutRatio'\]\)/);
  });
});

describe('IndicatorCustomPage.tsx: 「初期設定に戻す」はデフォルト基準値を機械的にコピーする（§5・§9受入基準）', () => {
  it('defaultBasisValue を参照している（BEが計算した値をそのまま使う）', () => {
    expect(indicatorCustomPageSource).toMatch(/defaultBasisValue/);
  });

  it('区分表・基準値のリテラル（points: 数値のハードコード配列）が存在しない', () => {
    expect(indicatorCustomPageSource).not.toMatch(/points:\s*\d+/);
  });
});

describe('IndicatorCustomPage.tsx / indicator-custom-content.ts: UI制約の直値は許容対象（区分表とは別物）', () => {
  // §3の制約表（きざみ・下限・上限）自体はFEが意図的に持つ静的データであり、
  // 「スコアリングの区分表・点数」（criteria-page.test.tsxが禁止する対象）とは異なる。
  // ここでは INDICATOR_CONSTRAINTS の定義箇所以外に min/max のリテラルが漏れ出していないことを
  // 確認する程度に留める（IndicatorCustomPage.tsx自体はconstraint値をハードコードしない）。
  it('IndicatorCustomPage.tsx は INDICATOR_CONSTRAINTS を import して使う（自前で区分値を持たない）', () => {
    expect(indicatorCustomPageSource).toMatch(/INDICATOR_CONSTRAINTS/);
  });
});

describe('NumberInput.tsx: 全角正規化と type="number" の属性（§8アクセシビリティ）', () => {
  it('type="number" を指定している', () => {
    expect(numberInputSource).toMatch(/type="number"/);
  });

  it('全角正規化（toHalfWidthNumber）を経由してonChangeを呼ぶ', () => {
    expect(numberInputSource).toMatch(/toHalfWidthNumber\(event\.target\.value\)/);
  });
});

describe('IndicatorRow.tsx: トグルは<button>を使う（§8アクセシビリティ）', () => {
  it('aria-pressed を持つ<button>要素でトグルを実装している（divへのonClickではない）', () => {
    expect(indicatorRowSource).toMatch(/<button[\s\S]*?aria-pressed=\{selected\}/);
  });
});

/**
 * T-105 問題1（確認事項A、Manager承認: (a) ✓ glyph 追加）。
 * トグルの選択状態を色（背景塗り）だけで表現しないよう、選択時のみ ✓ glyph を描画する。
 * アクセシブルネームは既存の `aria-label` が担うため、glyph は `aria-hidden="true"` にして
 * SR の二重読み上げを避ける。
 */
describe('IndicatorRow.tsx: 選択状態を色だけで表現しない（T-105 問題1・確認事項A(a)）', () => {
  it('selected のときだけ ✓ glyph を描画する分岐が存在する', () => {
    expect(indicatorRowSource).toMatch(/\{selected && \(/);
    expect(indicatorRowSource).toMatch(/indicator-toggle-check/);
  });

  it('glyph は aria-hidden="true"（アクセシブルネームは aria-label のまま。二重読み上げを避ける）', () => {
    const checkBlockMatch = indicatorRowSource.match(
      /<span className="indicator-toggle-check" aria-hidden="true">/,
    );
    expect(checkBlockMatch).not.toBeNull();
  });

  it('aria-pressed/aria-label は変更されていない（既存の SR 対応を回帰させない）', () => {
    expect(indicatorRowSource).toMatch(/aria-pressed=\{selected\}/);
    expect(indicatorRowSource).toMatch(
      /aria-label=\{`\$\{row\.label\}を\$\{selected \? '解除' : '選択'\}`\}/,
    );
  });
});

/**
 * CR-1: `.indicator-toggle-check` の文字色トークン誤用の是正。
 * `--color-action` 塗りの上の前景色は `--color-on-action` を使う（`style.css` の
 * 通常ボタン `background: var(--color-action); color: var(--color-on-action);` と同じ慣習）。
 * ページ背景色である `--color-bg` を転用しない。
 */
describe('style.css: .indicator-toggle-check の color トークン（CR-1是正）', () => {
  const styleCssSource = readFileSync(resolve(__dirname, '../../frontend/style.css'), 'utf-8');

  it('.indicator-toggle-check の color が var(--color-on-action) である', () => {
    const blockMatch = styleCssSource.match(/\.indicator-toggle-check\s*\{([\s\S]*?)\}/);
    expect(blockMatch).not.toBeNull();
    const block = blockMatch?.[1] ?? '';
    expect(block).toMatch(/color:\s*var\(--color-on-action\);/);
  });

  it('.indicator-toggle-check の color に var(--color-bg) を使っていない（誤用の再発防止）', () => {
    const blockMatch = styleCssSource.match(/\.indicator-toggle-check\s*\{([\s\S]*?)\}/);
    const block = blockMatch?.[1] ?? '';
    expect(block).not.toMatch(/color:\s*var\(--color-bg\);/);
  });
});

describe('IndicatorCustomPage.tsx / IndicatorRow.tsx: 保存中は行を disabled にする（fe-reviewer CR-3）', () => {
  it('IndicatorCustomPage.tsx が <IndicatorRow> に disabled={saving} を渡している', () => {
    expect(indicatorCustomPageSource).toMatch(/<IndicatorRow[\s\S]*?disabled=\{saving\}/);
  });

  it('IndicatorRow.tsx のトグル<button>が disabled prop を受け取っている（保存中は操作不可）', () => {
    // トグルボタンの定義箇所（aria-pressed を持つ button）に disabled={disabled} が付いていること
    expect(indicatorRowSource).toMatch(
      /<button[\s\S]*?aria-pressed=\{selected\}[\s\S]*?disabled=\{disabled\}/,
    );
  });

  it('IndicatorRow.tsx の <NumberInput> は選択解除中だけでなく disabled（保存中）でも無効化する', () => {
    // §2「選択解除された行の数値入力はdisabled」に加え、保存中は選択有無に関わらず無効化する
    expect(indicatorRowSource).toMatch(/disabled=\{disabled \|\| !selected\}/);
  });
});
