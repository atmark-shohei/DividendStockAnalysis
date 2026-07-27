# ADR-0005: 閾値は当面デフォルト固定。`UserScoringPolicy` は導入しない

- ステータス: ✅ 採用（保留の明示）
- 日付: 2026-07-28
- 関連: T-003 / T-004（認証の要否）, `docs/glossary.md`

## 背景

`.claude/CLAUDE.md` と用語集は `UserScoringPolicy`（ユーザーごとの閾値上書き）を
前提にしていた。一方、**認証の要否（T-003 / T-004）が未決**であり、
「自分だけがローカルで使う」なら `MasterUser` / `Viewer` / `UserScoringPolicy` は
そもそも不要になる。

## 決定

- 閾値は `src/domain/scoring/bands.ts` の定数（デフォルト閾値）に固定する
- `UserScoringPolicy` / `MasterUser` / `Viewer` は**コードに登場させない**
- 用語集ではこの3語を「🔴 未決」節に隔離した

## 理由

- 認証が不要と決まればこの3概念ごと消える。先に作ると捨てる
- 閾値を引数で受け取る形にするだけなら、あとから機械的に変えられる
  （10指標すべてが `scoreByBands(BANDS, value)` の1行を通っている）

## 影響と、そのとき必ずやること

⚠️ **ユーザーが閾値を入力できるようにした瞬間、区分表の実行時検証が必須になる。**

現在 `assertContiguous` は**テストからしか呼ばれていない**。閾値が定数である限り
これは正しい（モジュール読み込み時に throw すると原因が追いにくい）。しかし
ユーザー入力の閾値を受け取ると、穴のある表が保存でき、`lookupPoints` は
該当なしで `null` を返し、**画面には理由なく `—` が出る**。

そのために `validateBands()` を `Result<_, DomainError>` を返す形で用意してある
（`{ kind: 'ThresholdNotAscending' | 'ThresholdTopBounded' | 'ThresholdEmpty' }`）。
ポリシー導入時はこれを保存前に必ず通すこと。
