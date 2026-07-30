# IRバンク JSON 取り込み 仕様書

> 決定: [ADR-0007](../../adr/0007-irbank-json-direct-fetch.md)（T-001 の再決定）
> 実測サンプル: `tmp/irbank-samples/`（9433 / 8306 / 7203 / 1301、2026-07-28 取得）
> ステータス: 🟢 **実装済み**（2026-07-29）。`/review-spec`（2026-07-28）で
> 指摘された2点（§5.3 の株式分割検知、`CompanyForm.tsx` の自動テスト）を
> `impl-from-spec`（2026-07-29）で解消した。残るのは §8 の未決事項のみ

## 1. 概要

IRバンクが公開する銘柄別の静的 JSON を取り込み、`AnalyzeCompanyRequest`
（`src/handler/dto/company-input.ts`）と同じ形に正規化する。

**この取り込みは保存しない。** 取り込んだ結果は「入力フォームの初期値」として
返すだけで、確定は従来どおりユーザーが行う。埋まらない項目（§6）を人が補完してから
保存する必要があるため。

```
GET https://f.irbank.net/files/{code}/fy-data-all.json
```

## 2. 入出力

### 2.1. レスポンスの構造

4ブロック（`業績` / `財務` / `CF` / `配当`）。各ブロックは同じ形をとる。

```jsonc
{
  "業績": {
    "meta": {
      "code": "9433",
      "type": "業績",
      "item": { "年度": ["売上高", "営業利益", "経常利益", "純利益", "EPS", "ROE", "ROA"] },
    },
    "item": {
      "2026/03": [6071915000000, 1099125000000, "-", 707112000000, 183.59, 13.93, 3.71],
      "2027/03": { "0": "-", "4": 230.18, "5": 7.52, "6": 2.84, "備考": "予想" },
    },
  },
}
```

- `meta.item.年度` が**列名の配列**。列順を実装側で決め打ちしない。この配列を引く
- `item` のキーは決算期（`YYYY/MM`）。値は列名と同じ並びの配列
- 4銘柄すべてで列構成は一致していた

### 2.2. 列と単位（実測）

| ブロック | 列                                                                | 単位                    |
| :------- | :---------------------------------------------------------------- | :---------------------- |
| 業績     | 売上高 / 営業利益 / 経常利益 / 純利益                             | **円**（生値）          |
| 業績     | EPS                                                               | 円・小数2桁まで         |
| 業績     | ROE / ROA                                                         | %                       |
| 財務     | 総資産 / 純資産 / 株主資本 / 利益剰余金 / 短期借入金 / 長期借入金 | **円**（生値）          |
| 財務     | BPS                                                               | 円・小数2桁まで         |
| 財務     | 自己資本比率                                                      | %                       |
| CF       | 営業CF / 投資CF / 財務CF / 設備投資 / 現金同等物                  | **円**（生値）          |
| CF       | 営業CFマージン                                                    | %                       |
| 配当     | 一株配当                                                          | 円・小数1桁まで（実測） |
| 配当     | 剰余金の配当 / 自社株買い                                         | **円**（生値）          |
| 配当     | 配当性向 / 総還元性向 / 純資産配当率                              | %                       |

**千円・百万円単位は現れない。** NTT(9433) の売上高 5,446,708,000,000 が
実額（5.4兆円）と一致することで確認した。単位変換は不要。

### 2.3. 使う列

今回の取り込みで実際に読む列は以下だけ。他は無視する（将来のために構造は残す）。

| 取り込み先（DTO）                  | 出所                                                         |
| :--------------------------------- | :----------------------------------------------------------- |
| `records[].epsSen`                 | 業績.EPS                                                     |
| `records[].roePercent`             | 業績.ROE                                                     |
| `records[].revenueSen`             | 業績.売上高                                                  |
| `records[].operatingMarginPercent` | 業績.営業利益 ÷ 業績.売上高（§3.5）                          |
| `dividends[].annualAmountSen`      | 配当.一株配当                                                |
| `multiples.pbr`                    | 財務.BPS（実績）と株価から算出（§3.5）                       |
| `multiples.per`                    | 業績.EPS（**予想優先**・無ければ実績）と株価から算出（§3.5） |

`balanceSheet`（⑥ が使う流動資産・投資有価証券・負債総額・前期末配当総額）に
対応する列は**この JSON に無い**。§6 参照。

> ✅ **2026-07-31 訂正。** 以前は `records[].dividendPerShareSen` にも
> 同じ値を積んでいたが削除した（[ADR-0009](../../adr/0009-dividend-single-source.md)）。
> **1株配当は `dividends[]` にのみ載る。** ①②③はいずれも `dividends` を読む。

## 3. 正規化ロジック

### 3.1. 値の型が揺れる（最重要）

**同じ列でも年度によって `number` / 数値文字列 / `"-"` の3種が混在する。**
4銘柄・6列で実測した。

| 列              | number | `"-"` | 数値文字列 | 実例                            |
| :-------------- | -----: | ----: | ---------: | :------------------------------ |
| 業績.営業利益   |      9 |     7 |          4 | 7203 2023/03 `"2725025000000"`  |
| 財務.利益剰余金 |     11 |     0 |          9 | 8306 2022/03 `"11998157000000"` |
| 財務.株主資本   |     14 |     0 |          6 | 8306 2023/03 `"14749310000000"` |
| 財務.純資産     |     18 |     0 |          2 | 7203 2022/03 `"27154820000000"` |
| 財務.短期借入金 |      7 |    10 |          3 | 1301 2022/03 `"15714000000"`    |
| 財務.長期借入金 |      7 |    10 |          3 | 1301 2022/03 `"27021000000"`    |

規則性は掴めていない（同一銘柄の同一列で、古い年度が文字列・新しい年度が数値に
なる例が多いが、7203 の営業利益は 2023〜2024 が文字列で 2025 以降が数値）。

**したがって全列で3種すべてを受け入れる。** 特定の列だけ `typeof === 'number'` を
前提にした実装は、別の銘柄で必ず落ちる。

- `number` → そのまま
- `"-"` → `null`（**判定不能**。0 ではない）
- `/^-?\d+(\.\d+)?$/` に一致する文字列 → 数値として採用（銭化は §3.4）
- 上記以外の文字列 → `null` にし、**診断に記録**（§5.2）

### 3.2. 年度キー

- 形式は `^\d{4}/\d{2}$`。**先頭4桁を `fiscalYear` にする**（`2026/03` → `2026`）
  - `FinancialRecord.fiscalYear` の定義「2024年3月期なら 2024」（`src/domain/company/company.ts:20`）と一致する
- 範囲は 1900〜2200（DTO の `financialRecordInput` と揃える）。外れたら除外して記録
- 4銘柄はすべて3月期だった。**他の決算月は未確認**
- 決算期変更で**同一 `fiscalYear` が2行**になる可能性がある。重複を検出したら
  後勝ちにせず、**両方を除外して記録**する。どちらが正か機械的に決められない

### 3.3. 予想行の判別

**予想年度だけ配列ではなくオブジェクトで来る。**

```jsonc
"2027/03": { "0": 84, "1": "-", "2": "-", "3": "-", "4": "-", "5": "-", "備考": "予想" }
```

- `Array.isArray(row)` で分岐する。オブジェクトの場合は `row[String(index)]` で引く
- `備考 === "予想"` → `isForecast: true` / `kind: 'forecast'`
- `備考` が無い（配列） → `isForecast: false` / `kind: 'actual'`
- **`備考` が `"予想"` 以外の値** → その年度を**系列から除外し、診断に記録**する。
  素性の分からない年を平均や CAGR に混ぜると投資判断が変わる。§0.5 の
  「欠損は判定不能」に寄せるほうが安全
  - 実測では `"予想"` 以外は観測されていない。観測されたら仕様を更新すること
- **`'revised'`（修正）は JSON からは判別できない。** IRバンクは修正を別行にしない。
  `kind: 'revised'` を生成する経路は無い

### 3.4. 銭への変換

金額（EPS / BPS / 一株配当 / 売上高）は**銭単位の整数**にする（`CLAUDE.md`）。

- **数値文字列で来た値は、文字列のまま小数点をずらす。** `parseFloat` を経由しない
  （`import-financials/SKILL.md:95`）
- **`number` で来た値は `Math.round(value * 100)`。** JSON.parse が既に double に
  しているため文字列に戻す手段が無い。実測した小数桁は EPS・BPS が2桁、
  一株配当が1桁で、この範囲では `Math.round` の結果は厳密に正しい
- 小数第3位以下が現れた場合は四捨五入し、**丸めが起きたことを診断に記録**する
- 変換後に `Number.isSafeInteger` を検査する。偽なら `null` にして記録

> **不変条件: 2経路は同値を返す。** 同じ実数値が `number`（例: `150.01`）で
> 来ても数値文字列（例: `"150.01"`）で来ても、変換後の銭は一致する
> （`tests/infra/irbank/parse-fy-data.test.ts` の「数値文字列と number が
> 同じ銭になる」で固定）。2経路を持たせているのはコードの都合ではなく、
> **IRバンク側の応答が実際にこの2種を混在させてくる**ため（§3.1）。

> **オーバーフローの上限（実測に基づく）**
>
> `Number.MAX_SAFE_INTEGER` は 9,007,199,254,740,991（≈9.007e15）。
> 銭化すると **90兆円を超える金額が扱えなくなる**。
>
> - 売上高の最大は 7203 の 50.7兆円 → 5.07e15 銭。**安全**（余裕は約1.8倍）
> - 一方 8306 の総資産 431.7兆円は 4.32e16 銭で**上限を超える**。
>   総資産は §2.3 のとおり今回使わないため踏まないが、⑥ で
>   「負債総額 = 総資産 − 純資産」を JSON から算出しようとすると銀行で必ず壊れる
>
> ⑥ を JSON 化する段で `BigInt` か円単位かを決めること（未決、§8）。

### 3.5. 派生値

JSON に列が無いので算出するもの。**算出はすべて `src/domain/company/` の
純粋関数が担う**（2026-07-29、§8-9 で統一済み）。取り込み層（infra）は
これらの関数を呼ぶだけで、計算式そのものは持たない。

| 項目          | 式                                          | 算出関数                                                | 備考                                                              |
| :------------ | :------------------------------------------ | :------------------------------------------------------ | :---------------------------------------------------------------- |
| 営業利益率(%) | 営業利益 ÷ 売上高 × 100                     | `operating-margin.ts` の `deriveOperatingMarginPercent` | どちらかが `null` なら `null`。売上高 ≤ 0 なら `null`（ゼロ除算） |
| PER(倍)       | 株価 ÷ **予想EPS**（無ければ実績EPSで代用） | `market-multiples.ts` の `deriveMarketMultiples`        | 株価は手入力。EPS ≤ 0 なら `null`。§2.3 参照                      |
| PBR(倍)       | 株価 ÷ 最新実績BPS                          | 同上                                                    | 同上。BPS ≤ 0 なら `null`                                         |

- 営業利益率を算出するのは、`FinancialRecord.operatingMarginPercent` の
  定義が「**CSV に列があれば**こちらを使う」（`src/domain/company/company.ts:29`）で
  あり、列が無い経路では算出が前提になっているため。スコア判定そのものは
  ドメイン（`calculateOperatingMargin`）に残る（採点前の生の事実の導出と、
  採点そのものは別の関数・別の関心事）
- **PER は予想EPSを優先する。** 2026-07-29 決定（[ADR-0008](../../adr/0008-frontend-domain-runtime-import.md)
  「未解決のまま残すこと」の解消）。「会社予想PER」を名乗る以上、業績ブロックに
  予想行がある銘柄（7203/1301 型）ではそちらを使う。無い銘柄（9433/8306 型）だけ
  実績EPSで代用し、`perSource` に `'forecast-eps'` / `'actual-eps'` を記録する
- PER / PBR は**株価が未入力なら `null`**。株価が入るまで ⑨ は判定不能でよい
- **配当性向は算出しない。** JSON の `配当性向` 列は4銘柄すべて `"-"` だったが、
  ③ はドメイン（`calculatePayoutRatio`）が予想配当と予想EPSから出す。ここで
  二重に計算しない

### 3.6. 並び順

`toCompany()`（`src/handler/dto/company-input.ts:83`）が年度降順に並べ替える。
**取り込み層では並べ替えない。** 並べ替えを2箇所でやるとどちらが正か分からなくなる。

## 4. 取得（fetch）

- タイムアウト **5秒**。`AbortSignal.timeout()` を使う
- リトライは **1回だけ**（1秒待機）。無限リトライしない（`.claude/rules/backend.md`）
- レスポンスは `Content-Encoding: br` 固定。Workers の `fetch` は自動で解凍する
  （curl でサンプルを取り直すときは `--compressed` が要る）
- 存在しない銘柄は **302**（HTML へリダイレクト）、不正なパスは **404**。
  `Content-Type` が `application/json` でなければ `not-found` として扱う
- `meta.code` と要求した銘柄コードの**一致を検査**する。不一致は取り込まない
- レスポンスヘッダに `Cache-Control: max-age=86400` / `ETag` / `Last-Modified` が
  付いている。Cloudflare のキャッシュに素直に乗せてよい
- **`fetched_at` はサーバー側の現在時刻**（`dependencies.now()`）を付ける。
  `Last-Modified` ではない。「いつ取り込んだか」が要る（`CLAUDE.md`）

## 5. 検証と例外処理

### 5.1. エラー種別

`Result<T, E>` で返す。`kind` で判別する（`.claude/CLAUDE.md`）。

| kind                 | 発生条件                                            | HTTP |
| :------------------- | :-------------------------------------------------- | ---: |
| `invalid-code`       | 銘柄コードが4文字形式でない（外部へ問い合わせない） |  400 |
| `source-not-found`   | 3xx / 404 / `Content-Type` が JSON でない           |  404 |
| `source-unreachable` | ネットワーク失敗・タイムアウト・5xx（リトライ後）   |  502 |
| `malformed-response` | `JSON.parse` が失敗                                 |  502 |
| `unexpected-shape`   | ブロック欠落・`meta.item.年度` が配列でない         |  502 |
| `code-mismatch`      | `meta.code` が要求と違う                            |  502 |
| `no-usable-year`     | 検証を通った年度が1件も無い                         |  422 |

リトライするのは `source-unreachable` に至る系統（通信失敗・タイムアウト・5xx）だけ。
**404 と 3xx はリトライしない**（何度試しても無い）。

内部情報（URL・スタックトレース）を API のエラー本文に含めない
（`.claude/rules/backend.md`）。

### 5.2. 診断（捨てずに記録する）

**検証に落ちた行・値は捨てずに記録する**（`import-financials/SKILL.md`）。
取り込み結果に診断を同梱し、画面に「読めなかったもの」を出せるようにする。

```ts
interface ImportDiagnostic {
  readonly block: string; // '業績' 等
  readonly fiscalYearKey: string; // '2026/03'
  readonly column: string; // '営業利益'
  readonly reason:
    | 'unparsable-value' // 数値として読めない文字列
    | 'unsafe-integer' // 銭化で MAX_SAFE_INTEGER 超過
    | 'rounded' // 小数第3位以下を丸めた
    | 'year-out-of-range'
    | 'duplicate-year'
    | 'unknown-note' // 備考が '予想' 以外
    | 'suspicious-jump'; // 前年比が ±80% を超えた（株式分割の反映漏れを疑う。§5.3）
  readonly raw: string; // 元の値（そのまま）
}
```

### 5.3. 検証項目（スキルの必須表）

| 検証                     | 本仕様での扱い                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| :----------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 必須フィールドの欠損     | `"-"` → `null`。**0 と区別する**。診断には出さない（正常な欠損）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 単位（円/千円/百万円）   | **不要**。すべて円の生値であることを4銘柄で確認済み（§2.2）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 桁（株式分割の反映漏れ） | ✅ 2026-07-29 実装（`impl-from-spec` の code-reviewer 指摘で1点修正）。一株配当・EPS の**暦年で1年差の直前レコード**比が **±80% を厳密に超えたら**（ちょうど80%は含まない）`reason: 'suspicious-jump'` を記録。**除外はしない**（値はそのまま採用）。前年が `null` または `0` なら比較不能なので記録しない。**`records` は業績と配当の年度の和集合で、決算期変更等により暦年が飛ぶことがある**（§3.2）。配列上隣り合っていても暦年で1年差でなければ比較しない（`src/infra/irbank/parse-fy-data.ts` の `recordSuspiciousJump`。ガードが無いと複数年の複利成長を1年分の急変と誤検出する） |
| 日付                     | 年度キーの形式と 1900〜2200 の範囲を検査（§3.2）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 全角数字の混入           | **不要**。JSON の数値・数値文字列に全角は現れない（手入力経路のみ）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 銘柄コードの形式         | `^\d{3}[0-9A-Z]$`。加えて `meta.code` との一致を検査（§4）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

> 全角正規化を「不要」と書いているのは、この経路に限った話。
> 手入力フォーム（`CompanyForm.tsx`）の正規化は従来どおり必要。

## 6. 何が埋まり、何が埋まらないか

**⚠️ 当初の見積もり（③⑤⑧⑨⑩ の5指標が埋まる）は誤りだった。**
`takeCompleteYears`（`src/domain/scoring/series.ts`）が**実績5年分**を要求し、
`seriesOf` が予想を除外する（`src/usecase/score-company.ts:46`）ため、
実績が4期しかない銘柄では ⑤⑧ が `insufficient-history` になる。

### 6.1. 銘柄によって業績ブロックの中身が違う

| 銘柄 | 業績ブロック        | 配当ブロック   |
| :--- | :------------------ | :------------- |
| 9433 | 実績5期（予想なし） | 実績4期＋予想1 |
| 8306 | 実績5期（予想なし） | 実績4期＋予想1 |
| 7203 | 実績4期＋**予想1**  | 実績4期＋予想1 |
| 1301 | 実績4期＋**予想1**  | 実績4期＋予想1 |

**業績ブロックは常に5行**で、そこに予想が入るかは決算発表のタイミングで決まる。

### 6.2. 指標別カバレッジ

| 指標             | 必要                    | 9433 | 8306 | 7203 | 1301 | 理由                            |
| :--------------- | :---------------------- | :--: | :--: | :--: | :--: | :------------------------------ |
| ⑨ MIX係数        | EPS・BPS＋株価          |  ✅  |  ✅  |  ✅  |  ✅  | 株価は手入力                    |
| ⑩ 配当利回り     | 予想配当＋株価          |  ✅  |  ✅  |  ✅  |  ✅  | 同上                            |
| ③ 予想配当性向   | 予想EPS＋予想配当       |  ❌  |  ❌  |  ✅  |  ✅  | 業績に予想行が無いと出ない      |
| ⑤ ROE平均        | **実績5期**の ROE       |  ✅  |  ✅  |  ❌  |  ❌  | 実績4期では足りない             |
| ⑧ 営業利益率     | **実績5期**の営業利益率 |  ✅  |  ❌  |  ❌  |  ❌  | 8306 は営業利益が `"-"`         |
| ① 増配率         | 配当6期                 |  ❌  |  ❌  |  ❌  |  ❌  | 配当は実績4期                   |
| ② 連続非減配年数 | 最大18期                |  ❌  |  ❌  |  ❌  |  ❌  | 同上（最大3年しか数えられない） |
| ④ EPS CAGR       | 実績6期                 |  ❌  |  ❌  |  ❌  |  ❌  | 5期止まり                       |
| ⑦ 売上CAGR       | 実績6期                 |  ❌  |  ❌  |  ❌  |  ❌  | 同上                            |

**③ と ⑤⑧ は同時に埋まらない。** 業績ブロックが実績5期の銘柄は ⑤⑧ が埋まって
③ が空になり、実績4期＋予想1の銘柄はその逆になる。

> 📌 **2026-07-30 追記。①②⑨⑩ はこの経路の外で埋まる見込み。**
> [market-data-source.md](./market-data-source.md) で、株価・**配当履歴21〜28年ぶん**が
> 別経路（Yahoo Finance）で取れることを実データで確認した。①② はこの表では
> 全銘柄 ❌ だが、その経路が入れば埋まる（②は現状どうやっても埋まらない指標）。
> **④⑦ は変わらず埋まらない**（EPS・売上高はその経路にも無い）。
> 本設計書の守備範囲＝財務諸表であることは変わらない。

### 6.3. それでも取り込む価値

指標の充足ではなく、**手入力の量**で見る。

- 年度別テーブル 4〜5行 × 5列（EPS・ROE・売上高・営業利益率・一株配当）が自動で埋まる
- **PER / PBR の入力欄が不要になる**（株価から算出）
- 予想配当が自動で入る

残る手入力は **株価**、**⑥ の貸借対照表4項目**、および ①②④⑦ が要求する
**6期以上前の古い年度**。

## 7. 受入基準

> ✅ **2026-07-29 更新。** §7.2 は `/review-spec`（2026-07-28）の指摘を受けて
> 手動確認のみと訂正していたが、`impl-from-spec`（2026-07-29）で
> `frontend/components/CompanyForm.tsx` の対象関数を純粋関数として export し、
> `tests/frontend/company-form.test.tsx` を追加したことで自動テスト化した。
> §7.2 は廃止し、§7.1 に統合する。

### 7.1 自動テストで検証済み（`npm test` で毎回確認できる）

- ✅ `npm test` / `npm run typecheck` / `npm run lint` が exit 0
- ✅ サンプル4銘柄それぞれにテストがある（fixture は `tests/fixtures/irbank/` に
  実物を置く。手書きの理想形を作らない）
- ✅ **7203**: 業績と財務で年度レンジがずれる（業績 2023〜2027 / 財務 2022〜2026）。
  添字ではなく年度キーで突き合わせていることを検証する
- ✅ **8306**: 営業利益が全年 `"-"` → `operatingMarginPercent` が全年 `null`
- ✅ **7203 / 1301**: 営業利益が数値文字列の年と `number` の年が混在 → 同じ値になる
- ✅ 予想行（オブジェクト形式）から `isForecast: true` / `kind: 'forecast'` が立つ
- ✅ `"-"` が `null` になり、**一株配当 0 円と区別される**
- ✅ 銭化が整数で、`Number.isSafeInteger` を満たす
- ✅ `fetchedAt` が付く
- ✅ 診断（§5.2）が `unparsable-value` / `duplicate-year` / `unknown-note` /
  `suspicious-jump` の4系統それぞれで生成される
- ✅ `source-not-found`（302 を返す存在しない銘柄）が例外にならず `Result` で返る
- ✅ `GET /api/irbank/:code` が保存を一切行わない（フォームの初期値を返すだけ）
- ✅ エラー種別ごとに正しい HTTP ステータスを返す（§5.1 の表どおり）
- ✅ 除算由来の値（営業利益率・PER・PBR）が編集欄で小数第2位に丸まる
  （`tests/frontend/format.test.ts` で固定。生の浮動小数点誤差を編集欄に
  そのまま出さない）
- ✅ 一株配当・EPS の前年比が ±80% を**厳密に超えたら** `suspicious-jump` を
  記録する。ちょうど80%・前年が `null`・前年が `0` はいずれも記録しない。
  記録しても値は `null` にならず採用される（`tests/infra/irbank/parse-fy-data.test.ts`）
- ✅ `buildRowsFromImport`: 実績が4期しかなくても予想1行＋実績6行の既定構成を保ち、
  取り込めなかった古い年度は空行のまま残る。範囲外の古い年度は末尾に追加される
  （`tests/frontend/company-form.test.tsx`）
- ✅ `fillBlankMultiples`: 株価入力済みで PER/PBR が空欄のときだけ EPS/BPS から
  算出した値で埋める。**既に入力済みの値は上書きしない**（同上）

## 8. 未決事項

1. **⑥ の金額表現は「将来の課題」ではなく現在の制約。**
   （🔴 2026-07-29 訂正。`/review-spec` 指摘）
   ⑥（配当維持可能年数）は既に実装済みで、`balanceSheet` は**手入力から**
   銭の整数で受けている（`src/handler/dto/company-input.ts` の
   `senValue = z.number().int().safe()`）。銀行の総資産・負債総額は銭化すると
   `MAX_SAFE_INTEGER`（≈9.007e15、円換算で約90兆円）を超えるため、
   **メガバンクの実在の総資産は今日、手入力でも 400 で拒否される**
   （8306 の総資産 431.7兆円 → 4.32e16 銭で超過。§3.4 参照）。
   データが壊れるわけではなく明示的な拒否だが、**実在する会社を正しく
   入力できない**という実害が既にある。IRバンク経由かどうかに関わらない。
   `BigInt` か円単位かの決定は依然未定。**今回は直さない**（金額の型を
   変える影響範囲が ⑥ 単体に留まらないため）が、「JSON 化するときに決める」
   という先送りの書き方は誤りだったので訂正した
2. **⑧ の金融業（🟡 T-014 決定5 の保留）** — 8306 は営業利益が `"-"` だが
   **経常利益は取れている**（2026/03 = 3,410,192,000,000）。
   保留していた案 (a)「営業利益が欠損していて経常利益があれば経常利益率で代用」が
   **業種マスタ無しで実装可能だと実データで確認できた**。この取り込みが入ると
   金融株が実際に流れてくるので、そのタイミングで決着させる
3. **決算月が3月以外の銘柄** — 4銘柄すべて3月期だった。12月期・9月期の実物で
   年度キーの形式を再確認すること
4. **`備考` の取りうる値** — 観測できたのは `"予想"` のみ。他の値が現れたら §3.3 を更新
5. **✅ 2026-07-29 決着（条文は未確認のままリスク受容）。** 個人利用前提で
   ユーザーが判断した（ADR-0007「利用規約について」）。条文の適法性を
   確認したわけではない点に注意。利用形態が個人利用を超えたら再判断する
6. **✅ 2026-07-29 解消（`impl-from-spec`）。株式分割検知（§5.3 の桁チェック）。**
   `src/infra/irbank/parse-fy-data.ts` に `recordSuspiciousJump()` を追加し、
   `ImportDiagnostic.reason` に `'suspicious-jump'` を追加した（§5.3・§7.1）。
   実データ（7203）で純利益倍増（EPS +104%）を実際に検知して記録することを
   確認済み。株式分割ではなく実際の急回復だが、仕様どおり「除外せず記録」の
   挙動は正しい
7. **✅ 2026-07-29 解消（`impl-from-spec`）。`CompanyForm.tsx` の自動テスト。**
   `buildRowsFromImport` / `toYearRow` を export し、`fillMultiplesIfEmpty`
   から判定ロジックを `fillBlankMultiples()`（純粋関数）として切り出した。
   `@testing-library/react` は追加せず、`tests/frontend/company-form.test.tsx`
   （`.tsx` 拡張子。`vitest.unit.config.ts` / `tsconfig.frontend.json` に
   `tests/**/*.test.tsx` を追加）で Vitest だけを使ってテストしている（§7.1）
8. **frontend → domain のランタイム依存は [ADR-0008](../../adr/0008-frontend-domain-runtime-import.md) で明文化した。**
   `deriveMarketMultiples()` に限り frontend から実行時 import してよい
   （`src/domain/scoring/` は対象外）。PER/PBR が近似値であることを
   保存後も追跡する仕組みは無いままで、ADR-0008 が未解決事項として残している
9. **✅ 2026-07-29 解消。派生値（営業利益率・PER/PBR）の計算場所を
   `src/domain/company/` に統一した。** 営業利益率の算出を
   `src/infra/irbank/parse-fy-data.ts` から `src/domain/company/operating-margin.ts`
   の `deriveOperatingMarginPercent()` へ移した（挙動は変えていない。
   `tests/domain/company/operating-margin.test.ts` で単体テストを追加し、
   従来の統合レベルの検証は `parse-fy-data.test.ts` §3.5 にそのまま残した）。
   これで PER/PBR（`market-multiples.ts`）と同じ場所に揃った
10. 🔴 **診断が画面で件数に潰れていて、人が判断できない。**
    `ImportDiagnostic` は `block` / `fiscalYearKey` / `column` / `raw` を持ち
    API 応答にも載っているのに、`CompanyForm.tsx` の `summarizeDiagnostics()` が
    件数に潰している。「値を採用したまま記録しています」だけでは、どの年度の
    どの列が怪しいのか分からない。あわせて `buildRowsFromImport()` が
    取り込みに無い年度の**手入力を消す**（①②④⑦ は手入力とセットで使う前提なのに）。
    仕様を [import-review.md](./import-review.md) に起こした（2026-07-30）
11. **銭変換の2経路（数値文字列 / `number`）が同値であることは、
    §7.1 のテストにのみ現れ、§3.4 に不変条件として明記していない。**
    軽微。次にこの節を触るときに「どちらの経路で来ても同じ銭になる」を
    明文の不変条件として書き加えるとよい

## 実装（2026-07-28）— パーサと取得まで

| ファイル                                           | 内容                                             |
| :------------------------------------------------- | :----------------------------------------------- |
| `src/domain/company/financial-source.ts`           | 取得ポート `FinancialSource` と共通の型          |
| `src/infra/irbank/parse-fy-data.ts`                | `parseFyData(raw, expectedCode)`。**純粋関数**   |
| `src/infra/irbank/fy-data-client.ts`               | `IrBankFinancialSource`。**ここだけが通信する**  |
| `tests/infra/irbank/parse-fy-data.test.ts`         | 50 ケース                                        |
| `tests/infra/irbank/fy-data-client.test.ts`        | 21 ケース。`fetch` を差し替えて実 API を叩かない |
| `tests/fixtures/irbank/{9433,8306,7203,1301}.json` | 実際に取得したレスポンスそのもの                 |

- fixture は `.prettierignore` に入れて**整形しない**。整形すると「取得したそのもの」でなくなる
- 出力は `ImportedFinancials`。**handler の DTO ではなくドメインの型**
  （`FinancialRecord` / `DividendRecord`）を返す。infra → handler の依存を作らないため
- **PER / PBR はここでは出さない。** 株価が要るので `latestActualEpsSen` /
  `latestActualBpsSen` を渡すところまで。倍率の算出は結線時に決める
- **取得とパースを別ファイルに分けた。** 規約面で自動取得ができなくなったときに
  前段だけ差し替えられるようにするため（ADR-0007「見直しのトリガー」）

### 変異テストで確認したこと

テストが空振りしていないことを、実装を意図的に壊して確認した（確認後は復元済み）。

| 仕込んだバグ             | 落ちたテスト |
| :----------------------- | -----------: |
| `"-"` を 0 として扱う    |          4件 |
| 数値文字列を受け付けない |          5件 |
| 重複年度を後勝ちにする   |          1件 |
| 通信失敗をリトライしない |          2件 |
| 5xx をリトライしない     |          1件 |
| リダイレクトを追う       |          1件 |
| `Content-Type` を見ない  |          1件 |
| 銘柄コードを検証しない   |          5件 |

### この設計書との差分

- **`src/lib/` ではなく `src/infra/irbank/` に置いた。** `src/lib/` は移行ブリッジで
  「新しいコードを書かない」（ルート `CLAUDE.md`）と定められており、eslint も
  新規参照に警告を出す。`import-financials/SKILL.md` の「`src/lib/` の純粋関数」は
  Workers 移行前の記述
- **`malformed-json` を `malformed-response` に改名した。** エラー型はドメイン側
  （`FinancialSource` のポート）に置いたので、`json` という形式の詳細を
  ドメインの語彙に持ち込まない
- **§7 の `fetchedAt` はパーサの責務にしなかった。** 取得時刻はサーバー側の時計から
  付ける（`dependencies.now()`）ので、純粋関数の外側で付ける
- **`redirect: 'manual'` で 3xx を検出する。** 追いかけると HTML を 200 で
  掴まされるため。`Content-Type` の検査はその保険として残した

### 残り（すべて解消済み。履歴として残す）

- ✅ usecase・handler・画面の結線 → 下記「実装（2026-07-28）」で完了
- ✅ ⑨ の PER / PBR を株価から算出する場所 → `src/domain/company/market-multiples.ts`
  に決定（2026-07-29、予想EPS優先に変更）
- ✅ `docs/00_overview/data-flow.md` の更新 → 完了済み

## 実装（2026-07-28）— usecase・handler・画面の結線

| ファイル                                        | 内容                                                              |
| :---------------------------------------------- | :---------------------------------------------------------------- |
| `src/domain/company/market-multiples.ts`        | `deriveMarketMultiples()`。株価と EPS/BPS から PER/PBR を導出     |
| `src/usecase/import-from-irbank.ts`             | `importFromIrBank()`。`FinancialSource` への薄い委譲              |
| `src/handler/dto/irbank-import.ts`              | 応答 DTO とエラー→HTTP 変換                                       |
| `src/handler/app.ts`                            | `GET /api/irbank/:code`                                           |
| `src/index.ts`                                  | `IrBankFinancialSource` の DI 組み立て                            |
| `frontend/format.ts`                            | `senToEditableText` / `ratioToEditableText`（編集欄用の往復変換） |
| `frontend/api.ts`                               | `importFromIrBank()`                                              |
| `frontend/components/CompanyForm.tsx`           | 「IRバンクから取り込む」ボタンと prefill ロジック                 |
| `tests/domain/company/market-multiples.test.ts` | 9 ケース                                                          |
| `tests/handler/irbank-import.test.ts`           | 10 ケース。スタブ `FinancialSource` で実 API を叩かない           |
| `tests/frontend/format.test.ts`                 | 8 ケース                                                          |

### 設計判断

- **PER/PBR は「実績ベースの近似値」。** `MarketMultiples.per` の定義コメントは
  「PER（会社予想）」（`company.ts`）だが、予想EPS は業績ブロックに予想行が無い
  銘柄（9433/8306）では取れない。`deriveMarketMultiples()` は直近実績の EPS/BPS
  で算出し、より正確な会社予想PERをユーザーが知っていれば上書きできる前提にした
  （`market-multiples.ts` のコメント参照）
- **PER/PBR の算出はドメインの純粋関数をフロントから直接 import して呼ぶ。**
  HTTP 往復無しでその場に反映するため。`src/domain` はフレームワーク非依存の
  素TS で、型だけでなく実行コードとしてフロントにバンドルしても安全（Vite
  ビルドで確認済み）。この経路は**このプロジェクトで初めて domain のランタイム
  コードをフロントから呼ぶ**前例になる（従来は型だけの import だった）
- **年度別データは「置き換え」ではなく「差し込み」。** 既定の行構成
  （予想1行＋実績6行）に取り込めた年度をはめ込み、範囲外の古い年度は末尾に
  追加する。単純に取り込み結果で丸ごと置き換えると、①②④⑦ が必要とする
  6年以上前の年度を手入力する空行ごと消えてしまう（§6）
- **PER/PBR は「空欄のときだけ」自動で埋める。** ユーザーが既に手入力した値を
  上書きしない。株価欄の `onChange` と取り込み完了時の両方から同じ関数を呼ぶ
- **除算由来の値は編集欄で小数第2位に丸める。** 実装後にブラウザで確認したところ、
  営業利益率・PER・PBR が `18.101785021694145` のような生の浮動小数点で
  編集欄に出ることが分かった（EPS・ROE 等の直接取り込み値は元々2桁程度なので
  問題にならない）。`ratioToEditableText`（`frontend/format.ts`）で丸めた。
  判定（スコア計算）は別経路の生値で行うため影響しない

### ブラウザでの実地確認（2026-07-28、`run-dividend-stock-analysis` 経由）

9433 を実際に取り込み、以下を確認した。

- 2027年度（予想）: `dividendYen` に `84`、`isForecast` チェック付き。
  `epsYen` 等は空欄（9433 の業績ブロックに予想行が無いため。§6 のとおり）
- 2026年度（実績）: EPS `183.59` / ROE `13.93` / 売上高 `6071915000000` /
  営業利益率 `18.1`（算出値）/ 配当 `80` — いずれも実データと一致
- 2021年度: 取り込みで埋まらず、既定の空行のまま残る（手入力用の枠が保たれる）
- 株価 `1500` を先に入力してから取り込むと PER `8.17` / PBR `1.12` が
  自動算出される（1500÷183.59、1500÷1333.5 と手計算で一致確認済み）

### 残り

- ⑨ の PER/PBR が実績ベースであることの画面上の明示（現状はプレースホルダ文言のみ。
  [ADR-0008](../../adr/0008-frontend-domain-runtime-import.md) に未解決事項として記録）
- ✅ `docs/00_overview/data-flow.md` の更新は完了済み（当初「別コミットで実施」と
  書いたが、実際には本セッション内で更新した。記述の陳腐化として `/review-spec` で
  指摘され訂正）
- ✅ §8-6・§8-7（株式分割検知の実装、`CompanyForm.tsx` の自動テスト）は
  2026-07-29 `impl-from-spec` で解消（下記）

## 実装（2026-07-29）— `/review-spec` 指摘の解消（`impl-from-spec`）

| ファイル                                           | 内容                                                                                                              |
| :------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------- |
| `src/domain/company/financial-source.ts`           | `ImportDiagnostic.reason` に `'suspicious-jump'` を追加                                                           |
| `src/infra/irbank/parse-fy-data.ts`                | `SUSPICIOUS_JUMP_RATIO` / `recordSuspiciousJump()`                                                                |
| `tests/infra/irbank/parse-fy-data.test.ts`         | +12 ケース（50 → 62）                                                                                             |
| `frontend/components/CompanyForm.tsx`              | `toYearRow` / `buildRowsFromImport` を export。純粋関数 `fillBlankMultiples()` と `summarizeDiagnostics()` を新設 |
| `tests/frontend/company-form.test.tsx`             | 新規19ケース                                                                                                      |
| `vitest.unit.config.ts` / `tsconfig.frontend.json` | `tests/**/*.test.tsx` を include に追加                                                                           |

### 指示になかったが、この差分の直接の結果として直したもの

**`summarizeDiagnostics()` は当初の指示（1c・1d）には無かった。** 1c で
`suspicious-jump` を追加した結果、`CompanyForm.tsx` の取り込み完了時の通知文
「N件の項目を読み取れませんでした（**データなし扱いにしています**）」が
誤りになった。`suspicious-jump` は値を `null` にせず採用するため、この文言は
事実と矛盾する（実データ 7203 を取り込むと再現する）。1c を実装した直接の
副作用として発生した不具合であり、別タスクの「ついで」ではないため、
このセッション内で修正した。診断を「除外系」と「値を残したまま記録した系」に
分け、それぞれ別の文言で伝える（`DISCARDED_REASONS` の6種 vs `rounded` /
`suspicious-jump` の2種）。

### 変異テストで確認したこと（今回追加分）

- `recordSuspiciousJump` の `change <= SUSPICIOUS_JUMP_RATIO` を
  `change < SUSPICIOUS_JUMP_RATIO` に変えると、「ちょうど80%は記録しない」の
  1件だけが落ちることを確認（確認後に復元）
- `if (current.fiscalYear - previous.fiscalYear !== 1) continue;` のガードを
  外すと、「配列上は隣り合っていても暦年で1年差でなければ比較しない」の
  1件だけが落ちることを確認（確認後に復元）

### `impl-from-spec` の code-reviewer 指摘で修正した1件

**暦年の隣接チェックが漏れていた。** `records` は業績と配当の年度の
**和集合**であり、決算期変更等でどちらのブロックにも無い年度は
配列から丸ごと欠ける（§3.2）。当初の実装は `records[index-1]` と
`records[index]` を単純に隣接比較しており、間の年度が欠けているケースで
「2021年→2024年の3年で EPS が130→250（年率24%成長）」のような
**正常な複利成長を1年分の変化として誤検出する**（92.3% > 80% 閾値）バグが
あった。`current.fiscalYear - previous.fiscalYear !== 1` のガードを追加し、
暦年で1年差の場合だけ比較するよう修正した。

### 未着手のまま残したこと

- ✅ §8-9（派生値の計算場所の統一リファクタ）は同日中に別途完了（下記「実装（2026-07-29）」）
- §8-1（⑥ の金額表現）は未着手のまま。§8-5（利用規約）は2026-07-29 決着（上記）
- `summarizeDiagnostics` の `DISCARDED_REASONS`（`Set` によるメンバーシップ判定）は、
  将来 `ImportDiagnostic.reason` に新しい種別を追加してもコンパイルエラーに
  ならない（code-reviewer 指摘、優先度低）。`switch` 文による網羅性チェックへの
  置き換えは任意の改善として未実施

## 実装（2026-07-29）— PER の予想EPS優先化・出所の追跡（1e/1f/1g）

`docs/migration-plan.md` §6 の 1e〜1g を解消した。

- **1e 利用規約** — ADR-0007 に記載（個人利用のリスク受容。条文未確認）
- **1f PER/PBR の出所** — 下記
- **1g 派生値の計算場所の統一** — `src/domain/company/operating-margin.ts` を
  新設し、`parse-fy-data.ts` から算出ロジックを移動（§8-9・§3.5 で反映済み）

### PER は予想EPSを優先する

`ImportedFinancials.latestForecastEpsSen`（新設）を業績ブロックの予想行から
拾い、`deriveMarketMultiples()` が実績EPSより優先する。予想が無い銘柄
（9433/8306 型）だけ実績EPSにフォールバックする。

### 出所の追跡（`PerSource` / `PbrSource`）

`MarketMultiples` に `perSource: 'forecast-eps' | 'actual-eps' | 'manual' | null` と
`pbrSource: 'actual-bps' | 'manual' | null` を追加した。⑩ の `dividendSource` と
同じ発想。

| 層         | 変更                                                                                                                    |
| :--------- | :---------------------------------------------------------------------------------------------------------------------- |
| domain     | `company.ts` に型追加。`market-multiples.ts` が算出時に出所を返す                                                       |
| infra (D1) | `companies` テーブルに `per_source` / `pbr_source`（nullable text）追加。`db/migrations/0001_foamy_layla_miller.sql`    |
| usecase    | `scoreCompany()` が `company.multiples.perSource`/`pbrSource` をそのまま通す（採点では算出しない）                      |
| handler    | zod スキーマに `perSource`/`pbrSource` を追加。`ScoringResponse` にも追加（⑩ と同じ並び）                               |
| frontend   | `CompanyForm.tsx`: `fillBlankMultiples` が出所も返す。手入力時は `onChange` で `'manual'` に設定。`ListPage.tsx` で表示 |

- **手入力かどうかの判定は完全ではない。** PER/PBR 欄への `onChange` が
  発火するたびに `'manual'` にする実装で、取り込みで一度埋めた値をそのまま
  何もせず送信した場合は正しい出所が残るが、**空にしてから同じ値を再入力すると
  `'manual'` になる**（取り込み由来だったことを覚えていない）。実害は小さい
  （表示が「手入力」になるだけで、数値自体は変わらない）と判断し、許容した
- **PBR の BPS を年度別データとして正式に保存する対応は見送った。**
  （ADR-0008「未解決のまま残すこと」参照）

### テスト

- `tests/domain/company/market-multiples.test.ts` — 予想EPS優先・実績EPS代用・
  出所の組み合わせを追加
- `tests/frontend/company-form.test.tsx` — `fillBlankMultiples` の出所を検証
- `tests/integration/api.test.ts` — `per_source`/`pbr_source` が D1 を往復し、
  `GET /api/companies/:code` の応答にも出ることを確認
