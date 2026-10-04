// Run after local migrations: node tests/browser/review-2259ac6.mjs
// Uses the existing skill driver and mocked browser API responses. No DB writes.
/* global process, console, WebSocket, window, location, URL, Response, fetch, Buffer, setTimeout, clearTimeout */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const driver = spawn(
  process.execPath,
  [
    '.agents/skills/run-dividend-stock-analysis/driver.mjs',
    'repl',
    '--port',
    '3300',
    '--cdp-port',
    '9333',
    '--verbose',
  ],
  { stdio: ['pipe', 'pipe', 'pipe'] },
);
let output = '';
driver.stdout.on('data', (chunk) => {
  output += chunk;
});
driver.stderr.on('data', (chunk) => {
  output += chunk;
});
const finished = new Promise((resolveExit) => driver.on('exit', resolveExit));
let socket;
let sequence = 0;
const pending = new Map();
let checks = 0;

async function until(predicate, label, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await delay(80);
  }
  throw new Error(`Timed out: ${label}`);
}

function send(method, params = {}) {
  const id = ++sequence;
  return new Promise((resolveCall, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`CDP timeout: ${method}`));
    }, 15000);
    pending.set(id, { resolve: resolveCall, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const result = await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}

async function check(label, expression) {
  const actual = await evaluate(expression);
  if (actual !== true)
    console.error(await evaluate('({url: location.href, scrollY: window.scrollY})'));
  assert.equal(actual, true, label);
  checks++;
  console.log(`PASS ${label}`);
}

async function navigate(path, selector) {
  const base = output.match(/server ready at (http:\/\/[^\s]+)/)?.[1];
  assert.ok(base, 'Driver reported server address');
  const result = await send('Page.navigate', { url: `${base}${path}` });
  assert.equal(result.errorText, undefined);
  await until(() => evaluate(`!!document.querySelector(${JSON.stringify(selector)})`), selector);
  await delay(650);
}

async function click(selector) {
  const point = await evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) throw new Error('Missing click target');
    element.scrollIntoView({block: 'center', inline: 'center'});
    const r = element.getBoundingClientRect();
    return {x: r.x + r.width / 2, y: r.y + r.height / 2};
  })()`);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
  await delay(180);
  await send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    button: 'left',
    clickCount: 1,
    ...point,
  });
  await delay(16);
  await send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    button: 'left',
    clickCount: 1,
    ...point,
  });
  await delay(250);
}

async function screenshot(name) {
  const { data } = await send('Page.captureScreenshot', { format: 'png' });
  mkdirSync('tmp/shots', { recursive: true });
  writeFileSync(resolve('tmp/shots', `${name}.png`), Buffer.from(data, 'base64'));
}

function installMockApi(bands) {
  const originalFetch = window.fetch.bind(window);
  const companies = Array.from({ length: 40 }, (_, i) => ({
    code: String(1000 + i),
    name: `検証用の長い銘柄名${'株式会社'.repeat(8)}${i}`,
    totalScore: 55,
    maxTotalScore: 100,
    effectiveMetricCount: 9,
    totalMetricCount: 10,
    fetchedAt: '2026-10-04T00:00:00Z',
    priceSen: 123450,
    dividendYieldValue: 350,
    payoutRatioValue: 30,
  }));
  const portfolios = Array.from({ length: 8 }, (_, i) => ({
    id: `p${i}`,
    name: `${'長いポートフォリオ名'.repeat(5)}${i}`,
    holdingCount: 40,
  }));
  const side = {
    score: 8,
    value: 30,
    unavailableReason: null,
    dividendSen: 3000,
    dividendFiscalYear: 2026,
    epsSen: 10000,
    epsFiscalYear: 2026,
    fiscalYearMismatch: false,
    zeroScoreRule: null,
    matchedBandIndex: 0,
  };
  const scoring = {
    totalScore: 55,
    maxTotalScore: 100,
    effectiveMetricCount: 9,
    totalMetricCount: 10,
    dividendSource: 'forecast',
    payoutRatioSource: 'forecast',
    payoutRatioForecast: side,
    payoutRatioActual: side,
    payoutRatioBands: bands.metrics.find((m) => m.key === 'payoutRatio').bands,
    perSource: 'manual',
    pbrSource: 'manual',
    priceSen: 123450,
    per: 10,
    pbr: 1,
    fetchedAt: '2026-10-04T00:00:00Z',
    metrics: bands.metrics.map((metric, index) => ({
      ...metric,
      score: index === 8 ? null : index === 7 ? 0 : 8,
      value: index === 8 ? null : 30,
      unavailableReason: index === 8 ? 'missing-data' : null,
    })),
  };
  const detail = {
    id: 'p0',
    name: portfolios[0].name,
    metrics: {
      totalValueSen: 493800000,
      evaluableValueCount: 40,
      unrealizedGainLossSen: 100000,
      weightedYieldPercent: 3.5,
      costBasisYieldPercent: 3.5,
      yieldEvaluableHoldingCount: 40,
      scoreAverage: 55,
    },
    holdings: companies.map((company) => ({
      code: company.code,
      name: company.name,
      quantity: 100,
      acquisitionPriceSen: 120000,
      currentPriceSen: 123450,
      valueSen: 12345000,
      unrealizedGainLossSen: 345000,
      dividendYieldPercent: 3.5,
      totalScore: 55,
      maxTotalScore: 100,
      effectiveMetricCount: 9,
      totalMetricCount: 10,
    })),
  };
  window.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input.url, location.href);
    const json = (body, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      });
    if (!url.pathname.startsWith('/api/')) return originalFetch(input, init);
    if ((init?.method ?? 'GET') !== 'GET')
      return json({ error: 'Browser test blocks writes' }, 409);
    if (url.pathname === '/api/auth/me')
      return json({ user: { id: 1, email: 'test@example.invalid', role: 'admin' } });
    if (url.pathname === '/api/companies')
      return json({ companies, page: 1, perPage: 40, total: 40 });
    if (url.pathname.endsWith('/dividends'))
      return json({ error: 'Test dividend history is unavailable' }, 503);
    if (url.pathname.startsWith('/api/companies/')) return json(scoring);
    if (url.pathname === '/api/portfolios') return json({ portfolios, maxPortfolios: 10 });
    if (url.pathname.startsWith('/api/portfolios/')) return json(detail);
    if (url.pathname === '/api/scoring/bands') return json(bands);
    return json({ error: 'Unsupported browser test request' }, 404);
  };
}

try {
  await until(
    () => {
      if (driver.exitCode !== null) throw new Error(output);
      return output.includes('READY');
    },
    'driver ready',
    60000,
  );
  const cdpPort = output.match(/cdp port (\d+)/)?.[1];
  assert.ok(cdpPort);
  const targets = await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json();
  socket = new WebSocket(targets.find((target) => target.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolveOpen, reject) => {
    socket.addEventListener('open', resolveOpen, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    const call = pending.get(message.id);
    if (!call) return;
    clearTimeout(call.timer);
    pending.delete(message.id);
    if (message.error) call.reject(new Error(JSON.stringify(message.error)));
    else call.resolve(message.result);
  });
  await send('Page.enable');
  await send('Runtime.enable');
  const base = output.match(/server ready at (http:\/\/[^\s]+)/)[1];
  const bands = await (await fetch(`${base}/api/scoring/bands`)).json();
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `(${installMockApi})(${JSON.stringify(bands)})`,
  });
  await navigate('/', '.company-row');
  await check(
    'browser API fixture is active',
    'document.querySelector(".company-code").textContent === "1000"',
  );
  await evaluate(`(() => {
    const strip = sheet => {
      for (let i = sheet.cssRules.length - 1; i >= 0; i--) {
        const rule = sheet.cssRules[i];
        if (rule.selectorText?.includes(':has(')) sheet.deleteRule(i);
        else if (rule.cssRules) strip(rule);
      }
    };
    for (const sheet of document.styleSheets) strip(sheet);
  })()`);
  await click('.company-row .company-code');
  await check(
    'R-11 row click still works with every :has rule removed',
    'new URLSearchParams(location.search).get("code") === "1000"',
  );
  await click('.dialog-close');
  await navigate('/', '.company-row');
  await evaluate(
    `document.querySelector('.company-row:last-child .row-actions button:last-child').focus()`,
  );
  for (let i = 0; i < 40; i++) {
    await send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 'Tab',
      code: 'Tab',
      modifiers: 8,
      windowsVirtualKeyCode: 9,
    });
    await send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: 'Tab',
      code: 'Tab',
      modifiers: 8,
      windowsVirtualKeyCode: 9,
    });
    await check(
      `R-13 reverse keyboard focus stays below header (${i + 1})`,
      `document.activeElement.getBoundingClientRect().top >= document.querySelector('.app-header').getBoundingClientRect().bottom`,
    );
  }
  await navigate('/', '.company-row');

  for (const selector of [
    '.company-row .company-code',
    '.company-row .score-cell',
    '.company-row td.numeric',
  ]) {
    await click(selector);
    await until(() => evaluate('!!document.querySelector(".dialog-close")'), 'analysis dialog');
    await check(
      `R-01 mouse opens dialog from ${selector}`,
      'new URLSearchParams(location.search).get("code") === "1000"',
    );
    await click('.dialog-close');
  }
  await click('.company-row .score-bar-track');
  await until(() => evaluate('!!document.querySelector(".metric-row")'), 'metrics');
  await check('R-02 list score bar opens dialog', '!!document.querySelector(".dialog-close")');
  await check(
    'null and zero scores remain distinct',
    'document.querySelectorAll(".metric-row")[8].children[3].textContent.trim() === "—" && document.querySelectorAll(".metric-row")[7].children[3].textContent.includes("0 点")',
  );
  await until(
    () => evaluate('document.querySelectorAll(".radar-score-dot").length === 9'),
    'radar markers',
  );
  await check(
    'T-110 missing has no marker, zero and ordinary scores have markers',
    'document.querySelectorAll(".radar-score-dot[data-score=" + CSS.escape("0") + "]").length === 1 && document.querySelectorAll(".radar-score-dot[data-score=" + CSS.escape("8") + "]").length === 8',
  );
  for (const selector of ['.metric-row td[aria-hidden]', '.metric-row .score-bar-track']) {
    await click(selector);
    await check(
      `R-02 metric drill-down from ${selector}`,
      'new URLSearchParams(location.search).has("metric")',
    );
    await click('.dialog-header + button');
    await until(() => evaluate('!!document.querySelector(".metric-row")'), 'metric overview');
    await delay(650);
  }
  await screenshot('review-analysis');
  await click('.dialog-close');
  await check(
    'R-15 company tooltip has an unobstructed hit target',
    `(() => { const e = document.querySelector('.company-name-button'); const r = e.getBoundingClientRect(); return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) === e && e.title === e.textContent.trim() && getComputedStyle(e).userSelect === 'text'; })()`,
  );
  await evaluate(
    `(() => {const e = document.querySelector('.company-name-button'); const r = document.createRange(); r.selectNodeContents(e); window.getSelection().removeAllRanges(); window.getSelection().addRange(r); e.dispatchEvent(new MouseEvent('click', {bubbles: true, detail: 1}));})()`,
  );
  await check(
    'R-15 selection does not open a dialog',
    '!new URLSearchParams(location.search).has("code") && window.getSelection().toString().length > 0',
  );
  await evaluate('window.getSelection().removeAllRanges(); window.scrollTo(0, 1000)');
  await click('.nav a[href="/criteria"]');
  await until(() => evaluate('location.pathname === "/criteria"'), 'criteria route');
  await check('R-14 screen navigation resets scrolling', 'window.scrollY === 0');
  await check(
    'R-12 criteria note uses secondary text',
    `getComputedStyle(document.querySelector('.criteria-note')).color === 'rgb(152, 161, 176)'`,
  );

  let desktopSummarySizes;
  for (const width of [1280, 1100, 1000, 960, 800, 390]) {
    await send('Emulation.setDeviceMetricsOverride', {
      width,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await navigate('/portfolio', '.holding-row-actions');
    const summarySizes = await evaluate(
      `Array.from(document.querySelectorAll('.portfolio-summary dd')).slice(0, 2).map(e => parseFloat(getComputedStyle(e).fontSize))`,
    );
    if (width === 1280) desktopSummarySizes = summarySizes;
    if (width === 390) {
      assert.ok(summarySizes.every((size, i) => size < desktopSummarySizes[i]));
      console.log('PASS T-109 both mobile summary fonts shrink');
      checks++;
    }
    await check(
      `T-109 header visual order follows DOM at ${width}px`,
      `(() => {const elements = Array.from(document.querySelector('.app-header-inner').children); return elements.every((e, i) => {if (!i) return true; const a = elements[i - 1].getBoundingClientRect(), b = e.getBoundingClientRect(); return b.top > a.top || (Math.abs(b.top - a.top) < a.height && b.left >= a.right);});})()`,
    );
    await check(
      `R-04/R-08 portfolio stays within ${width}px`,
      'document.documentElement.scrollWidth <= window.innerWidth',
    );
    await check(
      `R-05 delete stays below tabs at ${width}px`,
      `document.querySelector('.portfolio-tabs + .portfolio-footer').getBoundingClientRect().top >= document.querySelector('.portfolio-tabs').getBoundingClientRect().bottom`,
    );
    await check(
      `R-03 valuation remains a numeric column at ${width}px`,
      `(() => {const cells = document.querySelector('.metric-row').children; return getComputedStyle(cells[4]).fontSize === getComputedStyle(cells[3]).fontSize && getComputedStyle(cells[4]).whiteSpace === 'nowrap';})()`,
    );
    await check(
      `R-06 navigation provides scrolling at ${width}px`,
      `getComputedStyle(document.querySelector('.nav')).scrollbarWidth === 'thin' && getComputedStyle(document.querySelector('.nav')).maskImage === 'none'`,
    );
    await screenshot(`review-portfolio-${width}`);
    await evaluate(
      `document.querySelector('.portfolio-summary').scrollIntoView({block: 'center'})`,
    );
    await screenshot(`review-summary-${width}`);
    await evaluate('window.scrollTo(0, 0)');
    await click('.portfolio-tabs-add');
    await until(
      () => evaluate('!!document.querySelector("#create-portfolio-title")'),
      'create dialog',
    );
    await check(
      `R-10 create form spacing at ${width}px`,
      `getComputedStyle(document.querySelector('#create-portfolio-title')).marginBottom === '16px' && getComputedStyle(document.querySelector('.dialog-card label')).display === 'flex'`,
    );
    await screenshot(`review-create-${width}`);
    await click('.dialog-card .button-outline');
    if (width === 1280 || width === 390) {
      await click('.holding-row-actions button:first-child');
      await check(
        `R-10 edit form spacing at ${width}px`,
        `getComputedStyle(document.querySelector('#edit-holding-title')).marginBottom === '16px' && getComputedStyle(document.querySelector('.dialog-card label')).display === 'flex'`,
      );
      await screenshot(`review-edit-${width}`);
      await click('.dialog-card .button-outline');
      await click('.metric-table + .portfolio-footer button');
      await check(
        `R-10 add form spacing at ${width}px`,
        `getComputedStyle(document.querySelector('#add-holding-title')).marginBottom === '16px' && getComputedStyle(document.querySelector('.dialog-card label')).display === 'flex'`,
      );
      await screenshot(`review-add-${width}`);
      await click('.dialog-card .button-outline');
    }
    await navigate('/', '.company-row');
    await evaluate(`document.querySelector('.company-row').classList.add('is-selected')`);
    await delay(200);
    const selectionColor = await evaluate(
      `getComputedStyle(document.querySelector('.company-row')).backgroundColor`,
    );
    const rowPoint = await evaluate(
      `(() => {const r = document.querySelector('.company-row').getBoundingClientRect(); return {x: r.x + 10, y: r.y + r.height / 2};})()`,
    );
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...rowPoint });
    await delay(200);
    await check(
      `T-109 selection survives hover at ${width}px`,
      `document.querySelector('.company-row').matches(':hover') && getComputedStyle(document.querySelector('.company-row')).backgroundColor === ${JSON.stringify(selectionColor)}`,
    );
    await check(
      `R-04 list stays within ${width}px`,
      'document.documentElement.scrollWidth <= window.innerWidth',
    );
    await screenshot(`review-search-${width}`);
    await click('.company-row .score-cell');
    await until(() => evaluate('!!document.querySelector(".metric-row")'), 'analysis overview');
    await check(
      `R-04 metric table stays inside dialog at ${width}px`,
      'document.querySelector(".dialog-card").scrollWidth <= document.querySelector(".dialog-card").clientWidth',
    );
    await screenshot(`review-analysis-${width}`);
  }

  await navigate('/input', '.company-form');
  await evaluate(
    `document.querySelector('.company-form input').setAttribute('aria-invalid', 'true')`,
  );
  const inputPoint = await evaluate(
    `(() => {const e = document.querySelector('.company-form input'); e.scrollIntoView({block: 'center'}); const r = e.getBoundingClientRect(); return {x: r.x + r.width / 2, y: r.y + r.height / 2};})()`,
  );
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...inputPoint });
  await delay(200);
  await check(
    'T-109 invalid input keeps caution border on hover',
    `(() => {const e = document.querySelector('.company-form input'); return e.matches(':hover') && getComputedStyle(e).borderTopColor === 'rgb(214, 161, 60)';})()`,
  );
  await evaluate(
    `(() => {const form = document.querySelector('.company-form'); const table = document.querySelector('.input-table'); const cell = table.querySelector('td'); const note = document.createElement('p'); note.className = 'warning'; note.setAttribute('role', 'alert'); note.textContent = '検証用セル警告'; cell.append(note); const banner = note.cloneNode(true); form.append(banner);})()`,
  );
  await check(
    'R-09 cell warnings stay inline while direct-child alerts remain banners',
    `(() => {const notes = document.querySelectorAll('.company-form .warning[role=alert]'); return getComputedStyle(notes[0]).padding === '0px' && getComputedStyle(notes[notes.length - 1]).padding === '16px';})()`,
  );
  await evaluate(
    `(() => {const e = document.querySelector('.company-form button[type=button]'); e.disabled = true;})()`,
  );
  await check(
    'R-07 importing buttons show disabled opacity',
    'getComputedStyle(document.querySelector(".company-form button[type=button]")).opacity === "0.6"',
  );
  await screenshot('review-input-390');

  console.log(`BROWSER PASS (${checks} assertions)`);
} catch (error) {
  console.error(error);
  if (socket?.readyState === WebSocket.OPEN) {
    console.error(await evaluate('({url: location.href})'));
    await screenshot('review-failure');
  }
  process.exitCode = 1;
} finally {
  socket?.close();
  driver.stdin.end('quit\n');
  const code = await finished;
  if (code !== 0) {
    console.error(output);
    process.exitCode = 1;
  }
}
