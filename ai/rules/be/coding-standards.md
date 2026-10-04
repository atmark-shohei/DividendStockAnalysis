# BE コーディング規約（src/ Worker 側）

対象: `src/` 配下（domain / usecase / infra / handler / lib）。TypeScript 5.9 / Hono 4 / Drizzle ORM 0.45 / Cloudflare Workers。

## 1. レイヤと依存方向

- 依存の向き: `handler → usecase → domain ← infra`（`.claude/rules/path-conventions.md` 参照）
- `eslint.config.mjs` の `no-restricted-imports` で機械的に強制。違反は `npm run lint` で落ちる
- **handler に計算・業務ロジックを書かない**（バリデーションと usecase 呼び出し、エラー変換のみ）
- **usecase から Drizzle を直接叩かない**（DB アクセスは infra 経由）
- domain は素の TypeScript。Hono / Drizzle / Workers API に依存しない

## 2. バリデーション（zod）

- zod は **handler 境界のみ** で使う。domain / usecase に zod スキーマを持ち込まない
- 外部から入るデータ（リクエスト、外部 API 取得結果）は永続化の前に必ずスキーマ検証する

## 3. エラー処理（Result パターン）

- **ドメイン層は throw しない**。`Result<T, E>` を返す:

  ```ts
  export type Result<T, E> =
    { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E };
  ```

- ドメインエラーは判別可能な `kind` を持つ（例: `{ kind: 'ScoreOutOfRange', value: 11 }`）
- handler が `kind` を見て HTTP ステータスと日本語文言に変換する。**ドメイン層に UI 文言を持たせない**
- API が返すエラーに内部情報（SQL・スタックトレース・パス）を含めない

## 4. 金額（Sen）

- **浮動小数点で金額計算をしない**。金額は銭単位の整数 `Sen`（branded type）で扱う。1円 = 100銭
- `Sen` の生成は `createSen()` / `senFromYen()` のみ。**`as Sen` のキャストをファクトリ外で書かない**
- DB の金額カラムは整数型。`FLOAT` / `REAL` を使わない

## 5. スコア（Score）

- `Score` は 0〜10 の整数の branded type。`createScore()` 経由のみで作る
- スコア区分は「下限以上・上限未満」で解釈する（端区分の開閉は `docs/02_design/logic/` の設計書で確認すること）

## 6. `null` と 0 の区別（このプロジェクトの中心要件）

- **判定不可能と 0 点は別物**。個別指標は `null` のまま画面へ渡す。0 に丸めてよいのは総合点の集計時だけ
- `MetricScore` の判別可能ユニオンで型が保証している:

  ```ts
  type MetricScore<R extends string = UnavailableReason> =
    | { readonly score: Score; readonly value: number; readonly unavailableReason: null }
    | { readonly score: null; readonly value: null; readonly unavailableReason: R };
  ```

  `score: 5` かつ `unavailableReason: 'input-missing'` のような矛盾した値は型エラーになる

- `UnavailableReason` は `'input-missing' | 'insufficient-history' | 'division-by-zero' | 'undefined-growth' | 'input-invalid' | 'value-out-of-band'`
- 型名・フィールド名の綴りは `docs/glossary.md` とリポジトリ実体に従うこと（勝手に「正しい英語」へ直さない）

## 7. 日時

- **UTC で保存し、表示層でのみ JST に変換する**。domain / infra に JST 変換を書かない

## 8. 外部データ

- 外部データは常に壊れている前提。永続化の前に必ずスキーマ検証する
  （欠損 / `null` / 単位違い〈円・千円・%・倍〉/ 桁ズレ〈株式分割の反映漏れ〉）
- 取得結果には必ず **`fetched_at`** を付けて保存する。古いデータを最新として表示しない
- 検証に落ちたデータは**捨てずに記録する**

## 9. 命名・その他

- 型名・関数名は `docs/glossary.md` の用語をそのまま使う
- マジックナンバー禁止（定数・branded type・判別ユニオンで表現）
- 実装と設計書（`docs/02_design/`）が食い違ったら、どちらが正しいかを確認してから修正する。実装が終わったら設計書も更新する
