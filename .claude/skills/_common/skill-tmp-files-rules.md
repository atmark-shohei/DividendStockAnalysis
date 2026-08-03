# スキル一時ファイル規約

スキル実行中に生成される一時ファイルの配置・命名・受け渡しルールの正本。
**読み手**: スキル実行に関わる全エージェント（Manager + サブエージェント）

---

## 1. 一時ディレクトリ（`$WORK`）

スキル実行ごとに、以下のディレクトリを作成する。

```text
tmp/<skill-name>/<YYYYMMDD_HHMMSS>_<実行者>/
```

- `<skill-name>`: ハイフン区切りのスキル ID（例: `implement`）
- `<YYYYMMDD_HHMMSS>`: スキル起動時刻（秒単位、衝突回避）
- `<実行者>`: `git config user.email` のローカル部（@ 前）。取得できなければ `unknown`
- `tmp/` はリポジトリ直下の **Git 管理外**ディレクトリ（`.gitignore` の `tmp/` に該当）。
  ローカルの振り返り・引き継ぎ用であり、コミットされない

スキル内ではこのパスを **`$WORK`** と呼ぶ。Manager は起動時に作成し、各サブエージェントの fork プロンプトに **絶対パスで** 含める。

### 1.1 $WORK 作成手順（Bash）

```bash
EXECUTOR=$(git config user.email)
EXECUTOR=${EXECUTOR%%@*}
[ -z "$EXECUTOR" ] && EXECUTOR=unknown
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
WORK_DIR="$(pwd)/tmp/implement/${TIMESTAMP}_${EXECUTOR}"
mkdir -p "$WORK_DIR"
echo "$WORK_DIR"
```

### 1.2 $WORK は「シェル変数」ではなく「文字列」として扱う

> **Bash ツールは呼び出しごとに環境変数・シェル変数がリセットされる**（永続するのは
> 作業ディレクトリのみ）。上の手順で作った `WORK_DIR` は、**次の Bash 呼び出しでは空になる**。
>
> `cat >> "$WORK/decisions.md"` のように未展開のまま書くと、`/decisions.md`
> （ドライブ直下）へ書き込もうとして作業ログが散逸する。

したがって:

1. `$WORK` の算出は bootstrap で **1 回だけ**行い、`echo` して絶対パスを確定させる
2. 確定した絶対パスを `checkpoint.json` に記録し、以降の Bash コマンド・fork プロンプトには
   **絶対パスを直書きする**
3. 本ドキュメント中の `$WORK` は「その絶対パスに置き換える」ことを意味するプレースホルダであり、
   コマンドにそのまま貼り付けてよい変数ではない

---

## 2. ファイル命名規約

| 種別 | 命名パターン | 用途 | 例 |
|------|------------|------|------|
| 計画 | `prep/<target>-plan.md` | 計画・引き継ぎサマリ | `prep/be-plan.md`, `prep/fe-plan.md` |
| インデックス | `prep/<target>-index.md` | コードベース調査結果 | `prep/be-index.md`, `prep/fe-index.md` |
| レビュー結果 | `reviews/<target>-review.md` | サブエージェントのレビュー成果 | `reviews/be-review.md`, `reviews/fe-review.md` |

`<target>` は `be` / `fe`。同一スキル実行内で同名ファイルは作らない（後発が上書きする事故防止）。

> **特殊ファイル（$WORK トップレベル）**:
> - `$WORK/checkpoint.json`: Manager 専用の進捗管理ファイル。サブエージェントは触らない
> - `$WORK/decisions.md`: Manager 専用のデシジョン + 修正ファイルログ。サブエージェントは触らない
>
> **$WORK トップレベルに置くファイルはこの 2 つのみ**。索引・計画は `prep/`、レビュー結果は `reviews/` に収める。

---

## 3. サブエージェントの Read / Write 規約

### Read（読み取り）

- Manager から指示された絶対パス以外の `$WORK` 配下ファイルを自発的に Read しない（責務分離のため）
- Manager から「`$WORK/<file>` を Read してから作業すること」と指示された場合は冒頭で Read する

### Write（書き込み）

- Manager から指定されたパスに **完全な内容を Write** する。partial write はしない
- Write 後、Manager に絶対パスを報告する
- ファイル名は §2 の命名規約に従う

### CWD 依存パスの禁止

- 相対パス（`./tmp/...`、`../docs/...`）は使わない。必ず Manager から渡された絶対パスを使う
- **正しい `$WORK` は必ず `/tmp/<skill-name>/<YYYYMMDD_HHMMSS>_<実行者>/` を含む絶対パスである**。これを満たさないパス（相対パス、`$WORK` という未展開の文字列そのもの、`.work/` 等の野良ディレクトリ）へは書き込まない
- 上記を満たさない `$WORK` を渡された場合は、**推測でフォールバックせず**、何も書かずに Manager へ差し戻して正しい絶対パスを求める

---

## 4. ライフサイクル

| タイミング | 動作 |
|-----------|------|
| スキル起動時 | `$WORK` 作成 + `checkpoint.json` / `decisions.md` 初期化（Manager 責務） |
| 各 Step 完了時 | サブエージェントが `$WORK/<file>` を Write、Manager が `checkpoint.json` 更新 + `decisions.md` 追記 |
| スキル中断時 | `$WORK` は保持。Manager が checkpoint + decisions に中断情報を記録 |
| スキル完了時 | `$WORK` は削除せず保持（完了報告で保存先を明示。振り返り・引き継ぎに使う） |