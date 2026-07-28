#!/usr/bin/env node
// Zero-dependency browser driver for DividendStockAnalysis.
//
// Drives a headless Chrome over the DevTools Protocol using only Node
// built-ins (global fetch + global WebSocket, both stable in Node 22+).
// We do NOT depend on Playwright/Puppeteer: the project has no e2e
// dependency and adding a ~130 MB browser download for a smoke test is
// not worth it when Chrome is already installed on the machine.
//
//   node driver.mjs smoke              # start dev server, screenshot, assert, exit
//   node driver.mjs repl               # interactive: commands on stdin
//
// See .claude/skills/run-dividend-stock-analysis/SKILL.md

import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

// ---------------------------------------------------------------- config

const CHROME_CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  `${process.env.LOCALAPPDATA}/Google/Chrome/Application/chrome.exe`,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
];

const args = process.argv.slice(2);
const mode = args[0] ?? 'smoke';
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};
const has = (name) => args.includes(`--${name}`);

const UNIT = resolve(flag('unit', process.cwd()));
const OUT = resolve(flag('out', join(UNIT, 'tmp', 'shots')));
const VERBOSE = has('verbose');

// Ports are resolved at startup, not hardcoded. Some dev servers silently
// increment past a busy port, which desynchronises them from whatever URL we
// then poll — so we find a free one ourselves and pass it explicitly.
let PORT, CDP_PORT, BASE;

const log = (...a) => console.log(...a);
const vlog = (...a) => VERBOSE && console.log('   ·', ...a);

// ---------------------------------------------------------------- helpers

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function portFree(port) {
  return new Promise((res) => {
    const s = createServer();
    s.once('error', () => res(false));
    s.once('listening', () => s.close(() => res(true)));
    s.listen(port, '127.0.0.1');
  });
}

async function findFreePort(preferred) {
  for (let p = preferred; p < preferred + 50; p++) {
    if (await portFree(p)) return p;
  }
  throw new Error(`No free port in ${preferred}..${preferred + 49}`);
}

function findChrome() {
  const override = process.env.CHROME_PATH;
  if (override) {
    if (!existsSync(override)) throw new Error(`CHROME_PATH does not exist: ${override}`);
    return override;
  }
  const found = CHROME_CANDIDATES.find((p) => existsSync(p));
  if (!found) {
    throw new Error(
      'No Chrome/Edge found. Set CHROME_PATH to the browser executable.\nTried:\n  ' +
        CHROME_CANDIDATES.join('\n  '),
    );
  }
  return found;
}

// Windows: child.kill() leaves the process tree behind (npm -> node ->
// wrangler -> workerd, chrome -> renderers). taskkill /T does not. Resolves
// only once the process is actually gone, otherwise the caller races it
// deleting locked files.
function killTree(child) {
  if (!child || child.exitCode !== null) return Promise.resolve();
  child.stopping = true; // so the exit handler knows this was deliberate
  const exited = new Promise((r) => {
    child.once('exit', r);
    setTimeout(r, 10_000); // don't hang teardown on a wedged process
  });
  if (process.platform === 'win32') {
    spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      child.kill('SIGKILL');
    }
  }
  return exited;
}

// Chrome keeps a lock on its profile for a moment after exit -> EPERM.
async function removeWithRetry(dir) {
  for (let i = 0; i < 10; i++) {
    try {
      rmSync(dir, { recursive: true, force: true });
      return;
    } catch {
      await sleep(200);
    }
  }
  // A stray temp profile is harmless; never fail teardown over it.
  vlog(`could not remove temp profile ${dir} (left on disk)`);
}

async function waitForHttp(url, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  let lastErr = 'no attempt made';
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok || res.status < 500) return res;
      lastErr = `HTTP ${res.status}`;
    } catch (e) {
      lastErr = e.message;
    }
    await sleep(250);
  }
  throw new Error(`Timed out after ${timeoutMs}ms waiting for ${label} (${url}): ${lastErr}`);
}

// ---------------------------------------------------------------- dev server

async function startServer() {
  // `dev` runs `vite build && wrangler dev`, i.e. a real Workers runtime
  // (workerd) with Assets + D1, not a framework-specific dev mode. There is
  // no separate "production" server to run locally — `npm run build` only
  // produces a `wrangler deploy --dry-run` bundle, it does not serve it — so
  // there is nothing for a `--prod` flag to start.
  log(`→ npm run dev (port ${PORT})`);
  const child = spawn(`npm run dev -- --port ${PORT}`, {
    cwd: UNIT,
    shell: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (d) => {
    output += d;
    vlog(String(d).trimEnd());
  });
  child.stderr.on('data', (d) => {
    output += d;
    vlog(String(d).trimEnd());
  });
  child.on('exit', (code) => {
    if (!child.stopping && code !== 0 && code !== null) {
      console.error(`\nDev server exited early (code ${code}). Output:\n${output}`);
    }
  });

  await waitForHttp(BASE, 90_000, 'wrangler dev server');
  log(`   server ready at ${BASE}`);
  return child;
}

// ---------------------------------------------------------------- CDP

class Cdp {
  #ws;
  #id = 0;
  #pending = new Map();

  static async launch() {
    const exe = findChrome();
    const profile = join(tmpdir(), `dsa-cdp-${process.pid}`);
    rmSync(profile, { recursive: true, force: true });
    mkdirSync(profile, { recursive: true });

    log(`→ launching ${exe.split(/[\\/]/).pop()} headless (CDP ${CDP_PORT})`);
    const child = spawn(
      exe,
      [
        '--headless=new',
        `--remote-debugging-port=${CDP_PORT}`,
        `--user-data-dir=${profile}`,
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-gpu',
        '--disable-extensions',
        // Renderer dies on some Windows sandbox configs under a service account.
        '--no-sandbox',
        '--window-size=1280,900',
        'about:blank',
      ],
      { stdio: 'ignore' },
    );

    // /json/version answers as soon as the DevTools endpoint is listening.
    await waitForHttp(`http://127.0.0.1:${CDP_PORT}/json/version`, 30_000, 'chrome devtools');

    const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
    const page = list.find((t) => t.type === 'page');
    if (!page) throw new Error(`No page target. Targets: ${JSON.stringify(list)}`);

    const cdp = new Cdp();
    cdp.child = child;
    cdp.profile = profile;
    await cdp.#connect(page.webSocketDebuggerUrl);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1280,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });
    return cdp;
  }

  #connect(url) {
    return new Promise((res, rej) => {
      const ws = new WebSocket(url);
      this.#ws = ws;
      ws.addEventListener('open', () => res());
      ws.addEventListener('error', (e) => rej(new Error(`CDP socket error: ${e.message ?? e}`)));
      ws.addEventListener('message', (ev) => {
        const msg = JSON.parse(ev.data);
        if (msg.id && this.#pending.has(msg.id)) {
          const { resolve: ok, reject: no, timer } = this.#pending.get(msg.id);
          clearTimeout(timer);
          this.#pending.delete(msg.id);
          if (msg.error)
            no(new Error(`${msg.error.message} (${JSON.stringify(msg.error.data ?? {})})`));
          else ok(msg.result);
        }
      });
    });
  }

  send(method, params = {}, timeoutMs = 30_000) {
    const id = ++this.#id;
    return new Promise((ok, no) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        no(new Error(`CDP ${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.#pending.set(id, { resolve: ok, reject: no, timer });
      this.#ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async goto(url) {
    // Page.navigate RESOLVES on a failed navigation and reports the failure in
    // `errorText` instead of rejecting. Not checking it turns a connection
    // refusal into a mystery 30s readyState timeout.
    const nav = await this.send('Page.navigate', { url });
    if (nav.errorText) throw new Error(`navigation failed: ${nav.errorText} (${url})`);

    // Poll readyState rather than racing Page.loadEventFired, which can fire
    // before we subscribe when the server is local and fast.
    const deadline = Date.now() + 30_000;
    let state;
    while (Date.now() < deadline) {
      state = await this.evaluate('document.readyState');
      if (state === 'complete') return;
      await sleep(100);
    }
    const href = await this.evaluate('location.href').catch(() => '<unavailable>');
    throw new Error(
      `Page did not reach readyState=complete (last state: ${state}, at: ${href}) for ${url}`,
    );
  }

  async evaluate(expression) {
    const r = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (r.exceptionDetails) {
      throw new Error(
        `eval threw: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`,
      );
    }
    return r.result.value;
  }

  async waitFor(selector, timeoutMs = 15_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await this.evaluate(`!!document.querySelector(${JSON.stringify(selector)})`)) return true;
      await sleep(100);
    }
    throw new Error(`Selector not found within ${timeoutMs}ms: ${selector}`);
  }

  async click(selector) {
    await this.waitFor(selector);
    const box = await this.evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      el.scrollIntoView({ block: 'center' });
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`);
    for (const type of ['mousePressed', 'mouseReleased']) {
      await this.send('Input.dispatchMouseEvent', {
        type,
        x: box.x,
        y: box.y,
        button: 'left',
        clickCount: 1,
      });
    }
  }

  async type(selector, text) {
    await this.waitFor(selector);
    await this.evaluate(`document.querySelector(${JSON.stringify(selector)}).focus()`);
    await this.send('Input.insertText', { text });
    // React listens for `input`; insertText alone does not always notify it.
    await this.evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      el.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
  }

  async screenshot(name) {
    mkdirSync(OUT, { recursive: true });
    const { data } = await this.send('Page.captureScreenshot', { format: 'png' });
    const file = join(OUT, name.endsWith('.png') ? name : `${name}.png`);
    writeFileSync(file, Buffer.from(data, 'base64'));
    const bytes = Buffer.from(data, 'base64').length;
    return { file, bytes };
  }

  async close() {
    try {
      this.#ws?.close();
    } catch {
      /* socket already gone; nothing to clean up */
    }
    await killTree(this.child);
    await removeWithRetry(this.profile);
  }
}

// ---------------------------------------------------------------- modes

async function smoke() {
  let server, cdp;
  const failures = [];
  const check = (name, ok, detail) => {
    log(`   ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
    if (!ok) failures.push(name);
  };

  try {
    server = await startServer();
    cdp = await Cdp.launch();

    log(`→ GET ${BASE}/`);
    await cdp.goto(`${BASE}/`);

    const title = await cdp.evaluate('document.title');
    check('page has a title', typeof title === 'string' && title.length > 0, JSON.stringify(title));

    const lang = await cdp.evaluate('document.documentElement.lang');
    check('html lang is ja', lang === 'ja', JSON.stringify(lang));

    const bodyText = await cdp.evaluate('document.body.innerText');
    check('body is not empty', bodyText.trim().length > 0, `${bodyText.trim().length} chars`);

    // The disclaimer is a P0 product requirement (F-34): it must always render.
    check(
      'disclaimer text is present',
      /投資判断|免責/.test(bodyText),
      /投資判断|免責/.test(bodyText) ? 'found' : `body was: ${bodyText.slice(0, 120)}`,
    );

    const shot = await cdp.screenshot('home');
    check('screenshot written', shot.bytes > 5000, `${shot.file} (${shot.bytes} bytes)`);

    log(`\n${failures.length === 0 ? 'SMOKE PASS' : `SMOKE FAIL: ${failures.join(', ')}`}`);
    return failures.length === 0 ? 0 : 1;
  } catch (e) {
    console.error(`\nSMOKE ERROR: ${e.message}`);
    return 1;
  } finally {
    // Teardown must never throw: an exception here skips the remaining
    // cleanup and strands the dev server holding the port.
    await cdp?.close().catch((e) => vlog(`browser teardown: ${e.message}`));
    await killTree(server).catch((e) => vlog(`server teardown: ${e.message}`));
  }
}

// A function, not a const: BASE is only known after ports are resolved in main.
const replHelp = () => `commands:
  goto <url|path>     navigate (bare path is resolved against ${BASE})
  ss <name>           screenshot -> ${OUT}
  text [selector]     innerText of selector (default: body)
  html <selector>     outerHTML of selector
  click <selector>    real mouse click at element center
  type <sel> <text>   focus, insert text, fire an input event
  wait <selector>     poll until selector exists (15s)
  eval <js>           Runtime.evaluate, returns JSON
  title               document.title
  url                 location.href
  help / quit`;

async function repl() {
  let server, cdp;
  try {
    if (!has('no-serve')) server = await startServer();
    cdp = await Cdp.launch();
    await cdp.goto(`${BASE}/`);
    log(replHelp());
    log('READY'); // marker for tmux/CI polling

    const rl = createInterface({ input: process.stdin, terminal: false });
    for await (const line of rl) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const [cmd, ...rest] = trimmed.split(/\s+/);
      const arg = trimmed.slice(cmd.length).trim();
      try {
        switch (cmd) {
          case 'goto':
            await cdp.goto(
              arg.startsWith('http') ? arg : `${BASE}${arg.startsWith('/') ? arg : `/${arg}`}`,
            );
            log(`OK ${await cdp.evaluate('location.href')}`);
            break;
          case 'ss': {
            const s = await cdp.screenshot(arg || 'shot');
            log(`OK ${s.file} (${s.bytes} bytes)`);
            break;
          }
          case 'text':
            log(
              await cdp.evaluate(
                `document.querySelector(${JSON.stringify(arg || 'body')}).innerText`,
              ),
            );
            break;
          case 'html':
            log(await cdp.evaluate(`document.querySelector(${JSON.stringify(arg)}).outerHTML`));
            break;
          case 'click':
            await cdp.click(arg);
            log(`OK clicked ${arg}`);
            break;
          case 'type': {
            const sel = rest[0];
            await cdp.type(sel, arg.slice(sel.length).trim());
            log(`OK typed into ${sel}`);
            break;
          }
          case 'wait':
            await cdp.waitFor(arg);
            log(`OK ${arg} present`);
            break;
          case 'eval':
            log(JSON.stringify(await cdp.evaluate(arg)));
            break;
          case 'title':
            log(await cdp.evaluate('document.title'));
            break;
          case 'url':
            log(await cdp.evaluate('location.href'));
            break;
          case 'help':
            log(replHelp());
            break;
          case 'quit':
          case 'exit':
            rl.close();
            return 0;
          default:
            log(`ERR unknown command: ${cmd} (try 'help')`);
        }
      } catch (e) {
        log(`ERR ${e.message}`);
      }
    }
    return 0;
  } finally {
    // Teardown must never throw: an exception here skips the remaining
    // cleanup and strands the dev server holding the port.
    await cdp?.close().catch((e) => vlog(`browser teardown: ${e.message}`));
    await killTree(server).catch((e) => vlog(`server teardown: ${e.message}`));
  }
}

// ---------------------------------------------------------------- main

const modes = { smoke, repl };
if (!modes[mode]) {
  console.error(`unknown mode "${mode}". Use: smoke | repl`);
  process.exit(2);
}

PORT = await findFreePort(Number(flag('port', 3000)));
CDP_PORT = await findFreePort(Number(flag('cdp-port', 9222)));
BASE = `http://127.0.0.1:${PORT}`;
vlog(`app port ${PORT}, cdp port ${CDP_PORT}`);

process.exit(await modes[mode]());
