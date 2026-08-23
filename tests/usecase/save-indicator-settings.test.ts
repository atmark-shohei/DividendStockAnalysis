import { describe, expect, it, vi } from 'vitest';

import * as bandScaling from '@/domain/scoring/band-scaling';
import { type UserIndicatorSettings } from '@/domain/scoring/user-indicator-settings';
import { type UserIndicatorSettingsRepository } from '@/domain/scoring/user-indicator-settings-repository';
import { err } from '@/domain/shared/result';
import {
  type SaveIndicatorSettingsRequest,
  saveIndicatorSettings,
} from '@/usecase/save-indicator-settings';

/**
 * `saveIndicatorSettings`（PUT /api/indicator-settings。T-101）。
 *
 * 検証順序は `docs/02_design/api/portfolio-api.md` §指標カスタマイズ の表、
 * `docs/02_design/ui/pages/indicator-custom-page.md` §3・§4 のとおり。
 * table-driven + 境界値（5〜10件の境界、⑨拒否、基準値0以下、範囲外）を必ず踏む。
 */

/**
 * `invalid-bands` 分岐（手順6）は、それより前の
 * 「基準値>0」「§3のmin/max・きざみ範囲内」検証を通過した値であれば、
 * `scaleBands()` は全境界を同一の正スケールで線形変換するだけなので
 * 理論上到達しない（`save-indicator-settings.ts` のコメント参照）。
 * 実際に発火させる正当な入力を境界値の探索で構築することはできないため、
 * `scaleBands` をモックで失敗させ、usecase 側のエラー伝播（`kind: 'invalid-bands'`
 * への変換、対象キーと `domainError` の保持）だけを検証する。
 */
vi.mock('@/domain/scoring/band-scaling', async (importOriginal) => {
  const actual = await importOriginal<typeof bandScaling>();
  return { ...actual, scaleBands: vi.fn(actual.scaleBands) };
});

function fakeRepository() {
  const saved: { userId: number | null; settings: UserIndicatorSettings | null } = {
    userId: null,
    settings: null,
  };
  const repository: UserIndicatorSettingsRepository = {
    findByUserId: () => Promise.resolve(null),
    replaceAll: (userId: number, settings: UserIndicatorSettings): Promise<void> => {
      saved.userId = userId;
      saved.settings = settings;
      return Promise.resolve();
    },
  };
  return { repository, saved };
}

/** 5指標選択・全指標に有効な基準値を持つ「正常系」のベース */
function validRequest(overrides: Partial<SaveIndicatorSettingsRequest> = {}): SaveIndicatorSettingsRequest {
  return {
    selected: ['dividendGrowthRate', 'consecutiveYears', 'roeAverage', 'operatingMargin', 'dividendYield'],
    basisValues: {
      dividendGrowthRate: 20,
      consecutiveYears: 10,
      roeAverage: 10,
      operatingMargin: 15,
      dividendYield: 4,
    },
    ...overrides,
  };
}

describe('saveIndicatorSettings — 正常系', () => {
  it('検証を通過したら全置換で保存し、保存内容を返す', async () => {
    const { repository, saved } = fakeRepository();
    const result = await saveIndicatorSettings(repository, 1, validRequest());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(saved.userId).toBe(1);
    expect(saved.settings).toEqual(result.value);
    expect(result.value.selectedKeys).toEqual(validRequest().selected);
  });

  it('境界値: 選択5件（下限）は成功する', async () => {
    const { repository } = fakeRepository();
    const result = await saveIndicatorSettings(repository, 1, validRequest());
    expect(result.ok).toBe(true);
  });

  it('境界値: 選択10件（上限）は成功する', async () => {
    const { repository } = fakeRepository();
    const request = validRequest({
      selected: [
        'dividendGrowthRate',
        'consecutiveYears',
        'payoutRatio',
        'epsCagr',
        'roeAverage',
        'dividendSustainability',
        'revenueCagr',
        'operatingMargin',
        'mixCoefficient',
        'dividendYield',
      ],
      basisValues: {
        dividendGrowthRate: 20,
        consecutiveYears: 10,
        payoutRatio: 30,
        epsCagr: 15,
        roeAverage: 10,
        dividendSustainability: 8,
        revenueCagr: 12,
        operatingMargin: 15,
        dividendYield: 4,
        // ⑨MIX係数は基準値を持たない（選択はできる）
      },
    });
    const result = await saveIndicatorSettings(repository, 1, request);
    expect(result.ok).toBe(true);
  });

  it('重複した selected キーは去重してから件数を数える（DBの複合PK違反を防ぐ防御）', async () => {
    const { repository } = fakeRepository();
    const request = validRequest({
      selected: [
        'dividendGrowthRate',
        'dividendGrowthRate',
        'consecutiveYears',
        'roeAverage',
        'operatingMargin',
        'dividendYield',
      ],
    });
    const result = await saveIndicatorSettings(repository, 1, request);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.selectedKeys).toHaveLength(5);
  });
});

describe('saveIndicatorSettings — 選択件数の境界値', () => {
  const allKeys = [
    'dividendGrowthRate',
    'consecutiveYears',
    'payoutRatio',
    'epsCagr',
    'roeAverage',
    'dividendSustainability',
    'revenueCagr',
    'operatingMargin',
    'mixCoefficient',
    'dividendYield',
  ] as const;

  it.each([0, 1, 2, 3, 4])('%i件（下限未満）は selected-count-out-of-range で拒否', async (count) => {
    const { repository } = fakeRepository();
    const request = validRequest({ selected: allKeys.slice(0, count) });
    const result = await saveIndicatorSettings(repository, 1, request);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('selected-count-out-of-range');
  });

  /**
   * `MetricKey` は10種類しか無いため、zod（`z.enum(METRIC_KEYS)`）を通過した配列は
   * 重複を除くと必ず10件以下になる。「11件（上限超過）」は
   * `selected` に重複キーを混ぜても構造的に再現できない（本関数の重複排除が
   * 件数チェックより先に走るため）。上限境界は「10件で成功する」ことでのみ確認できる
   * （前段の「正常系」describe参照）。
   */
  it('重複を含めて11要素にしても、去重後は10件なので成功する（上限は10件ちょうどで検証済み）', async () => {
    const { repository } = fakeRepository();
    const request = validRequest({
      selected: [...allKeys, 'dividendGrowthRate'],
      basisValues: {
        dividendGrowthRate: 20,
        consecutiveYears: 10,
        payoutRatio: 30,
        epsCagr: 15,
        roeAverage: 10,
        dividendSustainability: 8,
        revenueCagr: 12,
        operatingMargin: 15,
        dividendYield: 4,
      },
    });
    const result = await saveIndicatorSettings(repository, 1, request);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.selectedKeys).toHaveLength(10);
  });
});

describe('saveIndicatorSettings — ⑨MIX係数の基準値拒否', () => {
  it('basisValues に mixCoefficient キーがあれば選択の有無に関わらず400相当で拒否', async () => {
    const { repository } = fakeRepository();
    const request = validRequest({
      basisValues: { ...validRequest().basisValues, mixCoefficient: 1 },
    });
    const result = await saveIndicatorSettings(repository, 1, request);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('mix-coefficient-basis-value-present');
  });
});

describe('saveIndicatorSettings — 基準値の欠落', () => {
  it('選択した指標（MIX係数を除く）の基準値が無ければ拒否', async () => {
    const { repository } = fakeRepository();
    const request = validRequest({
      basisValues: { consecutiveYears: 10, roeAverage: 10, operatingMargin: 15, dividendYield: 4 },
    });
    const result = await saveIndicatorSettings(repository, 1, request);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('basis-value-missing');
    if (result.error.kind === 'basis-value-missing') {
      expect(result.error.key).toBe('dividendGrowthRate');
    }
  });
});

describe('saveIndicatorSettings — 基準値が0以下（ADR-0012 §4）', () => {
  it.each([
    { value: 0, label: '0ちょうど' },
    { value: -1, label: '負の値' },
  ])('①の基準値が$label なら拒否（昇順指標も0以下は拒否）', async ({ value }) => {
    const { repository } = fakeRepository();
    const request = validRequest({
      basisValues: { ...validRequest().basisValues, dividendGrowthRate: value },
    });
    const result = await saveIndicatorSettings(repository, 1, request);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('basis-value-not-positive');
  });

  it('③予想配当性向（降順・§3の表の min は -100）でも0以下は拒否される（§4.0の追加ガード）', async () => {
    const { repository } = fakeRepository();
    const request = validRequest({
      selected: ['payoutRatio', 'consecutiveYears', 'roeAverage', 'operatingMargin', 'dividendYield'],
      basisValues: {
        payoutRatio: -50,
        consecutiveYears: 10,
        roeAverage: 10,
        operatingMargin: 15,
        dividendYield: 4,
      },
    });
    const result = await saveIndicatorSettings(repository, 1, request);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('basis-value-not-positive');
  });
});

describe('saveIndicatorSettings — 基準値の範囲外（§3の表のmin/max・きざみ）', () => {
  it('①増配率は 0.1 きざみ。50を超えると範囲外', async () => {
    const { repository } = fakeRepository();
    const request = validRequest({
      basisValues: { ...validRequest().basisValues, dividendGrowthRate: 50.1 },
    });
    const result = await saveIndicatorSettings(repository, 1, request);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('basis-value-out-of-range');
  });

  it('①増配率は 0.1 きざみでない値（20.05）は範囲外扱い', async () => {
    const { repository } = fakeRepository();
    const request = validRequest({
      basisValues: { ...validRequest().basisValues, dividendGrowthRate: 20.05 },
    });
    const result = await saveIndicatorSettings(repository, 1, request);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('basis-value-out-of-range');
  });

  it('境界値ちょうど（50.0）は成功する', async () => {
    const { repository } = fakeRepository();
    const request = validRequest({
      basisValues: { ...validRequest().basisValues, dividendGrowthRate: 50 },
    });
    const result = await saveIndicatorSettings(repository, 1, request);
    expect(result.ok).toBe(true);
  });

  it('②連続非減配年数は 1 きざみ・0〜50年。51年は範囲外', async () => {
    const { repository } = fakeRepository();
    const request = validRequest({
      basisValues: { ...validRequest().basisValues, consecutiveYears: 51 },
    });
    const result = await saveIndicatorSettings(repository, 1, request);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('basis-value-out-of-range');
  });
});

describe('saveIndicatorSettings — invalid-bands（scaleBandsが失敗した場合の防御的分岐）', () => {
  it('scaleBandsがドメインエラーを返したら invalid-bands としてキーとdomainErrorを伝播する', async () => {
    const { repository } = fakeRepository();

    // 基準値バリデーションを通過した最初のキー（dividendGrowthRate）に対する
    // scaleBands呼び出しだけを1回だけ失敗させる（この関数はキー順に走査し、
    // 最初のエラーで即 return するため、mockReturnValueOnce の対象が
    // 意図したキーになる）。
    const domainError = {
      kind: 'ThresholdNotAscending',
      lowerPoints: 5,
      lowerMax: 10,
      upperPoints: 6,
      upperMin: 20,
    } as const;
    vi.mocked(bandScaling.scaleBands).mockReturnValueOnce(err(domainError));

    const request = validRequest({
      selected: [
        'dividendGrowthRate',
        'consecutiveYears',
        'roeAverage',
        'operatingMargin',
        'dividendYield',
      ],
    });
    const result = await saveIndicatorSettings(repository, 1, request);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('invalid-bands');
    if (result.error.kind !== 'invalid-bands') return;
    expect(result.error.key).toBe('dividendGrowthRate');
    expect(result.error.domainError).toEqual(domainError);
  });
});
