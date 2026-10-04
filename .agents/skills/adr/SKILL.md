---
name: adr
description: 設計判断を Architecture Decision Record として docs/adr/ に記録する。「ADR」「設計判断を記録」で起動。
---

# ADR 作成

設計上の意思決定を `docs/adr/NNNN-タイトル.md` に記録する（NNNNは連番。既存の最大値+1）。

## テンプレート

```markdown
# NNNN: <決定内容を1行で>

- 日付: YYYY-MM-DD
- ステータス: 承認 | 提案中 | 廃止 (-> NNNN で置換)

## 文脈

なぜこの判断が必要になったか。制約条件（Cloudflare Workers の制限、D1 の特性、データ量など）。

## 決定

何をどうすると決めたか（1〜3文）。

## 検討した代替案

- 案A: 概要 - 不採用理由
- 案B: 概要 - 不採用理由

## 結果・影響

この決定で楽になること / 引き受けるトレードオフ / 見直しのトリガー条件。
```
