import { describe, expect, it } from 'vitest';

import type { PortfolioSummary } from '../../frontend/api';
import {
  acquisitionPriceErrorText,
  buildAddHoldingPayload,
  buildUpdateHoldingPayload,
  canAddHolding,
  canAddPortfolio,
  canSubmitEditHoldingForm,
  canSubmitHoldingForm,
  codeErrorText,
  holdingsEmptyStateContent,
  MAX_HOLDINGS_PER_PORTFOLIO,
  normalizeHoldingCodeInput,
  parseAcquisitionPriceInput,
  parseQuantityInput,
  portfolioEmptyStateContent,
  portfolioNameErrorText,
  quantityErrorText,
  resolveActivePortfolioId,
  type EditHoldingFormValues,
  type HoldingFormValues,
} from '../../frontend/pages/portfolio-page-logic';

/**
 * ポートフォリオ画面（`/portfolio`、T-103）の純関数群。`@testing-library/react` 未導入のため、
 * `indicator-custom-logic.test.ts` と同じ方針で table-driven に検証する。
 */

describe('canAddPortfolio（`portfolio-page.md` §3「10個未満のときだけ活性」）', () => {
  const cases: readonly (readonly [name: string, count: number, max: number, expected: boolean])[] =
    [
      ['9個 → 10個目を追加できる', 9, 10, true],
      ['10個ちょうど（上限） → 追加できない（境界値）', 10, 10, false],
      ['0個 → 追加できる', 0, 10, true],
      ['11個（上限超え・異常値でも安全側でfalse）', 11, 10, false],
    ];

  it.each(cases)('%s', (_name, count, max, expected) => {
    expect(canAddPortfolio(count, max)).toBe(expected);
  });
});

describe('canAddHolding（`portfolio-page.md` §5「100銘柄到達時はdisabled」）', () => {
  const cases: readonly (readonly [name: string, count: number, max: number, expected: boolean])[] =
    [
      ['99件 → 100件目を追加できる', 99, MAX_HOLDINGS_PER_PORTFOLIO, true],
      ['100件ちょうど（上限） → 追加できない（境界値）', 100, MAX_HOLDINGS_PER_PORTFOLIO, false],
      ['0件 → 追加できる', 0, MAX_HOLDINGS_PER_PORTFOLIO, true],
    ];

  it.each(cases)('%s', (_name, count, max, expected) => {
    expect(canAddHolding(count, max)).toBe(expected);
  });

  it('MAX_HOLDINGS_PER_PORTFOLIO は 100（§1「1ポートフォリオに最大100銘柄」）', () => {
    expect(MAX_HOLDINGS_PER_PORTFOLIO).toBe(100);
  });
});

describe('portfolioEmptyStateContent / holdingsEmptyStateContent（§6空状態の文言分岐）', () => {
  it('ポートフォリオ0件の見出しと保有銘柄0件の見出しは異なる', () => {
    expect(portfolioEmptyStateContent().heading).not.toBe(holdingsEmptyStateContent().heading);
  });

  it('ポートフォリオ0件: 「ポートフォリオがありません」', () => {
    expect(portfolioEmptyStateContent().heading).toBe('ポートフォリオがありません');
  });

  it('保有銘柄0件: 「銘柄を追加してください」', () => {
    expect(holdingsEmptyStateContent().heading).toBe('銘柄を追加してください');
  });
});

describe('resolveActivePortfolioId（`portfolio-page.md` §2「既定: ユーザーの先頭ポートフォリオ」）', () => {
  const portfolios: readonly PortfolioSummary[] = [
    { id: 'pf_01', name: 'メインNISA', holdingCount: 4 },
    { id: 'pf_02', name: '高配当コア', holdingCount: 2 },
  ];

  it('portfolioIdParam が指定されていればそれを優先する', () => {
    expect(resolveActivePortfolioId('pf_02', portfolios)).toBe('pf_02');
  });

  it('portfolioIdParam が null なら先頭ポートフォリオへフォールバックする', () => {
    expect(resolveActivePortfolioId(null, portfolios)).toBe('pf_01');
  });

  it('ポートフォリオが1つも無ければ null（「作る前」の状態。§2）', () => {
    expect(resolveActivePortfolioId(null, [])).toBeNull();
  });

  it('portfolioIdParam が指定されていても一覧が空なら null にはせず、そのまま返す（未取得直後の遷移を壊さないため）', () => {
    expect(resolveActivePortfolioId('pf_99', [])).toBe('pf_99');
  });
});

describe('portfolioNameErrorText（`portfolio-api.md` §POST /api/portfolios「1〜50文字。空文字は400」）', () => {
  it('空文字はエラー', () => {
    expect(portfolioNameErrorText('')).not.toBeNull();
  });

  it('空白のみもエラー（trimして空文字扱い）', () => {
    expect(portfolioNameErrorText('   ')).not.toBeNull();
  });

  it('50文字ちょうどはOK（境界値）', () => {
    expect(portfolioNameErrorText('a'.repeat(50))).toBeNull();
  });

  it('51文字はエラー（境界値超え）', () => {
    expect(portfolioNameErrorText('a'.repeat(51))).not.toBeNull();
  });

  it('通常の名前はOK', () => {
    expect(portfolioNameErrorText('メインNISA')).toBeNull();
  });
});

describe('codeErrorText（`routes.ts` の COMPANY_CODE と同一形式）', () => {
  it('空文字はエラー', () => {
    expect(codeErrorText('')).not.toBeNull();
  });

  it('形式不正（3桁のみ）はエラー', () => {
    expect(codeErrorText('720')).not.toBeNull();
  });

  it('形式不正（英字混入・末尾以外）はエラー', () => {
    expect(codeErrorText('72A3')).not.toBeNull();
  });

  it('正しい4桁数字はOK', () => {
    expect(codeErrorText('7203')).toBeNull();
  });

  it('末尾が英大文字の形式もOK', () => {
    expect(codeErrorText('130A')).toBeNull();
  });
});

describe('parseQuantityInput / quantityErrorText（保有数量は1以上の整数）', () => {
  it('空文字は null（未入力）', () => {
    expect(parseQuantityInput('')).toBeNull();
  });

  it('非整数（小数）は undefined（不正値）', () => {
    expect(parseQuantityInput('1.5')).toBeUndefined();
  });

  it('全角数字は半角に正規化して読める', () => {
    expect(parseQuantityInput('１００')).toBe(100);
  });

  it('quantityErrorText: 0はエラー（境界値）', () => {
    expect(quantityErrorText(0)).not.toBeNull();
  });

  it('quantityErrorText: 1はOK（境界値）', () => {
    expect(quantityErrorText(1)).toBeNull();
  });

  it('quantityErrorText: 負の値はエラー', () => {
    expect(quantityErrorText(-1)).not.toBeNull();
  });

  it('quantityErrorText: null（未入力）はエラー', () => {
    expect(quantityErrorText(null)).not.toBeNull();
  });

  it('quantityErrorText: undefined（不正値）はエラー', () => {
    expect(quantityErrorText(undefined)).not.toBeNull();
  });
});

describe('parseAcquisitionPriceInput / acquisitionPriceErrorText（取得単価は0円より大きい額）', () => {
  it('空文字は null（未入力）', () => {
    expect(parseAcquisitionPriceInput('')).toBeNull();
  });

  it('円をそのまま銭へ変換する（2800円 → 280000銭）', () => {
    expect(parseAcquisitionPriceInput('2800')).toBe(280_000);
  });

  it('小数第2位までの円を正しく銭へ変換する（183.59円 → 18359銭）', () => {
    expect(parseAcquisitionPriceInput('183.59')).toBe(18_359);
  });

  it('3桁区切りのカンマを許容する', () => {
    expect(parseAcquisitionPriceInput('2,800')).toBe(280_000);
  });

  it('非数値は undefined（不正値）', () => {
    expect(parseAcquisitionPriceInput('abc')).toBeUndefined();
  });

  it('acquisitionPriceErrorText: 0円ちょうどはエラー（§5「0以下は拒否」境界値）', () => {
    expect(acquisitionPriceErrorText(0)).not.toBeNull();
  });

  it('acquisitionPriceErrorText: 1銭はOK（0より大きい境界値）', () => {
    expect(acquisitionPriceErrorText(1)).toBeNull();
  });

  it('acquisitionPriceErrorText: 負の値はエラー', () => {
    expect(acquisitionPriceErrorText(-1)).not.toBeNull();
  });
});

describe('canSubmitHoldingForm / buildAddHoldingPayload', () => {
  const validValues: HoldingFormValues = {
    code: '7203',
    quantityText: '100',
    acquisitionPriceText: '2800',
  };

  it('すべて正しい入力は送信可能', () => {
    expect(canSubmitHoldingForm(validValues)).toBe(true);
  });

  it('銘柄コードが不正なら送信不可', () => {
    expect(canSubmitHoldingForm({ ...validValues, code: '720' })).toBe(false);
  });

  it('保有数量が0以下なら送信不可', () => {
    expect(canSubmitHoldingForm({ ...validValues, quantityText: '0' })).toBe(false);
  });

  it('取得単価が未入力なら送信不可', () => {
    expect(canSubmitHoldingForm({ ...validValues, acquisitionPriceText: '' })).toBe(false);
  });

  it('buildAddHoldingPayload: 正しい入力から payload を組み立てる', () => {
    expect(buildAddHoldingPayload(validValues)).toEqual({
      code: '7203',
      quantity: 100,
      acquisitionPriceSen: 280_000,
    });
  });

  it('buildAddHoldingPayload: 不正な入力は null（無効な payload を組み立てない）', () => {
    expect(buildAddHoldingPayload({ ...validValues, code: '720' })).toBeNull();
  });
});

/**
 * CR-1（fe-review CR-1）: 銘柄コード入力の全角→半角正規化。`toHalfWidthNumber` を
 * 再利用し、全角数字・全角英字・大文字化・前後空白のtrimをまとめて検証する。
 */
describe('normalizeHoldingCodeInput（CR-1: 全角→半角正規化）', () => {
  const cases: readonly (readonly [name: string, input: string, expected: string])[] = [
    ['半角英数字はそのまま', '7203', '7203'],
    ['全角数字は半角に変換する', '７２０３', '7203'],
    ['全角英字混在は半角化＋大文字化する', '１３０ａ', '130A'],
    ['前後の空白はtrimする', '  7203  ', '7203'],
  ];

  it.each(cases)('%s', (_name, input, expected) => {
    expect(normalizeHoldingCodeInput(input)).toBe(expected);
  });
});

/**
 * CR-3（fe-review CR-3・推測仕様#5、Manager承認済み）: 保有銘柄編集フォームの
 * バリデーション・payload組み立て。数量・取得単価の両方を編集対象とし、
 * 両方とも有効な入力を必須とする前提（`portfolio-page-logic.ts` のTODOコメント参照）。
 */
describe('canSubmitEditHoldingForm / buildUpdateHoldingPayload（CR-3）', () => {
  const validValues: EditHoldingFormValues = {
    quantityText: '150',
    acquisitionPriceText: '2750',
  };

  it('数量のみ変更（取得単価は既存値のまま）は送信可能', () => {
    expect(canSubmitEditHoldingForm({ ...validValues, quantityText: '200' })).toBe(true);
  });

  it('取得単価のみ変更（数量は既存値のまま）は送信可能', () => {
    expect(canSubmitEditHoldingForm({ ...validValues, acquisitionPriceText: '3000' })).toBe(true);
  });

  it('両方0以下はエラー（送信不可。境界値）', () => {
    expect(
      canSubmitEditHoldingForm({ quantityText: '0', acquisitionPriceText: '0' }),
    ).toBe(false);
  });

  it('両方空欄はエラー（送信不可。未入力）', () => {
    expect(
      canSubmitEditHoldingForm({ quantityText: '', acquisitionPriceText: '' }),
    ).toBe(false);
  });

  it('buildUpdateHoldingPayload: 正しい入力から payload を組み立てる', () => {
    expect(buildUpdateHoldingPayload(validValues)).toEqual({
      quantity: 150,
      acquisitionPriceSen: 275_000,
    });
  });

  it('buildUpdateHoldingPayload: code フィールドを含まない（UpdateHoldingRequest は code を持たない）', () => {
    const payload = buildUpdateHoldingPayload(validValues);
    expect(payload).not.toBeNull();
    expect(payload).not.toHaveProperty('code');
  });

  it('buildUpdateHoldingPayload: 不正な入力は null（無効な payload を組み立てない）', () => {
    expect(buildUpdateHoldingPayload({ quantityText: '0', acquisitionPriceText: '2750' })).toBeNull();
  });
});
