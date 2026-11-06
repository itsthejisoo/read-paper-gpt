const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');

const BASE = process.env.APP_URL || 'http://127.0.0.1:8765/index.html';
const OUT = path.join(__dirname, 'out', process.env.RUN_NAME || 'run');
fs.mkdirSync(OUT, { recursive: true });
const MOCK = fs.readFileSync(path.join(__dirname, 'mock-openai.js'), 'utf8');

const report = { base: BASE, steps: [], console: [], errors: [] };
const step = (name, data) => { report.steps.push({ name, ...data }); console.log(`[step] ${name}: ${JSON.stringify(data).slice(0, 600)}`); };
const shot = (page, name, full) => page.screenshot({ path: path.join(OUT, name), fullPage: !!full });

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: 'light', locale: 'ko-KR', acceptDownloads: true });
  await ctx.addInitScript(MOCK);
  const page = await ctx.newPage();
  page.on('console', m => report.console.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', e => report.errors.push(e.message));

  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForTimeout(1500);
  step('libs', await page.evaluate(() => ({ marked: typeof marked, DOMPurify: typeof DOMPurify, katex: typeof katex, renderMathInElement: typeof renderMathInElement, Chart: typeof Chart, RPT_PROMPTS: typeof RPT_PROMPTS, RPT: typeof RPT, version: window.RPT && RPT.version, mock: window.__mockInstalled })));

  step('gate-open-on-first-load', { gateOpen: await page.evaluate(() => document.getElementById('gate').open), loginDisabled: await page.evaluate(() => document.getElementById('btn-login').disabled) });
  await shot(page, '01-gate.png');

  await page.fill('#api-key', 'sk-BADKEY-0000');
  await page.click('#btn-login');
  await page.waitForTimeout(800);
  step('bad-key-error', { text: await page.evaluate(() => document.getElementById('gate-error').textContent.trim()), hidden: await page.evaluate(() => document.getElementById('gate-error').hidden), gateStillOpen: await page.evaluate(() => document.getElementById('gate').open), storedKey: await page.evaluate(() => localStorage.getItem('rpt.apiKey')) });
  await shot(page, '02-gate-error.png');

  await page.fill('#api-key', 'sk-test-valid-key-123');
  await page.click('#btn-login');
  await page.waitForFunction(() => !document.getElementById('gate').open, null, { timeout: 10000 });
  await page.waitForTimeout(500);
  step('login-ok', { storedKey: await page.evaluate(() => !!localStorage.getItem('rpt.apiKey')), modelOptions: await page.evaluate(() => [...document.querySelectorAll('#model-select option')].map(o => o.value)), selected: await page.evaluate(() => document.getElementById('model-select').value), badge: await page.evaluate(() => document.getElementById('model-badge').textContent.trim()) });
  await shot(page, '03-home.png', true);

  await page.fill('#url-input', 'https://arxiv.org/abs/2601.01234v2');
  await page.waitForTimeout(200);
  step('start-enabled', { disabled: await page.evaluate(() => document.getElementById('btn-start').disabled), normalized: await page.evaluate(() => { try { return JSON.stringify(RPT.normalizeUrl('https://arxiv.org/abs/2601.01234v2')); } catch (e) { return 'ERR ' + e.message; } }) });
  await page.click('#btn-start');
  const t0 = Date.now();
  await page.waitForTimeout(1500);
  step('progress-early', { hash: await page.evaluate(() => location.hash), stripState: await page.evaluate(() => document.getElementById('progress-strip').dataset.state), text: await page.evaluate(() => document.getElementById('progress-text').textContent) });
  await shot(page, '04a-progress.png');
  await page.waitForFunction(() => {
    const s = window.RPT && RPT.state; if (!s || !s.currentJobId) return false;
    const j = s.jobs[s.currentJobId]; if (!j) return false;
    return ['done', 'partial', 'failed', 'cancelled'].includes(j.state);
  }, null, { timeout: 90000 }).catch(e => report.errors.push('job did not finish: ' + e.message));
  await page.waitForTimeout(800);
  const jobInfo = await page.evaluate(() => {
    const s = RPT.state; const j = s.jobs[s.currentJobId];
    return j ? { state: j.state, summaryStatus: j.summaryStatus, summaryError: j.summaryError, error: j.error, title: j.outline && j.outline.meta && j.outline.meta.title_ko, glossaryLen: (j.glossaryStr || '').length, chunks: j.chunks.map(c => ({ id: c.id, kind: c.kind, title: c.titleEn, pages: [c.startPage, c.endPage], part: c.partIndex + '/' + c.partCount, status: c.status, len: (c.text || '').length, attempts: c.attempts, truncated: c.truncated, err: c.errorCode })), usage: j.usage } : null;
  });
  step('job', { ms: Date.now() - t0, ...jobInfo });
  step('mock-calls', await page.evaluate(() => window.__mockCalls.map(b => ({ task: b.metadata && b.metadata.task, chunk: b.metadata && b.metadata.chunk, model: b.model, stream: !!b.stream, effort: b.reasoning && b.reasoning.effort, verbosity: b.text && b.text.verbosity, format: b.text && b.text.format && b.text.format.name, strict: b.text && b.text.format && b.text.format.strict, store: b.store, cacheKey: b.prompt_cache_key, safety: !!b.safety_identifier, maxOut: b.max_output_tokens, filePart: (b.input[0].content[0] || {}).type + ':' + ((b.input[0].content[0] || {}).file_url || (b.input[0].content[0] || {}).file_id), detail: (b.input[0].content[0] || {}).detail, parts: b.input[0].content.length, hasTemp: 'temperature' in b, obf: b.stream_options && b.stream_options.include_obfuscation }))));
  step('cache-prefix', await page.evaluate(() => {
    const calls = window.__mockCalls;
    const key = b => JSON.stringify([b.instructions, b.input[0].content[0], b.input[0].content[1].text]);
    const groups = {};
    for (const b of calls) { const t = b.metadata.task; (groups[t] = groups[t] || new Set()).add(key(b)); }
    return Object.fromEntries(Object.entries(groups).map(([t, s]) => [t, s.size]));
  }));

  await page.click('#tab-summary');
  await page.waitForTimeout(1200);
  step('summary-dom', await page.evaluate(() => {
    const q = s => document.querySelector(s);
    const txt = s => (q(s) ? q(s).textContent.trim().slice(0, 160) : null);
    return {
      headings: [...document.querySelectorAll('#panel-summary .sum-section > h3')].map(h => h.textContent.trim()),
      glance: [...document.querySelectorAll('#glance-strip li p')].map(p => p.textContent.trim().slice(0, 60)),
      pipelineSteps: document.querySelectorAll('#viz-pipeline .pipe-step').length,
      metricRows: document.querySelectorAll('#viz-metrics tbody tr').length,
      metricBars: document.querySelectorAll('#viz-metrics .bar, #viz-metrics [class*="bar"]').length,
      deltaChips: [...document.querySelectorAll('#viz-metrics .delta')].map(d => d.textContent.trim() + '|' + d.dataset.dir + '|' + (d.dataset.tone || '')),
      radarCanvas: !!q('#viz-radar canvas'), radarTableRows: document.querySelectorAll('#viz-radar .table-twin tbody tr').length, radarCaption: txt('#viz-radar figcaption'),
      pros: document.querySelectorAll('#viz-proscons .proscons > :first-child li').length, cons: document.querySelectorAll('#viz-proscons .proscons > :last-child li').length,
      techChips: document.querySelectorAll('#viz-tech .tech-chip').length, techGroups: document.querySelectorAll('#viz-tech .tech-group').length,
      katexInSummary: document.querySelectorAll('#panel-summary .katex').length,
      rawDollarInSummary: /\$[^$]+\$/.test(q('#panel-summary').textContent),
      tldr: txt('#summary-tldr'), titleKo: txt('#summary-title-ko'), titleEn: txt('#summary-title-en'), authors: txt('#summary-authors'), venue: txt('#summary-venue'), keywords: document.querySelectorAll('#summary-keywords li').length,
      meta: txt('#result-meta'), paperTitle: txt('#paper-title'), sourceLink: q('#source-link') && q('#source-link').getAttribute('href'),
      summaryStatusHidden: q('#summary-status').hidden,
      mdLens: ['problem', 'method', 'results', 'limits', 'tech'].map(k => (q('#md-' + k) || { textContent: '' }).textContent.length),
    };
  }));
  await shot(page, '04-summary.png', true);

  await page.click('#tab-translation');
  await page.waitForTimeout(1200);
  step('translation-dom', await page.evaluate(() => ({
    cards: [...document.querySelectorAll('#tr-main article.section-card')].map(a => ({ id: a.id, status: a.dataset.status, katex: a.querySelectorAll('.katex').length, tables: a.querySelectorAll('table').length, pre: a.querySelectorAll('pre').length, scripts: a.querySelectorAll('script').length, h2: [...a.querySelectorAll('h2,h3')].slice(0, 2).map(h => h.textContent.trim().slice(0, 60)), textLen: a.textContent.length, hasRawDollar: /\$\$/.test(a.textContent), hasAlert: /alert\("xss"\)/.test(a.innerHTML), tailLen: (a.querySelector('.md--tail') || { innerHTML: '' }).innerHTML.length, errHidden: (a.querySelector('.err, .card-error') || {}).hidden })),
    toc: [...document.querySelectorAll('#toc-list li')].map(l => l.textContent.trim().slice(0, 40)),
    chips: [...document.querySelectorAll('#section-chips .status-chip')].map(c => c.dataset.status),
    progressText: document.getElementById('progress-text').textContent,
    stripState: document.getElementById('progress-strip').dataset.state,
    retryHidden: document.getElementById('btn-retry-all').hidden,
    cancelHidden: document.getElementById('btn-cancel').hidden,
    trEmptyHidden: document.getElementById('tr-empty').hidden,
  })));
  await shot(page, '05-translation.png', true);

  await page.click('#side-by-side');
  await page.waitForTimeout(800);
  step('side-by-side', { sbs: await page.evaluate(() => document.getElementById('tr-layout').dataset.sbs), paneHidden: await page.evaluate(() => document.getElementById('pdf-pane').hidden), frameSrc: await page.evaluate(() => document.getElementById('pdf-frame').getAttribute('src')), frameHidden: await page.evaluate(() => document.getElementById('pdf-frame').hidden), fallbackHidden: await page.evaluate(() => document.getElementById('pdf-fallback').hidden) });
  await shot(page, '06-sbs.png');
  await page.click('#side-by-side');

  await page.click('#tab-source');
  await page.waitForTimeout(500);
  step('source-tab', { frameSrc: await page.evaluate(() => document.getElementById('source-frame').getAttribute('src')), label: await page.evaluate(() => document.getElementById('source-label').textContent), emptyHidden: await page.evaluate(() => document.getElementById('source-empty').hidden), hash: await page.evaluate(() => location.hash) });

  await page.click('#btn-settings');
  await page.waitForTimeout(400);
  await shot(page, '07-settings.png');
  await page.click('#settings input[name="theme"][value="dark"]');
  await page.waitForTimeout(200);
  await page.click('#btn-settings-close');
  await page.waitForTimeout(300);
  await page.click('#tab-summary');
  await page.waitForTimeout(800);
  step('dark', { dataTheme: await page.evaluate(() => document.documentElement.getAttribute('data-theme')), bodyBg: await page.evaluate(() => getComputedStyle(document.body).backgroundColor), settingsOpen: await page.evaluate(() => document.getElementById('settings').open), stored: await page.evaluate(() => localStorage.getItem('rpt.settings.v1')) });
  await shot(page, '08-summary-dark.png', true);
  await page.click('#btn-settings'); await page.waitForTimeout(200);
  await page.click('#settings input[name="theme"][value="light"]'); await page.click('#btn-settings-close'); await page.waitForTimeout(300);

  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 8000 }).catch(() => null),
    (async () => { await page.click('#btn-export'); await page.waitForTimeout(300); await page.click('#export-list button[data-export="md"]'); })()
  ]);
  if (download) { const p = path.join(OUT, download.suggestedFilename()); await download.saveAs(p); const md = fs.readFileSync(p, 'utf8'); step('export-md', { file: download.suggestedFilename(), bytes: md.length, hasHeadings: ['문제정의', '해결방법(제안 기법)', '결과(정확한 수치) 및 장점', '단점 및 한계점', '핵심기술'].map(h => md.includes(h)), head: md.slice(0, 200) }); }
  else step('export-md', { download: null });
  const [download2] = await Promise.all([
    page.waitForEvent('download', { timeout: 8000 }).catch(() => null),
    (async () => { await page.click('#btn-export'); await page.waitForTimeout(300); await page.click('#export-list button[data-export="html"]'); })()
  ]);
  if (download2) { const p = path.join(OUT, download2.suggestedFilename()); await download2.saveAs(p); step('export-html', { file: download2.suggestedFilename(), bytes: fs.statSync(p).size }); } else step('export-html', { download: null });

  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(1500);
  step('after-reload', { hash: await page.evaluate(() => location.hash), gateOpen: await page.evaluate(() => document.getElementById('gate').open), resultVisible: await page.evaluate(() => !document.getElementById('view-result').hidden), cards: await page.evaluate(() => document.querySelectorAll('#tr-main article.section-card').length), callsAfterReload: await page.evaluate(() => window.__mockCalls.length) });
  await page.evaluate(() => { location.hash = '#home'; });
  await page.waitForTimeout(600);
  step('history', { historyItems: await page.evaluate(() => document.querySelectorAll('#history-list li').length), first: await page.evaluate(() => { const li = document.querySelector('#history-list li'); return li ? li.textContent.trim().replace(/\s+/g, ' ').slice(0, 140) : null; }), emptyHidden: await page.evaluate(() => document.getElementById('history-empty').hidden) });
  await shot(page, '09-home-history.png', true);
  const callsBefore = await page.evaluate(() => window.__mockCalls.length);
  await page.click('#history-list li .actions button:first-child');
  await page.waitForTimeout(1500);
  step('history-reopen', { callsBefore, callsAfter: await page.evaluate(() => window.__mockCalls.length), resultVisible: await page.evaluate(() => !document.getElementById('view-result').hidden), hash: await page.evaluate(() => location.hash), metricRows: await page.evaluate(() => document.querySelectorAll('#viz-metrics tbody tr').length), radarCanvas: await page.evaluate(() => !!document.querySelector('#viz-radar canvas')), progressText: await page.evaluate(() => document.getElementById('progress-text').textContent) });
  await page.click('#tab-translation'); await page.waitForTimeout(800);
  step('history-reopen-translation', { cards: await page.evaluate(() => [...document.querySelectorAll('#tr-main article.section-card')].map(a => a.dataset.status + ':' + a.querySelectorAll('.katex').length)), toc: await page.evaluate(() => document.querySelectorAll('#toc-list li').length) });
  await shot(page, '10-reopened-translation.png', true);

  await page.click('#tab-summary'); await page.waitForTimeout(300);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(800);
  step('mobile', { scrollWidth: await page.evaluate(() => document.documentElement.scrollWidth), clientWidth: await page.evaluate(() => document.documentElement.clientWidth), overflowers: await page.evaluate(() => [...document.querySelectorAll('body *')].filter(e => e.getBoundingClientRect().right > document.documentElement.clientWidth + 1 && e.offsetParent !== null).slice(0, 8).map(e => e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + (e.className && typeof e.className === 'string' ? '.' + e.className.split(' ').join('.') : '') + ' r=' + Math.round(e.getBoundingClientRect().right))) });
  await shot(page, '11-mobile-summary.png', true);
  await page.click('#tab-translation'); await page.waitForTimeout(600);
  step('mobile-translation', { scrollWidth: await page.evaluate(() => document.documentElement.scrollWidth) });
  await shot(page, '12-mobile-translation.png', true);

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.evaluate(() => { location.hash = '#home'; });
  await page.waitForTimeout(400);
  await page.click('#btn-logout');
  await page.waitForTimeout(600);
  step('logout', { confirmOpen: await page.evaluate(() => document.getElementById('confirm').open), gateOpen: await page.evaluate(() => document.getElementById('gate').open), storedKey: await page.evaluate(() => localStorage.getItem('rpt.apiKey')) });
  if (await page.evaluate(() => document.getElementById('confirm').open)) { await page.click('#confirm-ok'); await page.waitForTimeout(500); step('logout-confirmed', { gateOpen: await page.evaluate(() => document.getElementById('gate').open), storedKey: await page.evaluate(() => localStorage.getItem('rpt.apiKey')) }); }
  await shot(page, '13-logged-out.png');

  await browser.close();
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 1));
  console.log('ERRORS:', JSON.stringify(report.errors));
  console.log('CONSOLE (errors/warnings):', JSON.stringify(report.console.filter(c => /^\[(error|warning)\]/.test(c)).slice(0, 30)));
})().catch(e => { console.error('RUN FAILED:', e); fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 1)); process.exit(1); });
