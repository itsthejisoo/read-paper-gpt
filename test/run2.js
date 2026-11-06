const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');

const BASE = process.env.APP_URL || 'http://127.0.0.1:8765/index.html';
const OUT = path.join(__dirname, 'out', process.env.RUN_NAME || 'run2');
fs.mkdirSync(OUT, { recursive: true });
const MOCK = fs.readFileSync(path.join(__dirname, 'mock-openai.js'), 'utf8');
const PDF = path.join(__dirname, 'fixtures', 'tiny.pdf');
const ARXIV = 'https://arxiv.org/abs/2601.01234v2';
const report = { base: BASE, scenarios: [] };
let browser;

async function scenario(name, cfg, fn) {
  const rec = { name, cfg, steps: [], errors: [], console: [] };
  report.scenarios.push(rec);
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: 'light', locale: 'ko-KR', acceptDownloads: true });
  await ctx.addInitScript(`window.__mockCfg = ${JSON.stringify(cfg)};`);
  await ctx.addInitScript(MOCK);
  const page = await ctx.newPage();
  page.on('console', m => { if (/^(error|warning)$/.test(m.type())) rec.console.push(`[${m.type()}] ${m.text()}`); });
  page.on('pageerror', e => rec.errors.push(e.message));
  const step = (n, data) => { rec.steps.push({ step: n, ...data }); console.log(`[${name}] ${n}: ${JSON.stringify(data).slice(0, 700)}`); };
  const shot = (file) => page.screenshot({ path: path.join(OUT, `${name}-${file}.png`), fullPage: true });
  try { await fn({ page, step, shot }); }
  catch (e) { rec.errors.push('SCENARIO FAILED: ' + e.message.split('\n')[0]); console.log(`[${name}] FAILED: ${e.message.split('\n')[0]}`); await page.screenshot({ path: path.join(OUT, `${name}-FAILED.png`) }).catch(() => {}); }
  await ctx.close();
}
async function login(page) {
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForFunction(() => document.getElementById('gate') && document.getElementById('gate').open, null, { timeout: 10000 });
  await page.fill('#api-key', 'sk-test-valid-key-123');
  await page.click('#btn-login');
  await page.waitForFunction(() => !document.getElementById('gate').open, null, { timeout: 10000 });
  await page.waitForTimeout(300);
}
async function start(page, url) { await page.fill('#url-input', url); await page.waitForTimeout(150); await page.click('#btn-start'); }
const job = (page) => page.evaluate(() => {
  const s = RPT.state; const j = s.currentJobId && s.jobs[s.currentJobId];
  return j ? { id: j.id, state: j.state, summaryStatus: j.summaryStatus, error: j.error, pageHint: j.pageHint, source: { type: j.source.type, fileId: j.source.fileId, fileDeleted: j.source.fileDeleted, blob: !!j.source.blobUrl, pdfUrl: j.source.pdfUrl }, chunks: j.chunks.map(c => ({ id: c.id, kind: c.kind, pages: [c.startPage, c.endPage], status: c.status, attempts: c.attempts, truncated: c.truncated, optional: c.optional, err: c.errorCode, msg: c.error, len: (c.text || '').length })), usage: j.usage } : null;
});
async function waitEnd(page, timeout = 60000) {
  await page.waitForFunction(() => { const s = RPT.state; const j = s.currentJobId && s.jobs[s.currentJobId]; return j && ['done', 'partial', 'failed', 'cancelled'].includes(j.state); }, null, { timeout });
  await page.waitForTimeout(600);
}
const calls = (page) => page.evaluate(() => window.__mockCalls.map(b => ({ task: b.metadata.task, chunk: b.metadata.chunk, effort: b.reasoning && b.reasoning.effort, verbosity: b.text && b.text.verbosity, hasReasoning: 'reasoning' in b, maxOut: b.max_output_tokens, file: b.input[0].content[0].file_id || b.input[0].content[0].file_url, pages: (b.input[0].content[2].text.match(/PDF 페이지 범위:\s*(\S+)/) || [])[1] })));
const chips = (page) => page.evaluate(() => [...document.querySelectorAll('#section-chips .status-chip')].map(c => c.dataset.status));
const ui = (page) => page.evaluate(() => ({ progress: document.getElementById('progress-text').textContent, strip: document.getElementById('progress-strip').dataset.state, cancelHidden: document.getElementById('btn-cancel').hidden, retryAllHidden: document.getElementById('btn-retry-all').hidden, gateOpen: document.getElementById('gate').open, gateError: document.getElementById('gate-error').textContent, key: localStorage.getItem('rpt.apiKey'), toasts: [...document.querySelectorAll('#toast-region *')].map(t => t.textContent.trim()).filter(Boolean).slice(0, 5) }));
const cards = (page) => page.evaluate(() => [...document.querySelectorAll('#tr-main article.section-card')].map(a => ({ id: a.id, status: a.dataset.status, badges: [...a.querySelectorAll('.badge, .status-chip, .flag, [class*="badge"]')].map(b => b.textContent.trim()).filter(Boolean).slice(0, 4), buttons: [...a.querySelectorAll('button')].map(b => b.textContent.trim()).filter(Boolean), h: [...a.querySelectorAll('h2,h3')].map(h => h.textContent.trim().slice(0, 40)).slice(0, 3), len: a.textContent.length })));

(async () => {
  browser = await chromium.launch({ channel: 'chrome', headless: true });

  await scenario('url-validation', {}, async ({ page, step }) => {
    await login(page);
    for (const [label, url] of [['scheme', 'hello world'], ['paywalled', 'https://ieeexplore.ieee.org/document/9999999'], ['scholar', 'https://scholar.google.com/scholar?q=attention'], ['unsupported', 'https://example.com/some/page']]) {
      await page.fill('#url-input', url);
      await page.waitForTimeout(150);
      const disabled = await page.evaluate(() => document.getElementById('btn-start').disabled);
      if (!disabled) { await page.click('#btn-start'); await page.waitForTimeout(800); }
      step(label, { disabled, error: await page.evaluate(() => ({ hidden: document.getElementById('url-error').hidden, text: document.getElementById('url-error').textContent })), hash: await page.evaluate(() => location.hash), calls: await page.evaluate(() => window.__mockCalls.length) });
    }
  });

  await scenario('upload', {}, async ({ page, step, shot }) => {
    await login(page);
    await page.setInputFiles('#file-input', PDF);
    await page.waitForTimeout(300);
    step('picked', { dzFileHidden: await page.evaluate(() => document.getElementById('dz-file').hidden), name: await page.evaluate(() => document.getElementById('dz-file-name').textContent), startDisabled: await page.evaluate(() => document.getElementById('btn-start').disabled) });
    await page.click('#btn-start');
    await waitEnd(page);
    step('job', await job(page));
    step('files-api', await page.evaluate(() => ({ uploads: window.__mockUploads, deletes: window.__mockDeletes })));
    step('calls', (await calls(page)).slice(0, 3));
    await page.click('#tab-translation'); await page.waitForTimeout(300);
    await page.click('#side-by-side'); await page.waitForTimeout(500);
    step('sbs', await page.evaluate(() => ({ src: (document.getElementById('pdf-frame').getAttribute('src') || '').slice(0, 30), frameHidden: document.getElementById('pdf-frame').hidden, fallbackHidden: document.getElementById('pdf-fallback').hidden })));
    await shot('sbs');
    await page.click('#tab-source'); await page.waitForTimeout(300);
    step('source', await page.evaluate(() => ({ src: (document.getElementById('source-frame').getAttribute('src') || '').slice(0, 30), label: document.getElementById('source-label').textContent })));
    await page.reload({ waitUntil: 'load' }); await page.waitForTimeout(1200);
    step('source-after-reload', await page.evaluate(() => ({ hash: location.hash, emptyHidden: document.getElementById('source-empty').hidden, text: document.getElementById('source-empty-text').textContent, reselectHidden: document.getElementById('btn-source-reselect').hidden, frameHidden: document.getElementById('source-frame').hidden })));
    await page.setInputFiles('#source-file-input', PDF); await page.waitForTimeout(500);
    step('source-reselected', await page.evaluate(() => ({ src: (document.getElementById('source-frame').getAttribute('src') || '').slice(0, 30), emptyHidden: document.getElementById('source-empty').hidden, frameHidden: document.getElementById('source-frame').hidden })));
  });

  await scenario('cancel-retry', { slowTranslate: true }, async ({ page, step, shot }) => {
    await login(page);
    await start(page, ARXIV);
    await page.waitForFunction(() => { const s = RPT.state; const j = s.currentJobId && s.jobs[s.currentJobId]; return j && j.state === 'running' && j.chunks.some(c => c.status === 'running' && c.text.length > 50); }, null, { timeout: 30000 });
    step('before-cancel', { chips: await chips(page), ui: await ui(page) });
    await page.click('#btn-cancel');
    await page.waitForTimeout(900);
    step('after-cancel', { job: await job(page), chips: await chips(page), ui: await ui(page), calls: (await calls(page)).length });
    await page.click('#tab-translation'); await page.waitForTimeout(300);
    step('cards-after-cancel', await cards(page));
    await shot('cancelled');
    await page.evaluate(() => { window.__mockCfg.slowTranslate = false; });
    await page.click('#btn-retry-all');
    await waitEnd(page);
    step('after-retry', { job: await job(page), chips: await chips(page), ui: await ui(page), calls: (await calls(page)).length });
  });

  await scenario('auth-401-midjob', { auth401AfterCalls: 2 }, async ({ page, step, shot }) => {
    await login(page);
    await start(page, ARXIV);
    await page.waitForFunction(() => document.getElementById('gate').open, null, { timeout: 30000 });
    await page.waitForTimeout(1200);
    step('gate-reopened', { job: await job(page), ui: await ui(page), calls: (await calls(page)).length, chips: await chips(page) });
    await shot('gate');
    await page.evaluate(() => { window.__mockCfg.auth401AfterCalls = 0; });
    await page.fill('#api-key', 'sk-test-valid-key-456');
    await page.click('#btn-login');
    await page.waitForFunction(() => !document.getElementById('gate').open, null, { timeout: 10000 });
    await page.waitForTimeout(500);
    step('relogin', { ui: await ui(page), hash: await page.evaluate(() => location.hash), job: (await job(page)).state });
    if (!(await page.evaluate(() => document.getElementById('btn-retry-all').hidden))) { await page.click('#btn-retry-all'); await waitEnd(page); step('after-retry', { job: await job(page), chips: await chips(page), calls: (await calls(page)).length }); }
  });

  await scenario('param-strip', { unsupportedParamOnce: true }, async ({ page, step }) => {
    await login(page);
    await start(page, ARXIV);
    await waitEnd(page);
    const c = await calls(page);
    const j = await job(page);
    step('calls', { first4: c.slice(0, 4), state: j.state, summaryStatus: j.summaryStatus, chunkStates: j.chunks.map(x => x.status) });
  });

  await scenario('summary-incomplete', { summaryIncompleteOnce: true }, async ({ page, step }) => {
    await login(page);
    await start(page, ARXIV);
    await waitEnd(page);
    const c = (await calls(page)).filter(x => x.task === 'summary');
    step('summary-calls', { calls: c, job: (({ state, summaryStatus, error }) => ({ state, summaryStatus, error }))(await job(page)), statusHidden: await page.evaluate(() => document.getElementById('summary-status').hidden), statusText: await page.evaluate(() => document.getElementById('summary-status-text').textContent), metricRows: await page.evaluate(() => document.querySelectorAll('#viz-metrics tbody tr').length), tldr: await page.evaluate(() => document.getElementById('summary-tldr').textContent.slice(0, 40)) });
  });

  await scenario('translate-incomplete', { translateIncompleteOnce: true, rateLimitOnce: false }, async ({ page, step, shot }) => {
    await login(page);
    await start(page, ARXIV);
    await waitEnd(page, 90000);
    const c = (await calls(page)).filter(x => x.task === 'translate');
    step('translate-calls', { calls: c, job: await job(page) });
    await page.click('#tab-translation'); await page.waitForTimeout(500);
    step('cards', await cards(page));
    await shot('cards');
  });

  await scenario('appendix-off-manual', {}, async ({ page, step }) => {
    await login(page);
    await page.fill('#url-input', ARXIV);
    await page.uncheck('#include-appendix');
    await page.click('#btn-start');
    await waitEnd(page);
    step('job', { job: await job(page), chips: await chips(page), ui: await ui(page) });
    await page.click('#tab-translation'); await page.waitForTimeout(400);
    const app = (await job(page)).chunks.find(c => c.kind === 'appendix');
    const cardInfo = app ? (await cards(page)).find(c => c.id === 'sec-' + app.id) : null;
    step('appendix-card', { chunk: app, card: cardInfo });
    if (app) {
      await page.click(`#sec-${app.id} button:has-text("번역")`);
      await page.waitForFunction((id) => { const s = RPT.state; const j = s.jobs[s.currentJobId]; const c = j.chunks.find(c => c.id === id); return c && c.status === 'done'; }, app.id, { timeout: 30000 });
      await page.waitForTimeout(600);
      step('appendix-translated', { job: (({ state, chunks }) => ({ state, chunks: chunks.map(c => c.id + ':' + c.status) }))(await job(page)), ui: await ui(page), calls: (await calls(page)).length });
    }
  });

  await scenario('shortcuts-history-delete', {}, async ({ page, step, shot }) => {
    await login(page);
    await start(page, ARXIV);
    await waitEnd(page);
    const tab = () => page.evaluate(() => ({ sel: document.querySelector('#tabs [aria-selected="true"]').id, hash: location.hash }));
    await page.keyboard.press('2'); await page.waitForTimeout(200); const t2 = await tab();
    await page.keyboard.press('3'); await page.waitForTimeout(200); const t3 = await tab();
    await page.keyboard.press('1'); await page.waitForTimeout(200); const t1 = await tab();
    await page.keyboard.press(','); await page.waitForTimeout(300); const settingsOpen = await page.evaluate(() => document.getElementById('settings').open);
    await page.keyboard.press('Escape'); await page.waitForTimeout(200);
    step('shortcuts', { t2, t3, t1, settingsOpen });
    await page.evaluate(() => { location.hash = '#home'; }); await page.waitForTimeout(500);
    step('history-before', { items: await page.evaluate(() => document.querySelectorAll('#history-list li').length), stored: await page.evaluate(() => RPT.store.loadHistory().length) });
    await page.click('#history-list li .actions button:nth-child(2)'); await page.waitForTimeout(300);
    step('confirm', { open: await page.evaluate(() => document.getElementById('confirm').open), title: await page.evaluate(() => document.getElementById('confirm-title').textContent) });
    if (await page.evaluate(() => document.getElementById('confirm').open)) await page.click('#confirm-ok');
    await page.waitForTimeout(600);
    step('history-after', { items: await page.evaluate(() => document.querySelectorAll('#history-list li').length), emptyHidden: await page.evaluate(() => document.getElementById('history-empty').hidden), stored: await page.evaluate(() => RPT.store.loadHistory().length), jobsInState: await page.evaluate(() => Object.keys(RPT.state.jobs).length) });
    await shot('home-after-delete');
  });

  await browser.close();
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 1));
  for (const s of report.scenarios) console.log(`== ${s.name}: errors=${JSON.stringify(s.errors)} console=${JSON.stringify(s.console.slice(0, 4))}`);
})().catch(e => { console.error('RUN FAILED:', e); fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 1)); process.exit(1); });
