---
name: run-dividend-stock-analysis
description: Build, run, screenshot and drive the DividendStockAnalysis Next.js app. Use when asked to start the app, run the dev server, build it, run its tests, take a screenshot of a page, click or type into the UI, or check that a page renders.
---

Next.js 15 (App Router) app. An agent drives it with
`.claude/skills/run-dividend-stock-analysis/driver.mjs` — a zero-dependency
Chrome DevTools Protocol harness that starts the dev server, launches headless
Chrome, and exposes navigate / click / type / eval / screenshot. It boots the
server itself, so there is nothing to start beforehand and nothing left running
afterwards.

All paths below are relative to the repo root. **Verified 2026-07-26 on Windows
11, PowerShell 5.1, Node v24.18.0, npm 11.16.0.** Commands are PowerShell.

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

## Setup

```powershell
npm install
```

Exits 0. It prints `npm warn allow-scripts` for `sharp` and `unrs-resolver`;
that is npm 11 noise, not a failure — see Gotchas.

## Build

```powershell
npm run build
```

Produces two static routes (`/` and `/_not-found`), ~103 kB first-load JS.

## Run (agent path)

**One command, start to finish.** Boots `next dev`, drives a real headless
Chrome, asserts, screenshots, tears everything down:

```powershell
node .claude/skills/run-dividend-stock-analysis/driver.mjs smoke
```

Verified output — exit code 0:

```
→ npm run dev (port 3000)
   server ready at http://127.0.0.1:3000
→ launching chrome.exe headless (CDP 9222)
→ GET http://127.0.0.1:3000/
   PASS  page has a title — "DividendStockAnalysis"
   PASS  html lang is ja — "ja"
   PASS  body is not empty — 219 chars
   PASS  disclaimer text is present — found
   PASS  no Next.js error overlay
   PASS  screenshot written — ...\tmp\shots\home.png (47033 bytes)

SMOKE PASS
```

Against a production build instead of the dev server (runs `npm run build`
first, then `npm run start`):

```powershell
node .claude/skills/run-dividend-stock-analysis/driver.mjs smoke --prod
```

### Interactive: pipe commands to the REPL

For anything beyond the smoke path, use `repl` and feed it commands on stdin.
It prints `READY` once the page is loaded:

```powershell
@'
text h1
eval document.querySelectorAll('h2').length
ss home
goto /no-such-page
text body
ss notfound
quit
'@ | node .claude/skills/run-dividend-stock-analysis/driver.mjs repl
```

Verified output — exit code 0 (banner elided):

```
READY
DividendStockAnalysis
1
OK ...\tmp\shots\home.png (47033 bytes)
OK http://127.0.0.1:3000/no-such-page
404
This page could not be found.
OK ...\tmp\shots\notfound.png (9224 bytes)
```

> The closing `'@` of a PowerShell here-string **must be at column 0**.
> Indenting it is a parse error.

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
npm run dev      # → http://localhost:3000 — Ctrl-C to stop
```

## Test

```powershell
npm test                 # vitest run — 1 file, 3 tests
npm test -- smoke        # single file by pattern
npm run typecheck        # tsc --noEmit
npm run lint             # eslint .
npm run format:check     # prettier --check .
```

All five exit 0 as of 2026-07-26. `driver.mjs` is inside the lint and prettier
scope and passes both — keep it that way if you edit it.

## Gotchas

- **A stranded `next dev` silently hijacks the next run.** On Windows
  `child.kill()` kills the `npm` wrapper but leaves `node next dev` holding the
  port; the following run then polls the _old_ server and reports success for
  code that was never loaded. The driver uses `taskkill /PID <pid> /T /F` and
  waits for the exit event. If you write your own launcher, do the same. Check
  with `Get-NetTCPConnection -LocalPort 3000 -State Listen`.
- **Next.js silently increments past a busy port.** Ask for 3000 while it is
  taken and you get 3001 — while your script still polls 3000. The driver picks
  a free port itself and passes it explicitly, so the URL always matches.
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
- **Next dev logs `Cross origin request detected from 127.0.0.1`.** The driver
  uses `127.0.0.1` while Next advertises `localhost`. Harmless; silence it with
  `allowedDevOrigins` in `next.config.ts` if it bothers you.
- **`npm install` prints `npm warn allow-scripts` for `sharp` and
  `unrs-resolver`.** npm 11 declines to run their install scripts until
  approved. Build, dev server and tests all work without approving them.

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
