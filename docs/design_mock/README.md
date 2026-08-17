# Handoff: 高配当銘柄スコアリング (Dividend Stock Scoring Tool)

> ⚠️ **2026-08-16 追記（このリポジトリでの扱い）。この試作は「画面と情報設計」の参考であって、
> スコア判定の数値・計算式の出典ではない。**
>
> `design-reference.html` の `criteria` 配列（702〜723行）は**レイアウト確認用のダミー**であり、
> 正典 [`docs/01_requirements/scoring-requirements.md`](../01_requirements/scoring-requirements.md)
> と**全10指標で食い違う**。
>
> | 項目            | 試作                                      | 正典（こちらが正）                            |
> | :-------------- | :---------------------------------------- | :-------------------------------------------- |
> | 区分数          | 全指標4区分（10/7/4/0 点など）            | **11段（0〜10点）**。③ のみ10段               |
> | ④ EPS CAGR の式 | `(最新EPS ÷ 5年前EPS)^(1/5) − 1`（端点）  | **中央値ベース**（`eps-cagr-scoring.md`）     |
> | ⑨ MIX係数 の式  | 「配当利回り ＋ 増配率 の重み付き合成」   | **PER × PBR**（`mix-coefficient-scoring.md`） |
> | ⑥ の式          | `(現金同等物＋5年FCF見込) ÷ 年間配当総額` | `balance-sheet-derivation.md` の導出          |
>
> **評価基準カードは `src/domain/scoring/bands.ts` から描画する**
> （[criteria-tab.md](../02_design/ui/pages/criteria-tab.md) §3）。試作の数値を書き写さない。
> 試作から採るのは**レイアウト・情報の並び・配色・インタラクション**だけ。
>
> 実装方針の全体は [design-mock-alignment.md](../03_tasks/design-mock-alignment.md) にある。
> なお下記 §Design Principles・§Screens の**実装手法**（`div` ＋ `role="button"` の行、
> React state による画面状態の保持）は本リポジトリの規約に反するため採用しない（同 §2.5）。

## Overview

A Japanese-language web app that scores high-dividend-yield Japanese stocks against 10 fundamental indicators, visualizes the result as a radar chart, and lets users manage personal portfolios and a customized scoring model. It is explicitly an **analysis/visualization tool, not a recommendation engine** — no buy/sell signal coloring anywhere.

## About the Design Files

The bundled file (`design-reference.html`) is a **design reference built in HTML** (a "Design Component" prototype) — it shows the intended look, information hierarchy, and interaction behavior. It is **not production code to copy directly**. The task is to **recreate this design in the target codebase's existing environment** (React, Vue, native, etc.), using that codebase's established component patterns, state management, and libraries. If no frontend framework exists yet in the target repo, choose the framework best suited to the project and implement the design there. Treat all data in the prototype (stock list, portfolio holdings, dividend history, scores) as placeholder/mock data — real data must come from the actual backend/API.

## Fidelity

**High-fidelity.** Colors, typography, spacing, and interaction states below are final and should be recreated pixel-for-pixel where feasible. All copy is in Japanese and should be used verbatim unless the target product has different copy requirements.

## Design Principles (carry these into implementation, don't just copy pixels)

1. **Score is the visual protagonist.** Everywhere a stock's total score appears, it must be the largest, boldest element in its context (list rows, dialog header). Secondary metrics (yield, payout ratio, price) are visually quieter (smaller, muted color).
2. **Color has strict, non-overlapping roles** — do not reuse a color for a second meaning:
   - **Brand** `#37b09a` (teal) — used only for the small logo mark next to the app title. Not used anywhere else.
   - **Action / interactive** `#4a80f0` (blue) — buttons, links, active tab underline, focus rings, toggles, the role switcher's active state, login/signup CTAs. This is the ONLY color that means "you can interact here."
   - **Score / data (neutral)** `#c4ccd6` (steel gray), text `#e9ebef` — total scores, per-indicator scores, radar chart fill/stroke/dots, score progress bars. Deliberately neutral/non-judgmental — never green/red — because the tool does not make buy/sell recommendations.
   - **Caution / admin** `#d6a13c` (amber) — the "管理者のみ" (admin-only) badge, the "選択中 X/10" warning when a user has fewer than 5 indicators selected. Nothing else uses amber.
   - **P/L state (portfolio only)** positive `#52a06f` / negative `#cf6b5c`, always paired with a `▲`/`▼` glyph (never color alone) — used exclusively for portfolio unrealized gain/loss. Not used for scores or anything else.
3. **Reading order per screen**: see → compare → act.
   - Search list: see the score (biggest element) → compare across rows (secondary columns aligned) → act (click row → opens detail dialog).
   - Analysis dialog: see total score + radar (hero, top) → compare the 10-indicator table (middle) → act (click a metric row → drill into detail, or close).
4. **Real-world data resilience** (must be preserved in implementation):
   - Missing values render as `—` (em dash) in muted text, never `0` and never blank.
   - Long stock names truncate with ellipsis (`text-overflow: ellipsis`, `white-space: nowrap`, `overflow: hidden`) and expose the full name via a `title` attribute / tooltip.
   - Forecast values are always suffixed with `（予想）`; actuals are not.
   - Increases/decreases are shown with `▲`/`▼` glyphs plus color — never color alone (colorblind-safe).
   - Zero search results show a dedicated empty state (dashed border card with explanatory copy), not a blank table.
   - All money values use thousands separators + `円`; percentages use fixed decimal places (yield/growth: 2 or 1 decimals; see per-field notes below).
   - A data-timestamp is shown wherever staleness matters (e.g. "データ取得時刻: 2026-08-16 09:41 JST").

## Screens / Views

### 1. App shell / Header

- **Purpose**: Global nav, role/auth state, brand identity.
- **Layout**: Flex row, space-between. Left: 9×26px teal accent bar + app title (19px/700). Right: role switcher (dev/demo only — see note below) + auth area.
- **Nav tabs** (below header, `border-bottom: 1px solid #262c37`): role-gated —
  - 検索 (Search) — all roles (including logged-out)
  - ポートフォリオ (Portfolio) — user, admin only
  - 指標カスタマイズ (Indicator Customization) — user, admin only
  - 評価基準 (Scoring Criteria) — all roles
  - 銘柄登録 (Stock Registration) — admin only
  - Active tab: 2px bottom border in action-blue `#4a80f0`, text `#e9ebef` weight 700; inactive: transparent border, `#98a1b0` weight 400.
- **Auth area**: logged-out shows a filled blue "ログイン" button; logged-in shows avatar-initial circle + email + (if admin) amber "管理者" badge + outlined "ログアウト" button.
- **Note on the role switcher**: the prototype includes a "デモ表示" (demo display) segmented control (ゲスト/一般/管理者) purely so reviewers can preview all three permission states without a real login flow. **Do not ship this control** — real role should come from the authenticated session.

### 2. 検索 (Search) — default/home screen, accessible without login

- **Purpose**: Find and open scored stocks; the primary daily-use screen.
- **Layout**: search input (left, ~460px) + result count + sort dropdown (right), all in one flex row, `flex-wrap: nowrap`, count label and select both `flex: none` / `white-space: nowrap` so long counts never wrap mid-word. Below: a table-like list in a rounded card (`border-radius:12px`, border `#262c37`, bg `#161a20`).
- **Row anatomy** (whole `<tr>` is a button — click or Enter/Space opens the analysis dialog):
  - Col 1 銘柄: name 14.5px/500 `#e9ebef` (truncate + title attr) over code 11px monospace `#626c7a`.
  - Col 2 総合点 (hero): number 23px/700 monospace `#e9ebef` + "点" suffix 10.5px `#626c7a`, with a 4px-tall neutral progress bar (`#c4ccd6` fill on `#262c37` track, width = score%) underneath, 92px wide.
  - Col 3 配当利回り: 13.5px monospace `#e9ebef`.
  - Col 4 配当性向: 13px monospace `#98a1b0` (secondary).
  - Col 5 株価: 13px monospace `#98a1b0`, formatted `"1,234 円"`.
  - Col 6: `›` chevron, `#4a5563`, affordance only.
  - Row hover: bg `#1a1f28`. Row focus: bg `#1a1f28` + `box-shadow: inset 3px 0 0 #4a80f0`.
- **Empty state** (0 results): dashed-border card, centered text — bold "「{query}」に一致する銘柄はありません" + muted helper line. Never render a blank table.
- **Pagination**: 15 rows/page, "← 前へ" / "N / total pages" / "次へ →" — disabled buttons dim to `#3a4452` border/text.
- **Sort options**: 入力日時（新しい順）, 総合点（高い順）, 総合点（低い順）, コード順.

### 3. Analysis Dialog (opened from any stock row)

- **Purpose**: Full scoring breakdown for one stock. Modal with scrim.
- **Layout**: fixed-position full-viewport scrim `rgba(6,8,12,0.74)` + `backdrop-filter: blur(3px)`, centered dialog card max-width 940px, `border-radius:16px`, bg `#12161d`, border `#262c37`. Clicking the scrim or pressing Escape closes it; clicking inside the dialog does not.
- **Header row**: stock name (17px/700) + code · TSE · market segment (13px monospace `#98a1b0`) + close (✕) button.
- **Overview mode (default)**:
  - Hero row, 2-col grid (270px | 1fr):
    - Left card: "総合スコア" label, huge 52px/700 monospace score + "/100", 8px neutral progress bar, "有効指標 N/10 指標で算出" caption, divider, then a compact key-value list of raw facts (株価, 配当利回り, PER, PBR — PBR shows "— データなし" in muted color when absent), divider, a toggle ("実績配当性向を採点に使う") in action-blue.
    - Right card: 10-axis radar chart (see Radar spec below), titled "指標プロファイル（各 0〜10）".
  - Compare table below (full width): columns 指標 / 値 / スコア (bar + number) / 評価 (short verdict text) / chevron. Every row is clickable → opens the metric detail view for that indicator. Score bars use the same neutral `#c4ccd6`.
  - Footer hint line: "各指標の行を押すと、年次推移などの詳細を表示します。"
- **Metric detail mode** (replaces overview content, same dialog): "← 指標一覧へ戻る" back button, then indicator title + current value + score, then one of three body types depending on indicator:
  - **Line chart** (used for 増配率（5年CAGR）): custom SVG line chart, per-year dividend-per-share values (2019–2026, 2026 marked "（予想）"), axis gridlines at 0/30/60/90/120, value labels above each point, year labels below. Followed by a table: 年度 / 1株配当 / 前年比 (▲/▼/－ with color + amount).
  - **Streak list** (used for 連続非減配年数): vertical list, one row per year — year, ▲/－/▼ glyph+color, status word (増配/据置/減配), amount, delta — ending with a summary line "減配のない状態が **10年** 継続中です。"
  - **Generic** (used for the remaining 8 indicators): formula in a monospace code block, then a 条件/点数 (condition/points) table reused from the 評価基準 screen.

### 4. ポートフォリオ (Portfolio) — requires login

- **Purpose**: Track owned positions across up to 10 named portfolios, up to 100 holdings each.
- **Layout**: portfolio-switcher pill row (+ "＋ 追加" and "N / 10" counter) → 2-col hero grid (評価額合計 large, 評価損益 with P/L color+glyph) → 3-col secondary summary row (平均利回り［評価額加重］, 取得単価利回り, スコア平均) → holdings table → "＋ 銘柄を追加" / "N / 100 銘柄" footer row → explanatory footnote paragraph (formulas spelled out for transparency).
- **Holdings table columns**: 銘柄 (name+code) / 保有数量 / 取得単価 / 現在株価 / 評価額 / 評価損益 (P/L colored + glyph) / 利回り / スコア. Row click opens the Analysis Dialog for that stock.
- **Calculations** (must be implemented server- or client-side from real data):
  - 評価額 (value) = 保有数量 × 現在株価
  - 評価損益 (P/L) = 評価額 − (保有数量 × 取得単価平均)
  - 平均利回り（評価額）= Σ(評価額ᵢ × 利回りᵢ) / Σ評価額ᵢ
  - 取得単価利回り = Σ(年間配当ᵢ) / Σ(取得原価ᵢ), where 年間配当ᵢ = 評価額ᵢ × 利回りᵢ
  - スコア平均 = simple mean of holding scores, NOT weighted by quantity

### 5. 指標カスタマイズ (Indicator Customization) — requires login

- **Purpose**: Let a user choose 5–10 of the 10 scoring indicators and set the value that earns a perfect 10/10 score on each.
- **Layout**: header with live counter "選択中 X / 10（最小 5）" — turns amber and shows a warning banner when count < 5. One row per indicator: checkbox-style toggle (22×22px rounded square, action-blue when checked) + indicator name + constraint caption (step/min/max) + a number input (with native `step`/`min`/`max`) for the "満点となる基準値", disabled/grayed when the indicator is deselected. MIX係数 has no input — it shows a static "配当利回り・増配率から自動算出" chip instead (it's derived, not user-set).
- **Per-indicator constraints** (step / min / max / unit):
  | Indicator           | Step                              | Min  | Max | Unit |
  | ------------------- | --------------------------------- | ---- | --- | ---- |
  | 増配率（5年CAGR）   | 0.1                               | 0    | 50  | %    |
  | 連続非減配年数      | 1                                 | 0    | 50  | 年   |
  | 予想配当性向        | 1                                 | -100 | 500 | %    |
  | EPSの5年CAGR        | 0.1                               | 0    | 50  | %    |
  | ROEの5年平均        | 0.1                               | 0    | 100 | %    |
  | 配当維持可能年数    | 1                                 | -100 | 100 | 年   |
  | 売上高の5年CAGR     | 1                                 | 0    | 100 | %    |
  | 営業利益率の5年平均 | 0.1                               | 0    | 50  | %    |
  | MIX係数             | — not user-configurable (derived) |      |     |      |
  | 配当利回り          | 0.1                               | 0    | 50  | %    |
- Footer actions: filled blue "設定を保存" + outlined "初期設定に戻す".

### 6. 評価基準 (Scoring Criteria) — public, no login required

- **Purpose**: Full transparency on how each of the 10 indicators is scored (builds trust; supports the "not a recommendation" positioning).
- **Layout**: 2-column grid of cards, one per indicator: name, one-line description, formula in a monospace inset block, and a 条件/点数 (condition → points) table with 4 bands each.
- Content for all 10 indicators (name, description, formula, bands) is fully specified in the prototype's `criteria` array — copy verbatim.

### 7. 銘柄登録 (Stock Registration) — admin only

- **Purpose**: Enter/edit raw fundamental data for a stock; the 10 indicators are auto-scored from this.
- **Layout**: amber "管理者のみ" badge next to the H2. Two fieldsets: 基本情報 (code, current price, PER, PBR — 2-col grid) and 年度別データ (a small table of year / dividend-per-share / EPS / operating income, 4 years shown). Footer: filled blue "解析して保存" + outlined "クリア".
- Empty/unknown fields render "—", never 0 (explicit instruction copy: "0 は入力しないでください").

### 8. ログイン / アカウント作成 (Login / Signup) — public

- **Purpose**: Auth entry point; reachable via the header's ログイン button. Search and 評価基準 remain usable without logging in.
- **Layout**: centered card, max-width 400px. Segmented pill switcher (ログイン / アカウント作成) on top. Below: email field, password field (+ confirm-password field, signup only), full-width filled-blue submit button, and a footnote: "パスワードはハッシュ化して保存され、平文では保持されません。ログインしなくても銘柄の検索は利用できます。"
- **Security note for implementation**: the footnote is a UI promise — actual password hashing (bcrypt/argon2 etc.) must happen server-side; never hash or handle raw passwords client-side beyond transport.

## Interactions & Behavior

- Analysis dialog: open on stock-row click (search list, portfolio holdings) → close via ✕ button, scrim click, or Escape key. Opening always resets to overview mode (not metric-detail).
- Metric-detail mode: entered by clicking a metric-table row inside the dialog; exited via explicit "← 指標一覧へ戻る" button (not by scrim click, since that closes the whole dialog).
- Search: typing in the query field filters live and resets to page 1; changing sort also resets to page 1.
- Pagination buttons disable (visually + functionally) at the first/last page.
- Indicator customization: toggling a checkbox is blocked (no-op) if it would drop selection below 5 or raise it above 10; a persistent counter and conditional warning banner communicate the constraint instead of a blocking modal/alert.
- All interactive rows/buttons are keyboard-accessible: `tabIndex="0"`, `role="button"`, Enter/Space triggers the same handler as click; focus state is visually distinct (`box-shadow: inset 3px 0 0` in action-blue).

## State Management

Minimum state needed per screen (shape suggestions, not literal variable names):

- Global: `currentUser` (null | {email, role: 'user'|'admin'}), `activeTab`.
- Search: `query` (string), `sortKey`, `currentPage`.
- Analysis dialog: `openStockId` (null when closed), `activeMetricIndex` (null = overview).
- Portfolio: `activePortfolioId`, and the portfolios/holdings data itself (fetched, not hardcoded).
- Indicator customization: `selectedIndicators` (array, 5–10 items), `thresholdByIndicator` (map).
- Auth screen: `mode` ('login'|'signup'), form field values, validation/error state (not designed in the prototype — add per the target app's form patterns).

## Design Tokens

### Colors

| Role                   | Hex                                  | Usage                                                           |
| ---------------------- | ------------------------------------ | --------------------------------------------------------------- |
| Background             | `#0e1014`                            | page background                                                 |
| Surface                | `#161a20`                            | cards, table containers                                         |
| Surface (dim)          | `#12151b`                            | secondary summary cards, empty state, unselected indicator rows |
| Surface (inset)        | `#0e1014`                            | input backgrounds                                               |
| Line (hairline)        | `#262c37` / row dividers `#1e242e`   | card borders, table row dividers                                |
| Line (strong)          | `#333b48`                            | input borders, secondary button borders                         |
| Text primary           | `#e9ebef`                            | headings, primary values                                        |
| Text secondary         | `#98a1b0`                            | labels, secondary values                                        |
| Text tertiary          | `#626c7a`                            | captions, timestamps, disabled                                  |
| Brand (logo only)      | `#37b09a`                            | logo accent bar                                                 |
| Action / interactive   | `#4a80f0` (text-on-action `#0a1220`) | buttons, links, active states, focus                            |
| Score / data (neutral) | `#c4ccd6`                            | scores, radar, progress bars                                    |
| Caution / admin        | `#d6a13c`                            | admin badge, validation warning                                 |
| Positive (P/L)         | `#52a06f`                            | portfolio gains, ▲                                              |
| Negative (P/L)         | `#cf6b5c`                            | portfolio losses, ▼                                             |

### Typography

- UI font: `'Zen Kaku Gothic New', system-ui, -apple-system, 'Hiragino Sans', sans-serif`
- Numeric/monospace font: `'Roboto Mono', monospace` — used for ALL numbers, codes, dates, formulas (never the UI font for numerals, for tabular alignment).
- Scale in use: 52px/700 (dialog hero score), 38px/700 (portfolio hero value), 23px/700 (list-row score), 19px/700 (app title), 17px/700 (dialog title), 16px/700 (section H2), 14.5px/500 (stock name), 13–13.5px/400–500 (body/table), 12–12.5px (secondary), 11–11.5px (captions), 10–10.5px (micro labels, uppercase-adjacent letter-spacing).

### Spacing / Radius

- Card radius: 12px (most cards), 14px (portfolio hero, auth card), 16px (dialog), 10px (nested rows), 8–9px (buttons, inputs, badges).
- Page gutters: 32px horizontal on desktop; content max-width 1160px, centered.
- Card padding: 18–24px typical; compact rows 11–14px vertical.

### Shadows

- Dialog only: `box-shadow: 0 24px 64px rgba(0,0,0,0.6)`. No other shadows are used — the design relies on flat surfaces + hairline borders for separation, not elevation shadows.

## Assets

No external image assets — the entire UI is typographic + CSS + inline SVG (radar chart and dividend line chart are hand-built SVG, not chart-library output; recreate with whatever charting approach the target codebase already uses, matching the neutral-gray/no-gradient styling).

## Files

- `design-reference.html` — the full interactive prototype (all 8 screens + dialog + metric-detail sub-views), single self-contained file. Open directly in a browser to explore every state (use the demo role switcher top-right to unlock 一般/管理者-only tabs).
