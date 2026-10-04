# BE テストパターン（Vitest）

## 1. 置き場所

- テストは `src/` に **colocate しない**。`tests/` 配下に src と同じ構造でミラーする
  （実体のフォルダ名（`test/` か `tests/` か）は vitest 設定の include で確認し、リポジトリ実体に従う）

## 2. 2系統構成（Vitest projects）

| 系統    | 設定                       | 対象                                  | ランタイム                        |
| ------- | -------------------------- | ------------------------------------- | --------------------------------- |
| unit    | `vitest.unit.config.ts`    | domain / usecase / handler / frontend | Node（Cloudflare 不要）           |
| workers | `vitest.workers.config.ts` | infra と Worker 全体の結線            | `@cloudflare/vitest-pool-workers` |

- domain が素の TS であることの裏返しで、**計算ロジックのテストは Cloudflare ランタイムを必要としない**。domain / usecase / handler のテストは必ず unit 側に置く
- workers 側は infra（D1 + Drizzle）と Worker 結線の検証に限定する

## 3. スタイル

- **table-driven を基本**とし、テスト名で「何が壊れたか」が分かるようにする

  ```ts
  const cases: ReadonlyArray<{ name: string; input: ...; expected: ... }> = [
    { name: '0円: スコアは null (division-by-zero)', ... },
    { name: '期末日跨ぎ: 直前期の値を採用', ... },
  ];
  it.each(cases)('$name', ({ input, expected }) => { ... });
  ```

- **テストで実 API を叩かない**。モックは実物のサンプルデータから作る
- Result パターンのテストは `ok: false` 側の `error.kind` まで検証する

## 4. 必須の境界値テスト

- **金額・日付を扱う変更**: 0円 / 無配（配当なし）/ 期末日跨ぎ / 株式分割前後 の境界値テストを必ず書く
- **指標（スコアリング）の追加・変更**: 次の 4 系統を必ず踏む
  1. 境界値ちょうど（区分の下限・上限）
  2. 負の値
  3. 無配（配当なし）
  4. 欠損（`null` → `unavailableReason` が正しく設定されるか）
- `null` と 0 の区別: 「判定不可のとき score が `null` である（0 に丸められていない）」ことを明示的に検証する

## 5. 完了条件（受け入れ基準）

明示がない限り、以下がすべて満たされて初めて「完了」:

- `npm test` が全パス
- `npm run typecheck` が全パス
- `npm run lint` が全パス
- 変更した挙動に対応するテストが `tests/` にある
- §4 の境界値テストがある（該当する変更の場合）

**推測で「完了」と言わない。** 完了報告には証拠（コマンド出力・ファイル行）を添える。失敗したら失敗したと出力付きで報告する。
