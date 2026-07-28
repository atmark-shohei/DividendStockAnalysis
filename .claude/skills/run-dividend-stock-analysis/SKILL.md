---
name: run-dividend-stock-analysis
description: Build, run, screenshot and drive the DividendStockAnalysis Cloudflare Workers app. Use when asked to start the app, run the dev server, build it, run its tests, take a screenshot of a page, click or type into the UI, or check that a page renders.
---

Cloudflare Workers app (Hono + D1 + a React/Vite SPA served via Workers
Assets). An agent drives it with
`.claude/skills/run-dividend-stock-analysis/driver.mjs` — a zero-dependency
Chrome DevTools Protocol harness that starts the dev server, launches headless
Chrome, and exposes navigate / click / type / eval / screenshot. It boots the
server itself, so there is nothing to start beforehand and nothing left running
afterwards.

All paths below are relative to the repo root. **Verified 2026-07-28 on Windows
11, PowerShell 5.1 / Git Bash, Node v24.18.0, npm 11.16.0, wrangler 4.114.0.**
Commands are PowerShell unless noted.

## Prerequisites

Node ≥ 20 (`package.json` `engines`) and a Chromium-family browser. There is no
`apt-get` step — this is a Windows host, and the browser that the driver uses
was already installed:

```powershell
node -v    # v24.18.0
npm -v     # 11.16.0
Test-Path 'C:\Program Files\Google\Chrome\Application\chrome.exe'   # True
```

The driver probes Chrome then Edge in the usual install locations. If neither is
where it expects, point it at one:

```powershell
$env:CHROME_PATH = 'C:\path\to\chrome.exe'
```

`chromium-cli`, Playwright, Puppeteer and `tmux` are **not** installed on this
machine and are not needed — the driver speaks CDP directly using Node's
built-in `fetch` and `WebSocket`, and the REPL is driven by piping stdin.

Run `npm run db:migrate` at least once before driving the app — `npm run dev`
does not apply D1 migrations itself, and an un-migrated local DB makes every
API call fail.

## Setup

```powershell
npm install
npm run db:migrate   # applies db/migrations to the local D1 database
```

## Build

```powershell
npm run build
```

Runs `vite build` (SPA into `dist/frontend/`) then `wrangler deploy --dry-run
--outdir dist/worker`. This validates the Worker bundle but does **not** start
a server — there is no local "production server" command for this app (see
Gotchas). To exercise the app, use `npm run dev` (below), which already runs
against a real Workers runtime (workerd) via `wrangler dev`.

## Run (agent path)

**One command, start to finish.** Boots `npm run dev` (`vite build && wrangler
dev`), drives a real headless Chrome, asserts, screenshots, tears everything
down:

```powershell
node .claude/skills/run-dividend-stock-analysis/driver.mjs smoke
```

Verified output — exit code 0:

```
→ npm run dev (port 3000)
   server ready at http://127.0.0.1:3000
→ launching chrome.exe headless (CDP 9222)
→ GET http://127.0.0.1:3000/
   PASS  page has a title — "高配当銘柄スコアリング"
   PASS  html lang is ja — "ja"
   PASS  body is not empty — 143 chars
   PASS  disclaimer text is present — found
   PASS  screenshot written — ...\tmp\shots\home.png (40292 bytes)

SMOKE PASS
```

### Interactive: pipe commands to the REPL

For anything beyond the smoke path, use `repl` and feed it commands on stdin.
It prints `READY` once the page is loaded:

```powershell
@'
text h1
eval document.querySelectorAll('h2').length
ss home
goto /input
text body
ss input-page
quit
'@ | node .claude/skills/run-dividend-stock-analysis/driver.mjs repl
```

> The closing `'@` of a PowerShell here-string **must be at column 0**.
> Indenting it is a parse error.

The app has two screens (`docs/02_design/ui/screen-list.md`): `/` (saved
companies + selected scoring result) and `/input` (data-entry form only).
Selection state lives in the URL (`/?code=7203`), not in component state — a
plain `goto` reaches either screen directly.

| command             | what it does                                           |
| ------------------- | ------------------------------------------------------ |
| `goto <url\|path>`  | navigate; a bare path resolves against the dev server  |
| `ss <name>`         | PNG screenshot → `tmp/shots/<name>.png`                |
| `text [selector]`   | `innerText` (default `body`)                           |
| `html <selector>`   | `outerHTML`                                            |
| `click <selector>`  | real `Input.dispatchMouseEvent` at the element centre  |
| `type <sel> <text>` | focus, `Input.insertText`, then fire `input` for React |
| `wait <selector>`   | poll up to 15 s for the element                        |
| `eval <js>`         | `Runtime.evaluate`, result as JSON                     |
| `title` / `url`     | `document.title` / `location.href`                     |
| `help` / `quit`     | —                                                      |

Flags (all optional): `--port 3000` and `--cdp-port 9222` are **starting
points** — the driver scans upward for a free port. `--out <dir>` overrides the
screenshot directory, `--unit <dir>` the app root, `--verbose` streams the dev
server log, `--no-serve` (repl only) attaches to a server you started yourself.

Screenshots land in `tmp/shots/` — already covered by `.gitignore`.

**Look at the screenshot you take.** The smoke test only asserts the PNG is

> 5 kB; a blank page still passes that.

## Run (human path)

```powershell
npm run dev      # → http://127.0.0.1:8787 (vite build + wrangler dev) — Ctrl-C to stop
npm run dev:web  # → Vite only, HMR, no Worker/D1 behind it
```

## Test

```powershell
npm test                 # vitest run — 19 files, 414 tests
npm test -- <pattern>    # single file/suite by pattern
npm run typecheck        # tsc --noEmit (worker + frontend tsconfig)
npm run lint             # eslint .
npm run format:check     # prettier --check .
```

All four exit 0 as of 2026-07-28. `driver.mjs` is inside the lint and prettier
scope and passes both — keep it that way if you edit it.

## Gotchas

- **There is no `--prod` mode.** The old Next.js version of this skill had
  `smoke --prod` to run against a built server. This project has no local
  "production server" command — `npm run build` only produces a
  `wrangler deploy --dry-run` bundle, it does not serve it. `npm run dev`
  already runs the real Workers runtime (workerd via `wrangler dev`), so
  there is nothing a `--prod` flag would add.
- **A stranded dev server silently hijacks the next run.** On Windows
  `child.kill()` kills the `npm` wrapper but leaves the `wrangler`/`workerd`
  process tree holding the port; the following run then polls the _old_
  server and reports success for code that was never loaded. The driver uses
  `taskkill /PID <pid> /T /F` and waits for the exit event. If you write your
  own launcher, do the same. Check with
  `Get-NetTCPConnection -LocalPort 3000 -State Listen`.
- **`Page.navigate` does not reject on failure.** It resolves with an
  `errorText` field. Ignoring it turns `ERR_CONNECTION_REFUSED` into a mystery
  30-second `readyState` timeout. The driver checks `errorText`.
- **Teardown that throws strands the server.** An exception in the first cleanup
  step skips the rest of the `finally` block — that is exactly how the stray
  server above happens. Every teardown call in the driver is `.catch()`-wrapped.
- **Chrome keeps a lock on its temp profile after exit** → `rmSync` fails with
  `EPERM`. The driver retries for 2 s and then gives up quietly; a leftover
  `%TEMP%\dsa-cdp-*` directory is harmless.
- **Your personal Chrome does not interfere**, even with dozens of windows open,
  because the driver passes its own `--user-data-dir`. Drop that flag and CDP
  will attach to your real profile instead.
- **`spawn(cmd, args[], { shell: true })` triggers `DEP0190` on Node 24.** Pass
  a single command string instead.
- **`npm run dev` fails against an un-migrated D1 database.** Run
  `npm run db:migrate` once per checkout (see Prerequisites); API calls 500
  otherwise.

## Troubleshooting

- **`No Chrome/Edge found. Set CHROME_PATH to the browser executable.`** —
  none of the probed paths exist. Set `$env:CHROME_PATH`.
- **`navigation failed: net::ERR_CONNECTION_REFUSED`** — the dev server died
  during startup. Re-run with `--verbose` to see its output.
- **`Page did not reach readyState=complete (last state: …, at: …)`** — the
  reported URL tells you where the browser actually ended up. `about:blank`
  means navigation never started; the app URL means the page hangs.
- **`CDP <method> timed out after 30000ms`** — the browser died. Look for
  orphaned `chrome.exe` and check that `--user-data-dir` is writable.
- **Smoke passes but the screenshot is blank** — the assertions only check text
  in the DOM. Open the PNG.
