# エージェント / Skill 候補の調査結果

> 調査日: 2026-07-27
> 対象: [msitarzewski/agency-agents](https://github.com/msitarzewski/agency-agents) @ `main`
> （pushed 2026-07-23、MIT、fork でない、archived でない、全342ファイル）
>
> **2026-07-27: 推奨9体すべての導入が承認され、実施済み。**
> §1 の表と §6 を参照。`scripts/install.sh` は使わず、§4 の手順に沿って
> 1体ずつ変換して導入した。

## 0. 結論（先に読む）

1. **`scripts/install.sh` は使わない。** 一括導入すると 270 体が
   `~/.claude/agents/` にフラット展開され、既存の自作エージェントと
   識別子が衝突する（§3.1）。必要な .md を**1体ずつ手で写す**。
2. **どの .md も、写すときに frontmatter を書き換える必要がある。**
   270 体すべてが Claude Code でそのまま動かない形式（§3.2）。
3. **採用推奨は 9 体**（§1）。うち 2 体は既に導入済み。
   残り 261 体はこのプロジェクトには不要。
4. 危険なコード・秘密情報の窃取・外部送信・プロンプトインジェクションは
   **検出されなかった**（§3.4）。リスクは「悪意」ではなく
   **権限の広さと形式の不備**にある。

## 1. 採用推奨（9 体）

| 要件 | エージェント               | repo パス                                             | 役割                                                           |
| :--- | :------------------------- | :---------------------------------------------------- | :------------------------------------------------------------- |
| 全体 | Product Manager            | `product/product-manager.md`                          | ✅ **導入済**                                                  |
| 全体 | Feedback Synthesizer       | `product/product-feedback-synthesizer.md`             | ✅ **導入済**                                                  |
| A    | Software Architect         | `engineering/engineering-software-architect.md`       | ドメインモデル設計。銘柄・分析結果・ポートフォリオの境界を切る |
| B    | Identity & Access Engineer | `engineering/engineering-identity-access-engineer.md` | ユーザー登録・セッション設計。T-003/T-004 の判断材料           |
| C    | Data Engineer              | `engineering/engineering-data-engineer.md`            | 決算データ取り込み。冪等性・再取り込み・検証の設計             |
| D    | UX Architect               | `design/design-ux-architect.md`                       | 画面ごとの構造と CSS 基盤。S-08〜S-10 のタブ設計               |
| D    | Technical Writer           | `engineering/engineering-technical-writer.md`         | 設計書の継続管理。docs の陳腐化を防ぐ                          |
| E    | Minimal Change Engineer    | `engineering/engineering-minimal-change-engineer.md`  | 設計書1本＝差分1本。リファクタ雪崩を止める                     |
| F    | Reality Checker            | `testing/testing-reality-checker.md`                  | 「完了」の自己申告を却下する。既定値が NEEDS WORK              |

要件の記号は次のとおり。A=複数銘柄の分析情報の管理 / B=ユーザー登録と
ポートフォリオ / C=決算データの取り込み / D=画面ごとの設計書の継続管理 /
E=設計書ごとの実装 / F=設計書と実装のレビュー。

### 1.1 採らなかった主なもの と その理由

- **Backend Architect / Database Optimizer / Database Reliability Engineer（A）**
  — いずれも「スケーラブルなマイクロサービス」「PostgreSQL / PlanetScale の
  クエリ最適化」「自動フェイルオーバーと DR 訓練」を前提に書かれている。
  単一ユーザー・ローカル前提（T-002 未決）の本プロジェクトでは過剰で、
  **必要のない技術選定を持ち込む**。Software Architect は規模に依存しない。
- **Investment Researcher / Financial Analyst（C）** — 投資判断・銘柄推奨
  そのものを出力する設計。`CLAUDE.md` の「**投資判断そのものを自動化・
  推奨する機能は作らない**」に正面から反する。ドメイン用語の参考にはなるが、
  エージェントとしては入れない。
- **Code Reviewer（F）** — 既に自作の `code-reviewer` がある
  （`model: sonnet` / `tools: Read, Grep, Glob, Bash` の読み取り専用）。
  repo 版は 3 KB・`tools:` 未宣言で、**既存より劣る**。しかも §3.1 の
  識別子衝突の当事者。
- **Agents Orchestrator（G）** — description が「Autonomous pipeline
  manager … You are the leader of this process」。パイプライン全体を自律で
  回す前提で、`~/.claude/CLAUDE.md` の「破壊的操作は必ず事前確認」と
  相性が悪い。§3.3 参照。
- **Evidence Collector（F）** — Reality Checker と役割が重複する。
  スクリーンショット主体なので、UI を作り込む段階まで不要。

### 1.2 保留（要件が固まってから再評価）

| エージェント                                             | 保留を解く条件                                          |
| :------------------------------------------------------- | :------------------------------------------------------ |
| `engineering/engineering-privacy-engineer.md`            | ユーザー登録を実装し、個人データを保持すると決めたとき  |
| `engineering/engineering-data-visualization-engineer.md` | スコアの可視化を作る段階（Phase 4）                     |
| `testing/testing-test-automation-engineer.md`            | E2E（Playwright）を入れると決めたとき。現状 Vitest のみ |
| `design/design-ui-finish-gate-reviewer.md`               | UI の作り込みが始まったとき                             |
| `security/security-ai-generated-code-auditor.md`         | ローカル専用をやめて公開すると決めたとき（必須になる）  |
| `engineering/engineering-api-platform-engineer.md`       | 外部に API を公開すると決めたとき                       |

## 2. Skill 案

エージェントは「誰が考えるか」、Skill は「毎回同じ手順で何をするか」。
本プロジェクトで反復するのは**設計書と実装の対応付け**なので、
そこを Skill にする価値がいちばん高い。

| Skill 案            | 何をするか                                                                                                                      | 要件 | 元ネタ                                         |
| :------------------ | :------------------------------------------------------------------------------------------------------------------------------ | :--- | :--------------------------------------------- |
| `new-screen-spec`   | 画面 ID を受け取り `docs/02_design/ui/pages/<id>.md` を定型で起こす。`screen-list.md` に追記し、機能 ID（F-xx）と相互リンクする | D    | 自作                                           |
| `impl-from-spec`    | 設計書1本を受け取り、記載の受入基準をテストに落としてから実装する。設計書に無い変更を拒否する                                   | E    | Minimal Change Engineer の原則                 |
| `spec-impl-drift`   | `docs/02_design/**` と `src/**` を突き合わせ、設計書にあって実装に無いもの／その逆を列挙する                                    | D, F | 自作                                           |
| `review-spec`       | 設計書を受入基準の検証可能性でレビューする（「正しく動く」「きれいにする」を却下する）                                          | F    | Reality Checker + `workflow.md` の受入基準     |
| `import-financials` | 決算データ取り込みの手順を固定する。スキーマ検証 → `fetched_at` 付与 → 単位・桁チェック → 失敗データの記録                      | C    | `backend.md`「外部データは常に壊れている前提」 |
| `scoring-check`     | 10指標のスコア計算に境界値テストが揃っているか検査する（下限以上・上限未満、負値、無配、欠損の4系統）                           | A, F | T-007 の決定事項                               |

> 📌 上の6件は**すべて自作案**。agency-agents に Skill 形式のものは無い
> （リポジトリの中身はエージェント定義と、各ツール向けの変換・
> インストールスクリプトのみ）。Skill を書くなら
> `~/.claude/skills/skill-creator/` を使う。

## 3. セキュリティ所見

342 ファイル全件を取得し、23 パターンでスキャンした。

### 3.1 🔴 最大のリスク: `install.sh` のフラット展開と識別子衝突

`scripts/install.sh --tool claude-code` は該当 .md を
`~/.claude/agents/` に**そのままコピー（または `ln -sf`）**する。

```sh
# scripts/install.sh:256-258
install_file() {
  if $USE_LINK; then ln -sf "$1" "$2"; else cp "$1" "$2"; fi
}
```

- **既存ファイルの退避もバックアップも警告もない。**
- `ensure_converted()` は `claude-code` と `copilot` のみ**明示的に no-op**
  （`scripts/install.sh:300`）。つまり Claude Code 向けには変換が一切走らず、
  ソースの .md が素で入る。
- ファイル名の衝突はリポジトリ内では 0 件。だが **`name:` の衝突が3件**ある。
  Claude Code はエージェントを `name:` で識別するので、こちらが問題になる。

| 衝突する識別子         | repo 側                                    | 既存のローカル側                            |
| :--------------------- | :----------------------------------------- | :------------------------------------------ |
| `code-reviewer`        | `engineering/engineering-code-reviewer.md` | `code-reviewer.md`（自作・読み取り専用）    |
| `product-manager`      | `product/product-manager.md`               | `product-manager.md`（導入済・調整済）      |
| `feedback-synthesizer` | `product/product-feedback-synthesizer.md`  | `feedback-synthesizer.md`（導入済・調整済） |

ファイル名が違うので上書きは起きない。しかし**同じ識別子を主張する
エージェントが2つ並ぶ**状態になり、自作の読み取り専用 `code-reviewer` が
Bash 込みの全ツール継承版に置き換わりうる。

**対処: `install.sh` を実行しない。必要な .md を1体ずつ手で写す。**

### 3.2 🔴 270 体すべてが Claude Code でそのまま動かない

| 項目                            | 結果          |
| :------------------------------ | :------------ |
| frontmatter を持つ .md          | 270 / 292     |
| `name:` が kebab-case           | **0 / 270**   |
| `tools:` を宣言                 | **17 / 270**  |
| `tools:` 未宣言（全ツール継承） | **253 / 270** |
| `model:` を宣言                 | **0 / 292**   |

- `name:` は全て Title Case（`Product Manager`、`Identity & Access Engineer`、
  `SRE (Site Reliability Engineer)`）。`name` は `subagent_type` の識別子に
  なるため、**写すときに kebab-case へ直す**。導入済みの2体には既に
  この修正を入れてある。
- `tools:` 未宣言は「全ツール継承」を意味する。**Bash と Write を含む。**
  マーケティング系エージェントにシェルを渡す理由はない。
  写すときに必ず `tools:` を明示する。
- リポジトリの CI（`scripts/lint-agents.sh:34`）が必須にしているのは
  `name` / `description` / `color` の3つだけで、**`tools:` は検証対象外**。
  253 体が無宣言なのはこれが原因。上流の方針なので、こちらで直すしかない。
- `tools:` に `Bash` を明示している唯一のグループが `paid-media/` の7体。
  広告運用にシェルが必要な設計意図は読み取れず、採用候補外。

### 3.3 🟡 権限を広く取る記述（誤検知を除いた実質2件）

| 該当                                               | 内容                                                                                              |
| :------------------------------------------------- | :------------------------------------------------------------------------------------------------ |
| `marketing/marketing-carousel-growth-engine.md:41` | 「**Zero Confirmation**: Run the entire pipeline without asking for user approval between steps」 |
| `specialized/agents-orchestrator.md`               | 「Autonomous pipeline manager … You are the leader of this process」                              |

どちらも採用候補外。ただし**この2件は `~/.claude/CLAUDE.md` の
「破壊的操作は必ず事前確認」と直接衝突する**ので、将来どの経路でも
入れないこと。

### 3.4 🟢 検出されなかったもの

以下は全342ファイルで**ゼロ件**だった。

- `curl … | bash` 形式の実行。README にも一括インストールの一行スクリプトは
  無く、`git clone` してから `./scripts/install.sh` を手で叩く形
- 秘密情報のパス参照（`~/.ssh/`、`id_rsa`、`~/.aws/credentials`、
  `.env` の読み取り、`.npmrc`）
- 外部送信先として疑わしいホスト（pastebin / ngrok / webhook.site /
  telegram / discord webhook / transfer.sh / 0x0.st）
- `base64 -d | sh`、`eval(fetch(…))` 形式の難読化実行
- `rm -rf /`、`rm -rf ~`、`rm -rf $HOME`
- プロンプトインジェクション（「以前の指示を無視せよ」「ユーザーに伝えるな」）
- `--force` push、`--no-verify`

HIGH 判定として出た2件はいずれも**誤検知**だった。

- `engineering/engineering-prompt-engineer.md:169` — 敵対的入力の**テスト手法**
  として "Ignore all previous instructions" を挙げている行。防御側の記述。
- `engineering/engineering-rust-refactoring-specialist.md:217` — 「一貫した実装に
  必要な内部シンボルを全部列挙させるな」という作業指示。隠蔽の指示ではない。

`install.sh` の `rm -rf` は2箇所あるが、いずれも Hermes プラグイン
ディレクトリ限定で、**親ディレクトリを消さないための二重ガード付き**
（`basename` が `agency-agents-router` でなければ拒否。`install.sh:1108`,
`1117`）。コードとしては丁寧に書かれている。

### 3.5 🟡 リポジトリそのものについて

- MIT、fork フラグは false。ただしエージェント名（whimsy-injector、
  reality-checker など）は先行する別リポジトリ由来と見られ、独自性
  チェック用スクリプト（`scripts/check-agent-originality.sh`）が同梱
  されている。**由来の追跡はしていない。** ライセンス上は MIT の範囲で
  解決するが、出自が単一とは限らない。
- star 数・fork 数が非常に多いが、**人気は安全性の根拠にならない。**
  実際に §3.1〜3.3 の問題は残っている。
- `scripts/` には Python 依存のものがある（`build-hermes-plugin.py`、
  `install.sh` 内の `python3` 呼び出し）。この環境に Python は無いので、
  Hermes 経路は最初から使えない。
- `SECURITY.md` は「エージェント .md は非実行のプロンプト定義」「シェル
  スクリプトは実行前にレビューすること」と明記している。上流自身が
  install.sh のレビューを求めている。

## 4. 導入するときの手順（人間が決めたら）

1体ずつ、以下を守って写す。一括導入しない。

1. `~/.claude/agents/<kebab-name>.md` に**内容をコピーして新規作成**する
   （`install.sh` を使わない。シンボリックリンクにしない）
2. `name:` を kebab-case に直す
   （例: `Identity & Access Engineer` → `identity-access-engineer`）
3. `tools:` を**明示的に書く**。既定は読み取り専用にする
   - 設計・レビュー系 → `Read, Grep, Glob`
   - 実装系 → `Read, Grep, Glob, Write, Edit`
   - `Bash` は、テスト実行が役割に含まれる場合だけ
4. `model:` を書く（重い調査は `sonnet`、単純な照合は `haiku`）
5. 既存の `~/.claude/agents/*.md` と `name:` が衝突しないか確認する（§3.1）
6. 本文に本プロジェクトの制約を追記する
   - 金額は銭単位の整数。浮動小数点を使わない
   - 無配（0）とデータ欠損（`null`）を区別する
   - 投資判断そのものを推奨する出力を作らない
7. `/agents` で実際に一覧に出るか確認する。出なければ frontmatter を疑う

## 6. 導入結果（2026-07-27）

### 6.1 導入したエージェント（7体）

`~/.claude/agents/` に、§4 の手順どおり1体ずつ変換して配置した。
既存ファイルがあれば中断する設計にしてあり、上書きは発生していない。

| name                       | model  | tools                                 |
| :------------------------- | :----- | :------------------------------------ |
| `software-architect`       | opus   | `Read, Grep, Glob, Write, Edit`       |
| `identity-access-engineer` | opus   | `Read, Grep, Glob, Write, Edit`       |
| `data-engineer`            | opus   | `Read, Grep, Glob, Write, Edit`       |
| `ux-architect`             | sonnet | `Read, Grep, Glob, Write, Edit`       |
| `technical-writer`         | sonnet | `Read, Grep, Glob, Write, Edit`       |
| `minimal-change-engineer`  | opus   | `Read, Grep, Glob, Write, Edit, Bash` |
| `reality-checker`          | sonnet | `Read, Grep, Glob, Bash`              |

上流からの変更点。

- `name:` を kebab-case に変換（上流は全て Title Case）
- `tools:` を明示（上流は未宣言 ＝ Bash 込みの全ツール継承）
- `model:` を追加（上流は全て未指定）
- 本文末尾にプロジェクト固有の制約を追記
  （銭単位整数 / 無配と `null` の区別 / UTC 保存 / `fetched_at` /
  投資判断を推奨しない / 破壊的操作は事前確認）＋ 役割ごとの個別指示

`reality-checker` にだけ `Write` / `Edit` を渡していない。判定の独立性が
この役割の存在意義で、自分で直せると独立性が消えるため。

### 6.2 作成した Skill（8本）

`.claude/skills/<name>/SKILL.md`。§2 の6案に2本追加した。

- `decide-auth` — `identity-access-engineer` を使う手順が無かったため
- `new-logic-spec` — 設計書を**新規作成**する手順が画面（`new-screen-spec`）
  にしか無く、`src/lib/` に入る計算ロジックの設計書を起こす経路が
  抜けていたため

| Skill               | 使うエージェント                                                             |
| :------------------ | :--------------------------------------------------------------------------- |
| `new-screen-spec`   | ux-architect → technical-writer                                              |
| `new-logic-spec`    | software-architect → technical-writer → reality-checker                      |
| `impl-from-spec`    | minimal-change-engineer → code-reviewer → reality-checker → technical-writer |
| `review-spec`       | software-architect ＋ reality-checker → technical-writer                     |
| `spec-impl-drift`   | repo-explorer ×2 → reality-checker                                           |
| `import-financials` | data-engineer → minimal-change-engineer → reality-checker                    |
| `scoring-check`     | repo-explorer → reality-checker                                              |
| `decide-auth`       | identity-access-engineer → software-architect → technical-writer             |

設計思想は共通で3点。

1. **書く役と判定する役を分ける。** レビュー担当（reality-checker /
   code-reviewer）は `Write` / `Edit` を持たない。
2. **文書化の窓口を technical-writer 1箇所に閉じる。** 書式が揺れないため。
3. **未決事項に触れたら止まる。** T-002（DB）/ T-003・T-004（認証）を
   前提にした実装や設計を、エージェントに勝手に確定させない。

### 6.3 未使用のエージェント

`product-manager` / `feedback-synthesizer` / `test-runner` はどの Skill
からも呼んでいない。直接呼び出して使う想定で、手順に組み込む必然性が
現時点で無いため。

## 7. 未解決

- 設計書の**新規作成**手順は画面（`new-screen-spec`）とロジック
  （`new-logic-spec`）の2領域だけ。API（`docs/02_design/api/`）と
  DB（`docs/02_design/database/`）は T-002 / T-003・T-004 が未決のため
  保留。決まってから作る
- §2 の Skill 8本のうち、どれから実運用に乗せるか
- 保留6体（§1.2）はそれぞれの条件が満たされた時点で再評価する
- `decide-auth` を実行して T-003 / T-004 を決着させる（現在 🔴）
