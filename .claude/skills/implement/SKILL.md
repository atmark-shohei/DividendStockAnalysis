---
name: implement
description: タスク（機能）単位で BE/FE/テスト/レビューを一括実装するオーケストレータ。Manager として各専門エージェントにタスクを fork で委譲する。
argument-hint: <タスクID または 機能名> [BE|FE]
allowed-tools: Read, Grep, Glob, Bash, Agent, Write, Edit, TaskCreate, TaskUpdate
---

# 機能実装（Manager / オーケストレータ）

タスク `$ARGUMENTS` を一括実装する。

あなたは **Manager**（オーケストレーター）です。
**implement はコミットを実行しない。** コミットはユーザーが実行する。
**implement はデプロイ（`wrangler deploy`）・D1 本番適用を実行しない。** マイグレーションファイルの生成までを担い、適用はユーザーが判断する（ローカル/テスト用 DB への適用はテスト実行に必要な範囲で可）。

## Bootstrap（最初の操作）

Manager は本 SKILL.md を読み込んだ直後、`.claude/skills/_common/manager-rules.md` を Read して **§1.0 bootstrap sequence**（中断検知 / $WORK 作成 / checkpoint.json + decisions.md 初期化 / TaskCreate）を実行する。

## ファイル経由の引き継ぎ（$WORK）

本スキルは Manager とサブエージェントの間でファイル経由の成果物受け渡しを行う。詳細規約は以下を参照：

- `.claude/skills/_common/skill-tmp-files-rules.md`: `$WORK` 配下のパス・命名・Read/Write 規約（全エージェント向け）
- `.claude/skills/_common/manager-rules.md`: Manager の共通行動規範（checkpoint / decisions.md / 中断再開 / インタラクティブモード含む）

### 本スキルで生成するファイル一覧

| Step | 担当 | $WORK 配下のファイル | 用途 |
|------|------|-----------------|------|
| Bootstrap | Manager | `checkpoint.json` | 進捗管理（各 Step 完了時に Manager が更新） |
| 全 Step | Manager | `decisions.md` | デシジョン + 修正ファイルログ |
| Step 1 | codebase-explorer | `prep/be-index.md`, `prep/fe-index.md` | BE/FE インデックス（同一機能 2 回目以降は再利用） |
| Step 2 | be-developer / fe-developer | `prep/be-plan.md`, `prep/fe-plan.md` | 計画・引き継ぎサマリ |
| Step 6 | be-reviewer / fe-reviewer | `reviews/be-review.md`, `reviews/fe-review.md` | コードレビュー結果 |

> **$WORK トップレベルに置くファイルは `checkpoint.json` / `decisions.md` のみ**。索引・計画は `prep/`、レビュー結果は `reviews/` に収める。

## 引数の解析

`$ARGUMENTS` を以下のルールで解析する：

| 引数パターン | 解析結果 |
|------------|---------|
| `<タスク>` | target = **ALL**（BE + FE 両方を実行） |
| `<タスク> BE` | target = **BE**（src/ Worker 側のみ実行） |
| `<タスク> FE` | target = **FE**（frontend/ のみ実行） |

- `<タスク>` は `docs/03_tasks/current-sprint.md` のタスク、または機能名
- 第 2 引数が省略された場合は **ALL**。大文字・小文字は区別しない

## target 別の実行ステップ

| Step | 内容 | ALL | BE | FE |
|------|------|:---:|:--:|:--:|
| 1 | 軽量オーケストレーション | ✅ | ✅ | ✅ |
| 2 | 計画フェーズ（BE + FE 並行 fork） | ✅ | ✅ | ✅ |
| 3 | ユーザー承認（両計画をまとめて提示） | ✅ | ✅ | ✅ |
| 4 | 実装フェーズ（BE + FE 並行 fork） | ✅ | ✅ | ✅ |
| 5 | 受け入れゲート実行（Manager） | ✅ | ✅ | ✅ |
| 6 | レビューフェーズ（BE + FE 並行 fork） | ✅ | ✅ | ✅ |
| 7 | レビュー指摘処理 | ✅ | ✅ | ✅ |
| 8 | エスカレーション処理 | ✅ | ✅ | ✅ |
| 9 | 設計書更新 | ✅ | ✅ | ✅ |
| 10 | 完了報告 + インタラクティブモード | ✅ | ✅ | ✅ |

## 5人格アーキテクチャ

| 人格 | Agent 名 | 責務 |
|------|---------|------|
| **Manager（あなた）** | メインセッション | パス特定・タスク概要読込・承認仲介・受け入れゲート実行・結果集約 |
| **Codebase Explorer** | `codebase-explorer` | 既存パターン調査（読み取り専用） |
| **BE Developer** | `be-developer` | BE 計画立案 + domain/usecase/infra/handler の実装 + テスト生成・実行 |
| **BE Reviewer** | `be-reviewer` | BE コードレビュー（Read only。コマンド実行しない） |
| **FE Developer** | `fe-developer` | FE の実装 + テスト生成・実行 |
| **FE Reviewer** | `fe-reviewer` | FE コードレビュー（Read only。コマンド実行しない） |

## 実装フロー

### Step 0: 中断検知

bootstrap sequence（`manager-rules.md` §1.0 / §7）の中で実施。前回 `$WORK` の `checkpoint.json` 状態と `git status` の未コミット変更を確認し、必要に応じてユーザー選択肢を提示する。

### Step 1: 軽量オーケストレーション（Manager が実行）

> 常に実行。`$WORK` と `checkpoint.json` は bootstrap で作成済み。

Manager は **パス特定 + タスク概要のみ** を読む。設計書全文読込は行わない（Developer が Step 2 で読む）。

1. **タスクの特定**: `docs/03_tasks/current-sprint.md` から対象タスクを特定する。該当がなければユーザーの指示内容をタスクとして扱う
2. **関連設計書のパス特定**: `docs/02_design/{api,database,logic,ui}/` と `docs/adr/` を Glob し、対象機能に関連する設計書のパス一覧を作る（全文は読まない。見出しレベルの確認まで）
3. **codebase-explorer（fork）** で **BE/FEインデックス** を `$WORK/prep/be-index.md` / `$WORK/prep/fe-index.md` に Write させる。
   target に応じて BE インデックス・FE インデックス、または両方を作成させる。
   テストフォルダの実名（`test/` or `tests/`）と vitest 2 系統の分かれ方を必ず含めさせる。
   ※ 同一機能 2 回目以降はスキップ可（`$WORK/prep/` に前回結果が存在するかで判定）

---

### Step 2: 計画フェーズ（BE + FE 並行 fork）

target に応じて be-developer / fe-developer を **並行で fork**（`run_in_background: true`）し、計画立案のみを委譲する。
**★ 実装はまだ行わない。計画のみを返すこと。**

#### BE 計画（target = ALL or BE）

Agent ツール（`subagent_type: be-developer`, `run_in_background: true`）で計画立案。

**プロンプトに含める情報:**
- タスクID / 機能名と概要
- 読むべきドキュメントのパス一覧（`docs/glossary.md`・`docs/02_design/{api,database,logic}/` の該当設計書・`docs/03_tasks/current-sprint.md`・関連 ADR）
- 「まず `$WORK/prep/be-index.md` を Read して既存パターンを把握すること」の指示
- 「ドキュメント全文を読込み、実装計画を立案すること」の指示
- 「生成ファイル一覧を層別（domain → usecase → infra/d1(+ マイグレーション) → handler) + テスト（unit / workers の系統別）で列挙すること」の指示
- 「DB スキーマ変更を伴う場合、drizzle スキーマ変更 + `npm run db:generate` の要否を明示すること」の指示
- 「設計書に記載のない仕様・曖昧な記述・設計書間の矛盾は、確認事項として明示すること（推測で計画に含めない）」の指示
- **「計画 + 引き継ぎサマリを `$WORK/prep/be-plan.md` に Write すること。★ まだ実装しない」** の指示

#### FE 計画（target = ALL or FE）

Agent ツール（`subagent_type: fe-developer`, `run_in_background: true`）で計画立案。

**プロンプトに含める情報:**
- タスクID / 機能名と概要
- 読むべきドキュメントのパス一覧（`docs/glossary.md`・`docs/02_design/{ui,api}/` の該当設計書・`docs/03_tasks/current-sprint.md`）
- 「まず `$WORK/prep/fe-index.md` を Read して既存パターンを把握すること」の指示
- 「`ai/rules/fe/` の全規約を遵守すること。特に null（判定不可）を 0 と表示しない表示契約を計画に明記すること」の指示
- 「設計書に記載のない仕様・曖昧な記述は、確認事項として明示すること」の指示
- **「計画 + 引き継ぎサマリを `$WORK/prep/fe-plan.md` に Write すること。★ FE 実装はまだ行わない」の指示**

#### 完了待ち

target = ALL の場合、**両方の完了を待ってから** Step 3 に進む。

---

### Step 3: ユーザー承認（Manager が仲介）

Manager は `$WORK/prep/be-plan.md` と `$WORK/prep/fe-plan.md` を Read し、両計画をまとめてユーザーに提示する。報告フォーマット：

```markdown
====================================
■ BE 計画
====================================

<$WORK/prep/be-plan.md の内容>

====================================
■ FE 計画
====================================

<$WORK/prep/fe-plan.md の内容>

====================================
■ 確認事項
====================================

- <BE/FE の確認事項・エスカレーション事項をまとめて記載>
```

ユーザーの承認を得てから Step 4 に進む。

> **⚠️ AI からの「後回し推奨」を禁止**: 確認事項について Manager（AI）から「先に進めましょう」「後回しで OK」等の誘導を出してはならない（`manager-rules.md` §1.0.2）。事実のみ提示し、判断はユーザーに委ねること。

---

### Step 4: 実装フェーズ（BE + FE 並行 fork）

target に応じて be-developer / fe-developer を **並行で fork**（`run_in_background: true`）し、実装を委譲する。

#### BE 実装（target = ALL or BE）

Agent ツール（`subagent_type: be-developer`, `run_in_background: true`）で新規 be-developer を fork。

**プロンプトに含める情報:**
- 「まず `$WORK/prep/be-plan.md` を Read してコンテキストを復元すること」の指示
- 「まず `$WORK/prep/be-index.md` を Read して既存パターンを把握すること」の指示
- 「承認された計画に基づき実装を開始すること」の指示
- ユーザーからの修正指示（あれば）
- 「`ai/rules/be/test-patterns.md` に従いテストを生成すること。**計画に記載された全テストファイルを作成すること。省略不可**」の指示
- 「`npm test` / `npm run typecheck` / `npm run lint` を必ず実際に実行し、結果（成功 or エラー出力）を報告すること」の指示
- 「金額・日付を扱う変更には境界値テスト（0円 / 無配 / 期末日跨ぎ / 分割前後）、指標の追加・変更には 4 系統（境界値ちょうど / 負の値 / 無配 / 欠損）を必ず含めること」の指示
- 「推測で実装した箇所には TODO コメント + 推測根拠を記載すること」の指示

#### FE 実装（target = ALL or FE）

Agent ツール（`subagent_type: fe-developer`, `run_in_background: true`）で新規 fe-developer を fork。

**プロンプトに含める情報:**
- 「まず `$WORK/prep/fe-plan.md` を Read してコンテキストを復元すること」の指示
- 「まず `$WORK/prep/fe-index.md` を Read して既存パターンを把握すること」の指示
- 「承認された計画に基づき FE 実装を開始すること」の指示
- ユーザーからのフィードバック（あれば）
- 「テスト生成前に必ず vitest 設定（unit 系統）と既存 FE テスト・モックを Read すること。既存モックがあれば必ず採用し、新規モック作成・テストライブラリ追加を独自判断で行わないこと」の指示
- 「`npm test` / `npm run typecheck` / `npm run lint` を必ず実際に実行し、結果を報告すること」の指示
- 「null（判定不可）→ `-` 表示のテストを必ず含めること」の指示
- 「推測で実装した箇所には TODO コメント + 推測根拠を記載すること」の指示

> **注**: FE は docs（`docs/02_design/api/` の型契約）のみ参照する。BE の実装結果は不要。

#### 完了待ち

target = ALL の場合、**両方の完了を待ってから** Step 5 に進む。

---

### Step 5: 受け入れゲート実行（Manager が実行 - レビュー前）

Manager（メインセッション）で受け入れ基準のコマンドを **自分で再実行** し、Developer の報告を検証する：

```bash
npm test
npm run typecheck
npm run lint
```

**基準**: 3 つすべて全パス（`manager-rules.md` §3。推測で「完了」と言わない。出力を証拠として保持する）。

| 状況 | 対応 |
|------|------|
| 全パス | Step 6 へ |
| 失敗 | 該当する Developer を新規 fork し、`$WORK/prep/be-plan.md`（or `fe-plan.md`) + 実際のエラー出力をプロンプトに含めて修正指示 → 再実行（最大2回） |
| 2回目も失敗 | ユーザーに報告して判断を仰ぐ |

---

### Step 6: レビューフェーズ（BE + FE 並行 fork）

target に応じて be-reviewer / fe-reviewer を **並行で fork**（`run_in_background: true`）し、レビューを委譲する。
**Reviewer は Bash なし。コマンド実行は Step 5 で済み。**

#### BE レビュー（target = ALL or BE）

Agent ツール（`subagent_type: be-reviewer`, `run_in_background: true`）。

**プロンプトに含める情報:**
- Step 4 で作成された BE ファイル一覧
- 「まず `$WORK/prep/be-index.md` を Read して既存パターンを把握すること」の指示
- 「`ai/rules/be/code-review-checklist.md` の全観点で実装コード + テストコードをレビューすること」の指示
- 「`ai/rules/common/code-review-output-format.md` のフォーマットで報告すること」の指示
- 「全件を区分なしで報告すること（軽微なものを省略しない）」の指示
- **「レビュー結果を `$WORK/reviews/be-review.md` に Write すること」の指示**

#### FE レビュー（target = ALL or FE）

Agent ツール（`subagent_type: fe-reviewer`, `run_in_background: true`）。

**プロンプトに含める情報:**
- Step 4 で作成された FE ファイル一覧
- 「まず `$WORK/prep/fe-index.md` を Read して既存パターンを把握すること（null → 0 表示の混入を最優先）」の指示
- 「`ai/rules/fe/code-review-checklist.md` の全観点でレビューすること（null → 0 表示の混入を最優先）」の指示
- 「`ai/rules/common/code-review-output-format.md` のフォーマットで報告すること」の指示
- 「全件を区分なしで報告すること（軽微なものを省略しない）」の指示
- **「レビュー結果を `$WORK/reviews/fe-review.md` に Write すること」の指示**

#### 完了待ち

target = ALL の場合、**両方の完了を待ってから** Step 7 に進む。

> 障害時（出力空・途中切れ等）は `manager-rules.md` §2.4 の共通パターンに従う。

---

### Step 7: レビュー指摘の処理（Manager が実行）

Manager は `$WORK/reviews/be-review.md` と `$WORK/reviews/fe-review.md` を Read し（target に応じて該当分のみ）、両方のレビュー結果をまとめて処理する。

1. **推測仕様が報告された場合:**
   - Developer への差し戻しではなく、**ユーザーに確認** する

2. **指摘あり or 未解決:**
   - 該当する Developer（be-developer / fe-developer）を新規 fork し、`$WORK/prep/be-plan.md`（or `fe-plan.md`) + `$WORK/reviews/be-review.md`（or `fe-review.md`) の指摘 + 修正方針をプロンプトに含める
   - Developer: 修正計画を立案 → Manager に返す（★ まだ修正しない）
   - Manager → ユーザーに修正計画を提示 → 承認
   - 該当する Developer を新規 fork し、修正計画をプロンプトに含めて修正実行
   - Manager が受け入れゲート（Step 5 のコマンド）を再実行
   - Step 6 に戻る（最大3回。再レビューは baseline として前回結果パスを渡す解消チェックモード）

3. **3回で未解決の場合** → ユーザーに選択肢を提示:
   - a) 追加リトライ
   - b) 手動修正（未解決指摘一覧を提供）
   - c) タスク分割（スコープ縮小）
   - d) `docs/03_tasks/current-sprint.md` へ TODO 追記して持ち越し

---

### Step 8: エスカレーション処理（Manager が実行）

1. **推測仕様** → ユーザーに確認
2. **実装不可項目**:
   - ユーザー判断 a) 方針指示 → Developer に伝達
   - ユーザー判断 b) 後回し → `docs/03_tasks/current-sprint.md` へ TODO 追記 + 暫定実装指示
   - ユーザー判断 c) 保留 → TODO 追記のみ（暫定実装なし）
3. 必要に応じて新規 Developer を fork し、`$WORK/prep/be-plan.md`（or `fe-plan.md`) + 追加指示をプロンプトに含める

---

### Step 9: 設計書更新（Manager が確認・委譲）

> 常に実行。**「実装が終わったら設計書も更新する」はこのプロジェクトの必須ルール**（`manager-rules.md` §4）。

1. Developer の完了報告から「実装と設計書の差分」を集約する
2. 差分がある場合、該当する Developer を fork し `docs/02_design/` の該当設計書の更新を委譲する（更新内容はユーザーに提示して承認を得る）
3. 差分がない場合は「設計書更新なし」を完了報告に明記する

---

### Step 10: 完了報告 + インタラクティブモード（Manager が実行）

> 常に実行

以下をユーザーに報告する（target に応じて該当部分のみ）：

```markdown
## 実装完了: <タスクID / 機能名>
## 実行対象: <ALL|BE|FE>

====================================
■ 受け入れゲート（証拠付き）
====================================

| # | コマンド | 結果 |
|---|---------|------|
| 1 | npm test | PASS / FAIL（<テスト件数>） |
| 2 | npm run typecheck | PASS / FAIL |
| 3 | npm run lint | PASS / FAIL |

<失敗がある場合は実際の出力を引用>

====================================
■ BE 成果物（target = ALL or BE の場合）
====================================

#### 作成ファイル
- <層別一覧（domain / usecase / infra / handler / migrations / tests)>

====================================
■ FE 成果物（target = ALL or FE の場合）
====================================

#### 作成ファイル
- <一覧>

====================================
■ レビュー結果
====================================

#### サマリ
| # | 対象 | 指摘件数 |
|---|------|---------|
| 1 | BE | N件 |
| 2 | FE | N件 |

> 重要度区分なし。全件、担当者が確認・対応する前提。

#### 全指摘の詳細

(reviewer から受け取った全指摘を記載。軽微なものも省略しない。
各指摘: 指摘番号 / タイトル / ファイル:行 / 問題 / 修正案)

#### 推測仕様
- <N 件（確認済み / 未確認）>

====================================
■ ドキュメント整合
====================================

#### 設計書との矛盾
- <あれば記載>

#### 設計書更新（Step 9）
- <更新した設計書パス、または「更新なし」>

====================================
■ 残課題・次のステップ
====================================

- <残課題があれば記載（current-sprint.md へ追記した TODO 含む)>
- ログ保存先: <$WORK の絶対パス>
- コミットはユーザーが実行してください
```

**インタラクティブモード開始:**

`.claude/skills/_common/manager-rules.md` §8 に従い、選択肢 a/b/c/d/e を表示する。

---

## 再開フロー

中断検知・再開は `manager-rules.md` §7 参照。
再開時 Developer fork のプロンプトには `$WORK/prep/be-plan.md`（または `fe-plan.md`) + checkpoint の `resumeHint` + `git status` 結果をすべて含めること。