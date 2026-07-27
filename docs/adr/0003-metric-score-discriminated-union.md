# ADR-0003: 判定不能と 0点を型で区別する（`MetricScore`）

- ステータス: ✅ 採用
- 日付: 2026-07-28
- 関連: T-048, `scoring-requirements.md` §0.5

## 背景

「**計算できなかった**（`null`）」と「**計算した結果が最低区分**（0点）」の区別は
本システムの中心要件（§0.5）だが、移行前はそれを守っているのが**型ではなく
レビューと実行時ガードだけ**だった。

```ts
// 移行前
export interface DividendYieldResult {
  readonly score: number | null;
  readonly unavailableReason: YieldUnavailableReason | null;
}
```

この型は次の2つを**どちらも許してしまう**:

- `score: null` かつ `unavailableReason: null` — 何も分からない結果
- `score: 5` かつ `unavailableReason: 'price-zero'` — 矛盾した結果

旧実装はこの区別が実装上まったく無く、判定不能をすべて 0点で返していた
（`reference/legacy-web/app.js:189-311`）。同じ形で残り9指標を書くと
9箇所を後から直すことになるため、着手前に決める必要があった（T-048）。

## 決定

**`unavailableReason` を判別子にした判別可能ユニオンにする。**

```ts
export type MetricScore<R extends string = UnavailableReason> =
  | { readonly score: Score; readonly value: number; readonly unavailableReason: null }
  | { readonly score: null; readonly value: null; readonly unavailableReason: R };
```

上の2つの不正な形は**いずれも型エラー**になる（`tests/domain/shared/kernel.test.ts` で
`@ts-expect-error` により固定）。

## 理由

- 新しいフィールド（`kind` など）を足さずに判別子を作れたので、
  **既存96テストのアサーションを1行も変えずに**型を締められた
- `Score` を branded type（0〜10 の整数）にしたことで、区分表の外の値が
  黙って通る経路も同時に塞げた

## 影響

- 10指標すべてがこの形で返る。⑩ だけは表示に採用元（予想/実績）が要るため
  独自の結果型を持つが、判別子の作り方は同じで、`dividendYieldToMetricScore` で
  共通形へ変換できる
- 総合点の集計（`buildScoreCard`）は `isScored` で分岐するだけになった

## 検証

`npm test` → 379 passed。既存96件は**テストファイル無変更のまま**通過した。
