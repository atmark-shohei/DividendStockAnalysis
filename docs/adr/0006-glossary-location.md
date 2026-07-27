# ADR-0006: 用語集を `docs/glossary.md` に置く

- ステータス: ✅ 採用
- 日付: 2026-07-28

## 背景

用語集の実物が `.claude/docs/glossary.md` にある一方、`.claude/CLAUDE.md` の
ドキュメント構成は `docs/glossary.md` を指しており、**正が2箇所に見えていた**。
（`docs/domain-model.md` と `docs/adr/` も同様に、参照だけあって実体が無かった。）

## 決定

**用語集を `docs/glossary.md` へ移す。** `.claude/` は Claude 向けの設定
（規約・agents・skills）だけを置く場所とする。`docs/domain-model.md` と
`docs/adr/` も `docs/` 配下に作った。

## 理由

- 用語集は**人間もレビューする仕様の一部**であり、ルート `CLAUDE.md` が
  「`docs/` — 仕様の正」と定義している。そこに合わせるのが一貫する
- `.claude/` は Claude Code の設定ディレクトリであり、
  ツールを使わない読者にとって発見しにくい

## 影響

- 用語集の内容も実装に合わせて更新した（`docs/glossary-update-proposal.md` の提案を適用）:
  - `Score`「1〜10」→ **「0〜10」**（§0.3 / §0.4 / §0.5 が 0点を要求する）
  - `ScoreThreshold`「10段階／境界9個」→ **「11段階／境界10個」**
  - 実装にあって用語集に無かった10語（`ScoreBand` / `Sen` / `MetricScore` ほか）を追加
- `.claude/docs/` は削除した
