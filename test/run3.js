const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');

const BASE = process.env.APP_URL || 'http://127.0.0.1:8765/index.html';
const { pathToFileURL, fileURLToPath } = require('url');
const FILE_URL = process.env.FILE_URL || pathToFileURL(path.resolve(__dirname, '..', 'index.html')).href;
const OUT = path.join(__dirname, 'out', process.env.RUN_NAME || 'run3');
fs.mkdirSync(OUT, { recursive: true });
const MOCK = fs.readFileSync(path.join(__dirname, 'mock-openai.js'), 'utf8');
const PDF = path.join(__dirname, 'fixtures', 'tiny.pdf');
const ARXIV = 'https://arxiv.org/abs/2601.01234v2';
const REDIRECT_URI = new URL('auth/callback', BASE).href;
const SCOPE = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
const RESOURCE = 'https://api.openai.com/v1';
const USAGE_URL = 'https://chatgpt.com/settings/usage';
const EMAIL = 'tester@example.com';
const COPY = {
  subtitle: 'ChatGPT 계정이나 OpenAI API 키로 로그인하면 GPT가 논문을 번역하고 정리합니다.',
  button: 'ChatGPT로 계속하기',
  caption: 'ChatGPT Plus·Pro 플랜의 사용량으로 분석합니다. API 키나 별도 결제가 필요 없습니다.',
  hint: 'ChatGPT 로그인은 http://127.0.0.1 주소로 열었을 때만 가능합니다. 터미널에서 python3 serve.py 를 실행한 뒤 http://127.0.0.1:8000 을 여세요.',
  noProxy: '이 서버에는 ChatGPT 중계 기능이 없습니다. 터미널에서 python3 serve.py 를 실행한 뒤 http://127.0.0.1:8000 을 여세요.',
  network: 'OpenAI에 연결할 수 없습니다. 네트워크 연결을 확인해 주세요.',
  gateOr: '또는 API 키로 로그인',
  denied: 'ChatGPT 연결이 취소되었습니다. 플랜 사용을 허용해야 분석할 수 있습니다.',
  noScope: 'ChatGPT 플랜 사용 권한이 허용되지 않았습니다. 다시 로그인해 권한을 허용하거나 API 키를 사용해 주세요.',
  expired: 'ChatGPT 로그인이 만료되었습니다. 다시 로그인해 주세요.',
  welcomeTitle: 'ChatGPT 플랜을 사용합니다',
  welcomeBody: '이 앱의 분석 요청은 회원님의 ChatGPT 플랜 사용량으로 처리됩니다. 사용량과 앱별 한도는 ChatGPT 설정 → 사용량에서 관리할 수 있습니다.',
  planChip: 'ChatGPT 플랜 사용 중',
  usageLink: '사용량 관리',
  limit: 'ChatGPT 플랜 사용 한도에 도달했습니다. ChatGPT 설정 → 사용량에서 한도를 확인하거나 조정한 뒤 다시 시도해 주세요.',
  modelHelpPlan: 'ChatGPT 플랜에서 사용할 수 있는 모델 목록입니다.',
  switchAuth: '다른 방법으로 로그인',
  logoutTitle: '로그아웃',
  logoutBody: 'ChatGPT 연결을 해제할까요? 분석 기록과 설정은 유지됩니다.',
  logoutOk: '연결 해제',
  loggedOut: '로그아웃되었습니다',
  loggedIn: '로그인되었습니다',
  exchange: 'ChatGPT 로그인 처리 중 오류가 발생했습니다. 다시 시도해 주세요.',
  revokeFail: '원격 연결 해제를 확인하지 못했습니다. ChatGPT 설정에서 앱 연결을 해제할 수 있습니다.',
  fileExpired: '업로드한 PDF는 다시 사용할 수 없습니다. 파일을 다시 올려 새로 분석해 주세요.',
  jsonInstruction: '아래 JSON 스키마에 맞는 JSON 객체 하나만 출력하세요',
  ineligible: '이 ChatGPT 계정 또는 워크스페이스에서는 앱의 플랜 사용이 허용되지 않습니다. API 키로 로그인해 주세요.',
  unsupported: 'ChatGPT 플랜으로는 지원되지 않는 요청 옵션이 있어 거부되었습니다.'
};
const SUMMARY_HEADINGS = 5;
const KNOWN_PARAMS = ['client_id', 'agent_name_hint', 'ext_agent_host_id', 'response_type', 'redirect_uri', 'scope', 'resource', 'state', 'nonce', 'code_challenge_method', 'code_challenge', 'login_hint', 'id_token_hint', 'prompt'];
const report = { base: BASE, fileUrl: FILE_URL, redirectUri: REDIRECT_URI, scenarios: [] };
let browser;

async function installAuth(page, opts) {
  const auth = { requests: [], latest: null, codes: 0, deny: !!opts.deny };
  await page.exposeFunction('__mockAuth', () => auth.latest);
  await page.route('https://auth.openai.com/api/accounts/authorize**', (route) => {
    const p = Object.fromEntries(new URL(route.request().url()).searchParams.entries());
    auth.requests.push({
      clientId: p.client_id, agentNameHint: p.agent_name_hint || null, hostId: p.ext_agent_host_id || null, hostIdValid: /^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(p.ext_agent_host_id || ''),
      responseType: p.response_type, redirectUri: p.redirect_uri, scope: p.scope, resource: p.resource, challengeMethod: p.code_challenge_method,
      hasState: !!p.state, hasNonce: !!p.nonce, hasChallenge: !!p.code_challenge, challengeLen: (p.code_challenge || '').length,
      loginHint: p.login_hint || null, prompt: p.prompt || null, hasIdTokenHint: !!p.id_token_hint, extraKeys: Object.keys(p).filter(k => !KNOWN_PARAMS.includes(k))
    });
    let cb;
    try { cb = new URL(p.redirect_uri); } catch { return route.fulfill({ status: 400, body: 'bad redirect_uri' }); }
    if (auth.deny) {
      cb.searchParams.set('error', 'access_denied');
      cb.searchParams.set('state', p.state || '');
    } else {
      const code = `code-${++auth.codes}`;
      auth.latest = { challenge: p.code_challenge, nonce: p.nonce, state: p.state, code, redirectUri: p.redirect_uri, clientId: 'oaiapp_test' };
      cb.searchParams.set('code', code);
      cb.searchParams.set('state', p.state || '');
      cb.searchParams.set('client_id', 'oaiapp_test');
      cb.searchParams.set('scope', p.scope || '');
    }
    return route.fulfill({ status: 302, headers: { location: cb.toString() }, body: '' });
  });
  return auth;
}

async function scenario(name, cfg, fn, opts = {}) {
  const rec = { name, cfg, steps: [], fails: [], errors: [], console: [] };
  report.scenarios.push(rec);
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: 'light', locale: 'ko-KR', acceptDownloads: true });
  ctx.setDefaultTimeout(15000);
  await ctx.addInitScript(`window.__mockCfg = ${JSON.stringify(cfg)};`);
  await ctx.addInitScript(MOCK);
  const page = await ctx.newPage();
  page.on('console', m => { if (/^(error|warning)$/.test(m.type())) rec.console.push(`[${m.type()}] ${m.text()}`); });
  page.on('pageerror', e => rec.errors.push(e.message));
  const auth = await installAuth(page, opts);
  const step = (n, data) => { rec.steps.push({ step: n, ...data }); console.log(`[${name}] ${n}: ${JSON.stringify(data).slice(0, 700)}`); };
  const expect = (cond, label, detail) => {
    if (!cond) { rec.fails.push(detail === undefined ? label : `${label}: ${JSON.stringify(detail).slice(0, 200)}`); console.log(`[${name}] FAIL ${label}${detail === undefined ? '' : ' ' + JSON.stringify(detail).slice(0, 200)}`); }
    return !!cond;
  };
  const shot = (file) => page.screenshot({ path: path.join(OUT, `${name}-${file}.png`), fullPage: true }).catch(() => {});
  try { await fn({ page, step, expect, shot, auth }); }
  catch (e) { rec.errors.push('SCENARIO FAILED: ' + e.message.split('\n')[0]); console.log(`[${name}] FAILED: ${e.message.split('\n')[0]}`); await page.screenshot({ path: path.join(OUT, `${name}-FAILED.png`) }).catch(() => {}); }
  rec.authorize = auth.requests;
  await ctx.close();
}

async function poll(page, fn, timeout = 20000, label = 'condition', arg) {
  const t0 = Date.now();
  for (;;) {
    try { const v = await page.evaluate(fn, arg); if (v) return v; } catch {}
    if (Date.now() - t0 > timeout) throw new Error(`timeout waiting for ${label}`);
    await new Promise(r => setTimeout(r, 150));
  }
}
const authSettled = () => {
  if (!window.RPT || !RPT.auth || typeof RPT.auth.status !== 'function') return null;
  const st = RPT.auth.status() || {};
  const err = document.getElementById('gate-error');
  const gateOpen = !!document.getElementById('gate').open;
  const common = { search: location.search, hash: location.hash, gateOpen, path: location.pathname };
  if (st.connected && st.mode === 'chatgpt') return { connected: true, ...common };
  if (gateOpen && err && !err.hidden && err.textContent.trim()) return { connected: false, error: err.textContent.trim(), ...common };
  return null;
};
const welcomeInfo = () => {
  const d = document.getElementById('welcome');
  if (!d || !d.open) return null;
  const a = d.querySelector('a[href]');
  return { h2: (d.querySelector('h2') || {}).textContent, body: (d.querySelector('p') || {}).textContent, link: a && a.getAttribute('href'), target: a && a.getAttribute('target'), rel: a && a.getAttribute('rel'), ok: (document.getElementById('welcome-ok') || {}).textContent };
};
async function clickChatGPT(page, { expectWelcome = true, beforeOk = null } = {}) {
  await page.click('#btn-chatgpt');
  const r = await poll(page, authSettled, 25000, 'auth settled');
  let welcome = null;
  if (r.connected) {
    welcome = await poll(page, welcomeInfo, expectWelcome ? 5000 : 1500, 'welcome').catch(() => null);
    if (welcome) { if (beforeOk) await beforeOk(welcome); await page.click('#welcome-ok'); await page.waitForTimeout(300); }
  }
  await page.waitForTimeout(500);
  return { ...r, welcome };
}
async function openGate(page, url = BASE) {
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => document.getElementById('gate') && document.getElementById('gate').open, null, { timeout: 10000 });
  await page.waitForTimeout(300);
}
async function signIn(page, opts) { await openGate(page); return clickChatGPT(page, opts); }
// Signs in with an API key from the already open gate.
async function keyInGate(page) {
  await page.fill('#api-key', 'sk-test-valid-key-123');
  await page.click('#btn-login');
  await page.waitForFunction(() => !document.getElementById('gate').open, null, { timeout: 10000 });
  await page.waitForTimeout(300);
}
async function loginKey(page, url = BASE) {
  await openGate(page, url);
  await keyInGate(page);
}
const setCfg = (page, patch) => page.evaluate((p) => {
  Object.assign(window.__mockCfg, p);
  let over = {};
  try { over = JSON.parse(sessionStorage.getItem('__mock.cfg')) || {}; } catch { over = {}; }
  sessionStorage.setItem('__mock.cfg', JSON.stringify(Object.assign(over, p)));
}, patch);
const expireTokens = (page) => page.evaluate(() => {
  const k = 'rpt.chatgpt.tokens.v1';
  let t = null;
  try { t = JSON.parse(localStorage.getItem(k)); } catch { t = null; }
  if (!t || typeof t !== 'object') return false;
  t.accessToken = 'oat-expired';
  t.expiresAt = Date.now() - 1000;
  t.earliestRefreshAt = null;
  localStorage.setItem(k, JSON.stringify(t));
  return true;
});
const status = (page) => page.evaluate(() => (window.RPT && RPT.auth && typeof RPT.auth.status === 'function') ? RPT.auth.status() : null);
const storage = (page) => page.evaluate(() => {
  const raw = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  const parse = (k) => { try { const v = JSON.parse(raw(k)); return v && typeof v === 'object' ? v : null; } catch { return null; } };
  const tok = parse('rpt.chatgpt.tokens.v1');
  const reg = parse('rpt.chatgpt.reg.v1');
  const settings = parse('rpt.settings.v1') || {};
  let stripped = null;
  try { stripped = sessionStorage.getItem('rpt.chatgpt.stripped'); } catch { stripped = null; }
  return {
    authMode: raw('rpt.authMode'), hostPrefix: (raw('rpt.chatgpt.host') || '').replace(/^"/, '').slice(0, 9),
    hasTokens: raw('rpt.chatgpt.tokens.v1') != null, tokenFields: tok ? Object.keys(tok).sort() : null, welcomed: tok ? tok.welcomed : null,
    expiresInMin: tok && Number.isFinite(tok.expiresAt) ? Math.round((tok.expiresAt - Date.now()) / 60000) : null, scopesHasPlan: !!(tok && Array.isArray(tok.scopes) && tok.scopes.includes('chatgpt.tokens.use.direct')),
    hasReg: raw('rpt.chatgpt.reg.v1') != null, regClientId: reg && reg.clientId, regEmail: reg && reg.email, regSubject: reg && reg.subject,
    hasApiKey: raw('rpt.apiKey') != null, modelPlan: settings.modelPlan, modelsCachePlan: settings.modelsCachePlan && settings.modelsCachePlan.list && settings.modelsCachePlan.list.map(m => m.id + '=' + m.label), stripped, pending: (() => { try { return sessionStorage.getItem('rpt.chatgpt.pending') != null; } catch { return null; } })()
  };
});
const gate = (page) => page.evaluate(() => {
  const q = (id) => document.getElementById(id);
  const txt = (id) => (q(id) ? q(id).textContent.trim().replace(/\s+/g, ' ') : null);
  const vis = (id) => !!q(id) && !q(id).hidden && q(id).getClientRects().length > 0;
  return {
    open: !!q('gate').open, error: txt('gate-error'), errorHidden: q('gate-error').hidden, btn: !!q('btn-chatgpt'), btnDisabled: q('btn-chatgpt') ? q('btn-chatgpt').disabled : null, btnText: txt('btn-chatgpt'), btnType: q('btn-chatgpt') && q('btn-chatgpt').getAttribute('type'),
    caption: txt('chatgpt-caption'), hint: txt('chatgpt-hint'), hintVisible: vis('chatgpt-hint'), hintRole: q('chatgpt-hint') && q('chatgpt-hint').getAttribute('role'), hintHasCode: !!(q('chatgpt-hint') && q('chatgpt-hint').querySelector('code')),
    or: txt('gate-or'), subtitle: ((q('gate').querySelector('.subtitle') || {}).textContent || '').trim(), closeVisible: vis('btn-gate-close'), keyFieldVisible: vis('api-key'), loginDisabled: q('btn-login') && q('btn-login').disabled, welcomeOpen: q('welcome') ? !!q('welcome').open : null
  };
});
const models = (page) => page.evaluate(() => ({
  options: [...document.querySelectorAll('#model-select option')].map(o => o.value + '=' + o.textContent.trim()), selected: document.getElementById('model-select').value, badge: document.getElementById('model-badge').textContent.trim(),
  settingsOptions: [...document.querySelectorAll('#set-model option')].map(o => o.value), startDisabled: document.getElementById('btn-start').disabled
}));
const job = (page) => page.evaluate(() => {
  const s = RPT.state; const j = s.currentJobId && s.jobs[s.currentJobId];
  return j ? { id: j.id, state: j.state, model: j.model, summaryStatus: j.summaryStatus, summaryError: j.summaryError, ideasStatus: j.ideasStatus, ideasError: j.ideasError, ideaCount: j.ideas && Array.isArray(j.ideas.ideas) ? j.ideas.ideas.length : 0, error: j.error, source: { type: j.source.type, fileId: j.source.fileId || null, hasFileData: !!j.source.fileData, pdfUrl: j.source.pdfUrl || null }, chunks: j.chunks.map(c => ({ id: c.id, kind: c.kind, pages: [c.startPage, c.endPage], status: c.status, attempts: c.attempts, truncated: c.truncated, err: c.errorCode, msg: c.error, len: (c.text || '').length })), usage: j.usage } : null;
});
async function waitEnd(page, timeout = 90000) {
  await page.waitForFunction(() => { const s = RPT.state; const j = s.currentJobId && s.jobs[s.currentJobId]; return j && ['done', 'partial', 'failed', 'cancelled'].includes(j.state); }, null, { timeout });
  await page.waitForTimeout(600);
}
async function start(page, url) { await page.fill('#url-input', url); await page.waitForTimeout(150); await page.click('#btn-start'); }
async function goHome(page) {
  await page.evaluate(() => { location.hash = '#home'; });
  await page.waitForFunction(() => !document.getElementById('view-home').hidden, null, { timeout: 5000 });
  await page.waitForTimeout(300);
}
const calls = (page) => page.evaluate(() => window.__mockCalls.map(b => {
  const first = (Array.isArray(b.input) && b.input[0] && Array.isArray(b.input[0].content) && b.input[0].content[0]) || {};
  const inputJson = JSON.stringify(b.input);
  return {
    seq: b.seq, auth: b.auth, viaProxy: b.viaProxy === true, task: b.task, model: b.model, store: b.store, stream: b.stream, hasMaxOut: 'max_output_tokens' in b, hasMeta: 'metadata' in b, hasSafety: 'safety_identifier' in b,
    instructions: typeof b.instructions, inputArray: Array.isArray(b.input), systemItems: Array.isArray(b.input) ? b.input.filter(i => i && i.role === 'system').length : null,
    part: first.type || null, fileUrl: first.file_url || null, hasFileId: 'file_id' in first, hasFileData: typeof first.file_data === 'string', fileDataPrefix: typeof first.file_data === 'string' ? first.file_data.slice(0, 28) : null, fileDataLen: typeof first.file_data === 'string' ? first.file_data.length : null, filename: first.filename || null, detail: first.detail || null,
    format: b.text && b.text.format ? b.text.format.name : null, verbosity: (b.text && b.text.verbosity) || null, effort: (b.reasoning && b.reasoning.effort) || null, hasReasoning: 'reasoning' in b, cacheKey: typeof b.prompt_cache_key, obf: b.stream_options ? b.stream_options.include_obfuscation : null,
    jsonInstr: /아래 JSON 스키마에 맞는 JSON 객체 하나만 출력하세요/.test(inputJson), pages: ((inputJson.match(/PDF 페이지 범위:\s*([0-9–-]+)/) || [])[1]) || null
  };
}));
const tokenCalls = (page) => page.evaluate(() => window.__mockTokenCalls.slice());
const proxyHits = (page) => page.evaluate(() => window.__mockProxyHits);
const planEvents = (page) => page.evaluate(() => window.__mockPlanEvents.slice());
const chips = (page) => page.evaluate(() => [...document.querySelectorAll('#section-chips .status-chip')].map(c => c.dataset.status));
const ui = (page) => page.evaluate(() => ({ progress: document.getElementById('progress-text').textContent, strip: document.getElementById('progress-strip').dataset.state, cancelHidden: document.getElementById('btn-cancel').hidden, retryAllHidden: document.getElementById('btn-retry-all').hidden, gateOpen: !!document.getElementById('gate').open, gateError: document.getElementById('gate-error').textContent.trim(), toasts: [...document.querySelectorAll('#toast-region *')].map(t => t.textContent.trim()).filter(Boolean).slice(0, 5) }));
const cards = (page) => page.evaluate(() => [...document.querySelectorAll('#tr-main article.section-card')].map(a => ({ id: a.id, status: a.dataset.status, buttons: [...a.querySelectorAll('button')].map(b => b.textContent.trim()).filter(Boolean), len: a.textContent.length })));
const resultMeta = (page) => page.evaluate(() => {
  const meta = document.getElementById('result-meta');
  const chip = document.getElementById('plan-chip');
  const link = document.getElementById('plan-usage-link');
  return { text: meta ? meta.textContent.trim().replace(/\s+/g, ' ') : null, chip: chip ? chip.textContent.trim() : null, chipInMeta: !!(chip && meta && meta.contains(chip)), link: link ? { href: link.getAttribute('href'), target: link.getAttribute('target'), rel: link.getAttribute('rel'), text: link.textContent.trim() } : null, headings: [...document.querySelectorAll('#panel-summary .sum-section > h3')].map(h => h.textContent.trim()), tldr: (document.getElementById('summary-tldr') || {}).textContent, metricRows: document.querySelectorAll('#viz-metrics tbody tr').length };
});
const limitCard = (page) => page.evaluate(() => {
  const card = document.getElementById('limit-card');
  const link = document.getElementById('limit-usage-link');
  const btn = document.getElementById('limit-switch-key');
  return { exists: !!card, visible: !!card && !card.hidden && card.getClientRects().length > 0, text: card ? card.textContent.trim().replace(/\s+/g, ' ') : null, link: link ? { href: link.getAttribute('href'), target: link.getAttribute('target'), text: link.textContent.trim() } : null, button: btn ? btn.textContent.trim() : null };
});
const settingsInfo = (page) => page.evaluate(() => {
  const q = (id) => document.getElementById(id);
  const vis = (el) => !!el && !el.hidden && el.getClientRects().length > 0;
  const fs = q('set-account');
  return { open: !!q('settings').open, fieldset: !!fs, legend: fs && fs.querySelector('legend') ? fs.querySelector('legend').textContent.trim() : null, accountText: q('account-text') ? q('account-text').textContent.trim().replace(/\s+/g, ' ') : null, usageLink: q('account-usage-link') ? { href: q('account-usage-link').getAttribute('href'), visible: vis(q('account-usage-link')), text: q('account-usage-link').textContent.trim() } : null, switchBtn: q('btn-switch-auth') ? q('btn-switch-auth').textContent.trim() : null, modelHelp: q('set-model-field') ? q('set-model-field').textContent.replace(/\s+/g, ' ') : '' };
});
// Horizontal overflow check for the page and an element.
const fit = (page, sel) => page.evaluate((sel) => {
  const el = sel ? document.querySelector(sel) : null;
  const r = el ? el.getBoundingClientRect() : null;
  return { scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth, el: r ? { left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width) } : null };
}, sel);
const fits = (f) => f.scrollWidth <= f.innerWidth && (!f.el || (f.el.left >= 0 && f.el.right <= f.innerWidth && f.el.width > 0));
const confirmInfo = (page) => page.evaluate(() => ({ open: !!document.getElementById('confirm').open, title: document.getElementById('confirm-title').textContent.trim(), body: document.getElementById('confirm-body').textContent.trim(), ok: document.getElementById('confirm-ok').textContent.trim() }));
const ideasPanel = (page) => page.evaluate(() => {
  const box = document.getElementById('ideas-body');
  const st = box.querySelector('.ideas-state');
  return {
    hidden: document.getElementById('panel-ideas').hidden, tab: (document.querySelector('#tabs [aria-selected="true"]') || {}).id, hash: location.hash,
    kind: st ? (st.classList.contains('ideas-state--failed') ? 'failed' : 'notice') : (box.querySelector('.ideas-loading') ? 'loading' : (box.querySelector('.idea-card') ? 'ideas' : 'empty')),
    notice: st ? st.querySelector('p').textContent.trim() : null, buttons: [...box.querySelectorAll('button')].map(b => b.textContent.trim() + (b.disabled ? ':disabled' : '')), cards: box.querySelectorAll('.idea-card').length
  };
});
const tocInfo = (page) => page.evaluate(() => [...document.querySelectorAll('#toc-list > li')].map(li => {
  const a = li.querySelector(':scope > a.toc-link');
  return {
    sec: li.dataset.sec, current: a.getAttribute('aria-current'), contains: a.classList.contains('contains-current'),
    subs: [...li.querySelectorAll(':scope > ol.toc-sub > li > a.toc-sub-link')].map(x => {
      const h = document.getElementById(x.dataset.target);
      return { label: x.textContent.trim(), depth: x.dataset.depth, href: x.getAttribute('href'), current: x.getAttribute('aria-current'), target: !!h && h.closest('.section-card') === document.getElementById('sec-' + li.dataset.sec) && h.getAttribute('tabindex') === '-1' && ('#' + h.id) === x.getAttribute('href') };
    })
  };
}));
const subLabels = (toc) => Object.fromEntries(toc.map(t => [t.sec, t.subs.map(x => x.label)]));
const sameLabels = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const planBodyChecks = (list) => {
  const plan = list.filter(c => c.auth === 'plan');
  return {
    count: plan.length, allStoreFalse: plan.every(c => c.store === false), allStream: plan.every(c => c.stream === true), noMaxOut: plan.every(c => !c.hasMaxOut), noMeta: plan.every(c => !c.hasMeta), noSafety: plan.every(c => !c.hasSafety),
    instructions: plan.every(c => c.instructions === 'string'), inputArray: plan.every(c => c.inputArray), noSystem: plan.every(c => c.systemItems === 0), fileUrl: plan.every(c => !!c.fileUrl), noFileId: plan.every(c => !c.hasFileId), models: [...new Set(plan.map(c => c.model))], tasks: plan.map(c => c.task)
  };
};

(async () => {
  browser = await chromium.launch({ channel: 'chrome', headless: true });

  await scenario('chatgpt-flow', {}, async ({ page, step, expect, shot, auth }) => {
    await openGate(page);
    const g = await gate(page);
    step('gate', g);
    expect(g.btn && g.btnDisabled === false && g.btnType === 'button', 'chatgpt button enabled', { btn: g.btn, disabled: g.btnDisabled, type: g.btnType });
    expect(g.btnText === COPY.button, 'button copy', g.btnText);
    expect(g.caption === COPY.caption, 'caption copy', g.caption);
    expect(!g.hintVisible, 'loopback hint hidden on 127.0.0.1', g.hint);
    expect(g.or === COPY.gateOr, 'divider copy', g.or);
    expect(g.subtitle === COPY.subtitle, 'subtitle copy', g.subtitle);
    expect(g.keyFieldVisible, 'api key form still present');
    expect(!g.closeVisible, 'gate not cancellable without session');
    await shot('gate');

    const r = await clickChatGPT(page, { expectWelcome: true, beforeOk: () => shot('welcome') });
    const a1 = auth.requests[0] || {};
    step('authorize', { request: a1, result: { connected: r.connected, error: r.error, search: r.search, hash: r.hash, path: r.path } });
    expect(auth.requests.length === 1, 'one authorize request', auth.requests.length);
    expect(a1.clientId === 'dynamic_agent_client', 'first registration uses dynamic_agent_client', a1.clientId);
    expect(a1.agentNameHint === 'Read Paper Together', 'agent_name_hint on registration', a1.agentNameHint);
    expect(a1.hostIdValid, 'ext_agent_host_id is urn:uuid v4', a1.hostId);
    expect(a1.redirectUri === REDIRECT_URI, 'redirect_uri', a1.redirectUri);
    expect(a1.scope === SCOPE, 'scope string', a1.scope);
    expect(a1.resource === RESOURCE, 'resource', a1.resource);
    expect(a1.responseType === 'code' && a1.challengeMethod === 'S256' && a1.hasState && a1.hasNonce && a1.challengeLen === 43, 'code/S256/state/nonce', a1);
    expect(a1.loginHint === null && a1.prompt === null, 'no login_hint/prompt on first registration', { loginHint: a1.loginHint, prompt: a1.prompt });
    expect(r.connected === true, 'connected after callback', r);
    expect(r.search === '', 'callback query removed from URL', r.search);
    expect(!!r.welcome, 'welcome dialog shown once');
    if (r.welcome) {
      expect(r.welcome.h2 === COPY.welcomeTitle, 'welcome title', r.welcome.h2);
      expect((r.welcome.body || '').trim() === COPY.welcomeBody, 'welcome body', r.welcome.body);
      expect(r.welcome.link === USAGE_URL && r.welcome.target === '_blank' && /noopener/.test(r.welcome.rel || ''), 'welcome usage link', r.welcome);
    }
    const st = await status(page);
    const sto = await storage(page);
    const m = await models(page);
    const tc = await tokenCalls(page);
    step('after-login', { status: st, storage: sto, models: m, tokenCalls: tc, gate: await gate(page) });
    expect(st && st.mode === 'chatgpt' && st.connected && st.email === EMAIL && st.hasReg && st.welcomed, 'auth.status after login', st);
    expect(st && st.proxy === true, 'status reports the relay as available', st && st.proxy);
    expect(sto.authMode != null && /chatgpt/.test(sto.authMode) && sto.hasTokens && sto.hasReg && sto.regClientId === 'oaiapp_test' && sto.hostPrefix === 'urn:uuid:', 'storage keys after login', sto);
    expect(sto.scopesHasPlan && sto.welcomed === true, 'token record has plan scope + welcomed flag', { scopesHasPlan: sto.scopesHasPlan, welcomed: sto.welcomed });
    expect(!sto.pending, 'pending attempt deleted after use');
    expect(JSON.stringify(m.options) === JSON.stringify(['gpt-6.1-sol=GPT-6.1 Sol', 'gpt-6.1-mini=GPT-6.1 Mini']), 'model select from catalog without hidden model', m.options);
    expect(m.badge === 'GPT-6.1 Sol' && m.selected === 'gpt-6.1-sol', 'default plan model is first catalog entry', { badge: m.badge, selected: m.selected });
    expect(tc.filter(t => t.grant === 'authorization_code').length === 1 && tc.every(t => t.ok), 'one successful code exchange', tc);
    await shot('home');

    await start(page, ARXIV);
    await waitEnd(page);
    const j = await job(page);
    const c = await calls(page);
    const pb = planBodyChecks(c);
    step('job', { state: j.state, summaryStatus: j.summaryStatus, model: j.model, chunks: j.chunks.map(x => x.id + ':' + x.status), usage: j.usage, events: await planEvents(page) });
    step('plan-bodies', { ...pb, viaProxy: c.every(x => x.viaProxy), sample: c[0] });
    expect(j.state === 'done' && j.summaryStatus === 'done', 'job done', { state: j.state, summaryStatus: j.summaryStatus });
    expect(c.length > 0 && c.every(x => x.viaProxy === true), 'every plan call relayed through /__rpt/openai', c.map(x => x.viaProxy));
    expect(pb.count === c.length && pb.count > 0 && pb.allStoreFalse && pb.allStream && pb.noMaxOut && pb.noMeta && pb.noSafety && pb.instructions && pb.inputArray && pb.noSystem && pb.fileUrl && pb.noFileId, 'plan body contract', pb);
    expect(JSON.stringify(pb.models) === JSON.stringify(['gpt-6.1-sol']), 'plan model slug sent', pb.models);
    const ic = c.filter(x => x.task === 'ideas');
    step('ideas-call', { ideasStatus: j.ideasStatus, ideaCount: j.ideaCount, calls: ic });
    expect(j.ideasStatus === 'done' && j.ideaCount === 5, 'ideas generated in plan mode', { ideasStatus: j.ideasStatus, ideasError: j.ideasError });
    expect(ic.length === 1 && ic[0].viaProxy && ic[0].store === false && ic[0].stream === true && !ic[0].hasMaxOut && !ic[0].hasMeta && !ic[0].hasSafety && ic[0].format === 'paper_ideas' && !!ic[0].fileUrl, 'ideas call relayed with plan rules', ic);
    await page.click('#tab-summary');
    await page.waitForTimeout(800);
    const meta = await resultMeta(page);
    step('result-meta', meta);
    expect(meta.headings.length === SUMMARY_HEADINGS, 'summary headings', meta.headings);
    expect(meta.chip === COPY.planChip && meta.chipInMeta, 'plan chip in result meta', { chip: meta.chip, inMeta: meta.chipInMeta });
    expect(meta.link && meta.link.href === USAGE_URL && meta.link.target === '_blank' && /noopener/.test(meta.link.rel || '') && meta.link.text === COPY.usageLink, 'usage link in result meta', meta.link);
    expect(meta.text && /GPT-6\.1 Sol/.test(meta.text) && /추론/.test(meta.text) && !/\$/.test(meta.text) && !/예상 비용/.test(meta.text), 'meta shows display name, no cost', meta.text);
    await shot('result');

    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(1500);
    const afterReload = await page.evaluate(() => ({ gateOpen: !!document.getElementById('gate').open, welcomeOpen: !!(document.getElementById('welcome') && document.getElementById('welcome').open), resultVisible: !document.getElementById('view-result').hidden, cards: document.querySelectorAll('#tr-main article.section-card').length, tokenCalls: window.__mockTokenCalls.length, apiCalls: window.__mockCalls.length, hash: location.hash }));
    step('after-reload', { ...afterReload, status: await status(page), badge: (await models(page)).badge });
    expect(!afterReload.gateOpen && !afterReload.welcomeOpen, 'no gate/welcome after reload', afterReload);
    expect(afterReload.tokenCalls === 0 && afterReload.apiCalls === 0, 'zero auth/api calls after reload', afterReload);
    expect(afterReload.resultVisible && afterReload.cards > 0, 'result restored after reload', afterReload);

    await page.click('#btn-settings');
    await page.waitForTimeout(400);
    const si = await settingsInfo(page);
    step('settings', si);
    expect(si.open && si.fieldset && si.legend === '계정', 'account fieldset', { fieldset: si.fieldset, legend: si.legend });
    expect(si.accountText === `ChatGPT · ${EMAIL}`, 'account text', si.accountText);
    expect(si.usageLink && si.usageLink.href === USAGE_URL && si.usageLink.visible && si.usageLink.text === COPY.usageLink, 'account usage link', si.usageLink);
    expect(si.switchBtn === COPY.switchAuth, 'switch auth button', si.switchBtn);
    expect(si.modelHelp.includes(COPY.modelHelpPlan), 'model help text in plan mode', si.modelHelp.slice(0, 120));
    await shot('settings');
    await page.click('#btn-switch-auth');
    await page.waitForTimeout(400);
    const g2 = await gate(page);
    const settingsOpen = await page.evaluate(() => !!document.getElementById('settings').open);
    step('switch-auth', { settingsOpen, gate: g2 });
    expect(!settingsOpen && g2.open && g2.closeVisible, 'switch auth opens cancellable gate', { settingsOpen, open: g2.open, closeVisible: g2.closeVisible });
    await page.click('#btn-gate-close');
    await page.waitForTimeout(300);
    expect(!(await gate(page)).open, 'gate closed by close button');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);

    await page.evaluate(() => { location.hash = '#home'; });
    await page.waitForTimeout(400);
    await page.click('#btn-logout');
    await page.waitForTimeout(500);
    const ci = await confirmInfo(page);
    step('logout-confirm', ci);
    expect(ci.open && ci.title === COPY.logoutTitle && ci.body === COPY.logoutBody && ci.ok === COPY.logoutOk, 'logout confirm copy', ci);
    if (ci.open) await page.click('#confirm-ok');
    await page.waitForFunction(() => document.getElementById('gate').open, null, { timeout: 10000 });
    await page.waitForTimeout(500);
    const revoked = await page.evaluate(() => window.__mockRevoked.slice());
    const sto2 = await storage(page);
    const st2 = await status(page);
    const u = await ui(page);
    step('logout', { revoked, storage: sto2, status: st2, gate: await gate(page), toasts: u.toasts });
    expect(revoked.length === 1 && revoked[0].tokenTypeHint === 'refresh_token' && revoked[0].clientId === 'oaiapp_test' && revoked[0].tokenIsCurrentRefresh, 'revoke recorded', revoked);
    expect(!sto2.hasTokens && sto2.hasReg && sto2.regClientId === 'oaiapp_test', 'tokens cleared, registration kept', sto2);
    expect(st2 && !st2.connected && st2.hasReg, 'status disconnected with reg', st2);
    expect(u.toasts.some(t => t.includes(COPY.loggedOut)), 'logout toast', u.toasts);
    expect(!(await gate(page)).closeVisible, 'gate not cancellable after logout');
    await shot('logged-out');

    const r2 = await clickChatGPT(page, { expectWelcome: false });
    const a2 = auth.requests[1] || {};
    const st3 = await status(page);
    step('relogin', { request: a2, result: { connected: r2.connected, error: r2.error, welcome: !!r2.welcome }, status: st3, tokenCalls: await tokenCalls(page), models: await models(page) });
    expect(auth.requests.length === 2, 'second authorize request', auth.requests.length);
    expect(a2.clientId === 'oaiapp_test', 'reauth uses issued client_id', a2.clientId);
    expect(a2.loginHint === EMAIL, 'reauth sends login_hint', a2.loginHint);
    expect(a2.agentNameHint === null, 'reauth omits agent_name_hint', a2.agentNameHint);
    expect(a2.hostId === a1.hostId, 'same ext_agent_host_id', { first: a1.hostId, second: a2.hostId });
    expect(a2.prompt === null, 'no prompt=consent on ordinary reauth', a2.prompt);
    expect(r2.connected === true, 'connected again', r2);
    expect(!r2.welcome, 'no welcome on re-login');
    expect(st3 && st3.connected && st3.email === EMAIL, 'status after relogin', st3);
    await shot('relogin');
  });

  await scenario('chatgpt-refresh', { rateLimitOnce: false }, async ({ page, step, expect, shot }) => {
    const r = await signIn(page);
    expect(r.connected, 'signed in', r);
    expect(await expireTokens(page), 'token record found to expire');
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(1200);
    const before = { gate: await gate(page), status: await status(page), storage: await storage(page), tokenCalls: await tokenCalls(page) };
    step('expired-before-call', before);
    expect(!before.gate.open, 'no gate with expired-but-refreshable session', before.gate);
    await start(page, ARXIV);
    await waitEnd(page);
    const j = await job(page);
    const tc = await tokenCalls(page);
    const c = await calls(page);
    const refreshes = tc.filter(t => t.grant === 'refresh_token');
    const firstApiSeq = c.length ? c[0].seq : null;
    const sto = await storage(page);
    step('refreshed', { state: j.state, chunks: j.chunks.map(x => x.id + ':' + x.status), tokenCalls: tc, firstApiSeq, apiCalls: c.length, storage: sto, concurrency: await page.evaluate(() => RPT.state.settings.concurrency) });
    expect(j.state === 'done', 'job done after refresh', j.state);
    expect(refreshes.length === 1 && refreshes[0].ok, 'exactly one refresh', tc);
    expect(refreshes.length === 1 && firstApiSeq !== null && refreshes[0].seq < firstApiSeq, 'refresh happened before the first API call', { refreshSeq: refreshes[0] && refreshes[0].seq, firstApiSeq });
    expect(sto.hasTokens && sto.expiresInMin !== null && sto.expiresInMin >= 55, 'rotated token stored with new expiry', { expiresInMin: sto.expiresInMin });
    expect(!(await gate(page)).open, 'gate stays closed');

    await goHome(page);
    const callsBefore = c.length;
    await start(page, ARXIV);
    await page.waitForFunction((n) => window.__mockCalls.length > n, callsBefore, { polling: 30, timeout: 20000 });
    expect(await expireTokens(page), 'token record found to expire mid-job');
    await waitEnd(page);
    const j2 = await job(page);
    const tc2 = await tokenCalls(page);
    const c2 = (await calls(page)).slice(callsBefore);
    const refreshes2 = tc2.filter(t => t.grant === 'refresh_token');
    const concurrentSeqs = c2.slice(1, 4).map(x => x.seq);
    step('refreshed-concurrent', { state: j2.state, chunks: j2.chunks.map(x => x.id + ':' + x.status), tokenCalls: tc2, outlineSeq: c2[0] && c2[0].seq, concurrentSeqs, apiCalls: c2.length, storage: await storage(page) });
    expect(j2.state === 'done', 'second job done after mid-job refresh', j2.state);
    expect(refreshes2.length === 2 && refreshes2.every(t => t.ok), 'exactly one more refresh for concurrent callers', tc2);
    expect(c2.length >= 4 && refreshes2[1] && refreshes2[1].seq > c2[0].seq && concurrentSeqs.every(s => s > refreshes2[1].seq), 'refresh happened once between the outline call and the concurrent calls', { refreshSeq: refreshes2[1] && refreshes2[1].seq, outlineSeq: c2[0] && c2[0].seq, concurrentSeqs });

    expect(await expireTokens(page), 'token record found to expire again');
    await setCfg(page, { refreshFails: true });
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(1000);
    await goHome(page);
    await start(page, ARXIV);
    const settled = await poll(page, () => { const g = document.getElementById('gate'); const e = document.getElementById('gate-error'); return g.open && !e.hidden && e.textContent.trim() ? { error: e.textContent.trim() } : null; }, 20000, 'gate after refresh failure').catch(() => null);
    const after = { settled, status: await status(page), storage: await storage(page), tokenCalls: await tokenCalls(page), apiCalls: (await calls(page)).length, gate: await gate(page) };
    step('refresh-fails', after);
    expect(settled && settled.error === COPY.expired, 'gate shows expired message', settled);
    expect(!after.storage.hasTokens && after.storage.hasReg && after.storage.regClientId === 'oaiapp_test', 'tokens cleared, registration kept', after.storage);
    expect(after.status && !after.status.connected && after.status.hasReg, 'status disconnected with reg', after.status);
    expect(after.tokenCalls.filter(t => t.grant === 'refresh_token').length === 1, 'single failed refresh attempt', after.tokenCalls);
    expect(after.apiCalls === 0, 'no API call with the expired token', after.apiCalls);
    await shot('refresh-failed');
  });

  const limitScenario = (name, cfg) => scenario(name, { ...cfg, rateLimitOnce: false }, async ({ page, step, expect, shot }) => {
    const r = await signIn(page);
    expect(r.connected, 'signed in', r);
    await start(page, ARXIV);
    const seen = await poll(page, () => { const c = document.getElementById('limit-card'); return c && !c.hidden ? { toasts: [...document.querySelectorAll('#toast-region *')].map(t => t.textContent.trim()).filter(Boolean).slice(0, 5) } : null; }, 60000, 'limit card').catch(() => null);
    step('limit-shown', { seen });
    expect(!!seen, 'limit card appeared');
    expect(seen && seen.toasts.some(t => t.includes(COPY.limit)), 'limit toast', seen && seen.toasts);
    await waitEnd(page);
    const j = await job(page);
    const c = await calls(page);
    const ev = await planEvents(page);
    const hit = ev.find(e => e.kind === 'limit429' || e.kind === 'failMidStream');
    const hitCall = hit && c.find(x => x.seq === hit.seq);
    const sameChunkCalls = hitCall ? c.filter(x => x.task === 'translate' && x.pages === hitCall.pages).length : null;
    const failed = j.chunks.filter(x => x.status === 'failed');
    const u = await ui(page);
    const lc = await limitCard(page);
    step('after-limit', { state: j.state, chunks: j.chunks, events: ev, hitPages: hitCall && hitCall.pages, sameChunkCalls, ui: u, limitCard: lc, apiCalls: c.length });
    expect(['cancelled', 'partial', 'failed'].includes(j.state), 'job stopped', j.state);
    expect(sameChunkCalls === 1, 'limited chunk not retried', sameChunkCalls);
    expect(failed.length > 0 && failed.every(x => x.msg === COPY.limit), 'failed chunks carry the limit message', failed.map(x => x.msg));
    expect(j.chunks.every(x => x.status !== 'running' && x.status !== 'retrying'), 'no chunk left running', j.chunks.map(x => x.status));
    expect(lc.visible && lc.text.includes(COPY.limit), 'limit card visible with copy', lc);
    expect(lc.link && lc.link.href === USAGE_URL && lc.link.text === COPY.usageLink, 'limit card usage link', lc.link);
    expect(lc.button === 'API 키로 전환', 'limit card switch button', lc.button);
    expect(!u.retryAllHidden, 'manual retry available', u.retryAllHidden);
    await page.click('#tab-translation');
    await page.waitForTimeout(400);
    step('cards', await cards(page));
    await shot('limit');
    await page.click('#limit-switch-key');
    await page.waitForTimeout(400);
    const g = await gate(page);
    expect(g.open && g.closeVisible && g.keyFieldVisible, 'switch to key opens cancellable gate', g);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    expect(!(await gate(page)).open, 'gate closed with Escape');
  });
  await limitScenario('chatgpt-limit', { planLimitOnce: true });
  await limitScenario('chatgpt-limit-midstream', { planFailMidStreamOnce: true });

  await scenario('chatgpt-format-fallback', { planUnsupportedParamOnce: 'text.format', rateLimitOnce: false }, async ({ page, step, expect, shot }) => {
    const r = await signIn(page);
    expect(r.connected, 'signed in', r);
    await start(page, ARXIV);
    await waitEnd(page);
    const j = await job(page);
    const c = await calls(page);
    const ev = await planEvents(page);
    const outlineCalls = c.filter(x => x.task === 'outline');
    const summaryCalls = c.filter(x => x.task === 'summary');
    const sto = await storage(page);
    const st = await status(page);
    await page.click('#tab-summary');
    await page.waitForTimeout(600);
    const meta = await resultMeta(page);
    step('fallback', { state: j.state, summaryStatus: j.summaryStatus, summaryError: j.summaryError, events: ev, outlineCalls, summaryCalls, stripped: sto.stripped, statusStripped: st && st.stripped, headings: meta.headings, tldr: (meta.tldr || '').slice(0, 40), metricRows: meta.metricRows });
    expect(ev.length === 1 && ev[0].kind === 'paramOnce' && ev[0].param === 'text.format', 'text.format rejected once', ev);
    expect(outlineCalls.length === 2 && outlineCalls[0].format === 'paper_outline' && outlineCalls[1].format === null && outlineCalls[1].jsonInstr, 'outline retried without text.format and with JSON instruction', outlineCalls);
    expect(summaryCalls.length >= 1 && summaryCalls.every(x => x.format === null && x.jsonInstr), 'later JSON calls omit text.format', summaryCalls);
    expect(j.state === 'done' && j.summaryStatus === 'done', 'job and summary done via lenient parse', { state: j.state, summaryStatus: j.summaryStatus, summaryError: j.summaryError });
    expect(meta.headings.length === SUMMARY_HEADINGS && meta.metricRows > 0, 'summary rendered', { headings: meta.headings.length, metricRows: meta.metricRows });
    expect(/text\.format/.test(sto.stripped || '') && Array.isArray(st && st.stripped) && st.stripped.includes('text.format'), 'stripped path recorded', { stripped: sto.stripped, statusStripped: st && st.stripped });
    await shot('summary');
  });

  await scenario('chatgpt-upload', { rateLimitOnce: false }, async ({ page, step, expect, shot }) => {
    const r = await signIn(page);
    expect(r.connected, 'signed in', r);
    await page.setInputFiles('#file-input', PDF);
    await page.waitForTimeout(300);
    step('picked', { name: await page.evaluate(() => document.getElementById('dz-file-name').textContent), startDisabled: await page.evaluate(() => document.getElementById('btn-start').disabled) });
    await page.click('#btn-start');
    await waitEnd(page);
    const j = await job(page);
    const c = await calls(page);
    const files = await page.evaluate(() => ({ uploads: window.__mockUploads, deletes: window.__mockDeletes }));
    step('upload-job', { state: j.state, summaryStatus: j.summaryStatus, source: j.source, chunks: j.chunks.map(x => x.id + ':' + x.status), files, first: c[0], allInline: c.every(x => x.hasFileData && x.filename === 'tiny.pdf' && !x.hasFileId) });
    expect(j.state === 'done', 'job done with inline file', j.state);
    expect(files.uploads.length === 0 && files.deletes.length === 0, 'no /v1/files calls', files);
    expect(c.length > 0 && c.every(x => x.part === 'input_file' && x.hasFileData && x.fileDataPrefix === 'data:application/pdf;base64,' && x.filename === 'tiny.pdf' && !x.hasFileId && !x.fileUrl), 'every call sends file_data data URL + filename', c[0]);
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(1200);
    const after = { ...(await job(page)).source, cards: await page.evaluate(() => document.querySelectorAll('#tr-main article.section-card').length), persistedBase64: await page.evaluate(() => { try { return Object.keys(localStorage).some(k => /^rpt\.result\./.test(k) && /base64/.test(localStorage.getItem(k) || '')); } catch { return null; } }) };
    step('after-reload', after);
    expect(!after.hasFileData && after.persistedBase64 === false, 'file data held in memory only', after);
    await shot('upload');
  });

  await scenario('chatgpt-switch-key-upload', { planLimitOnce: true, rateLimitOnce: false }, async ({ page, step, expect, shot }) => {
    const r = await signIn(page);
    expect(r.connected, 'signed in', r);
    await page.setInputFiles('#file-input', PDF);
    await page.waitForTimeout(300);
    await page.click('#btn-start');
    await poll(page, () => { const c = document.getElementById('limit-card'); return c && !c.hidden; }, 60000, 'limit card');
    await waitEnd(page);
    const j1 = await job(page);
    const planCalls = (await calls(page)).length;
    step('limited', { state: j1.state, planMode: await page.evaluate(() => RPT.state.jobs[RPT.state.currentJobId].planMode), source: j1.source, chunks: j1.chunks.map(x => x.id + ':' + x.status), planCalls });
    expect(['partial', 'cancelled'].includes(j1.state) && j1.chunks.some(x => x.status === 'failed'), 'plan job stopped by the limit', j1.state);
    await page.click('#limit-switch-key');
    await page.waitForTimeout(300);
    await keyInGate(page);
    const afterSwitch = { status: await status(page), limitCard: await limitCard(page), retryAllHidden: (await ui(page)).retryAllHidden };
    step('switched', afterSwitch);
    expect(afterSwitch.status && afterSwitch.status.mode === 'key', 'mode is key after switch', afterSwitch.status);
    expect(!afterSwitch.limitCard.visible && !afterSwitch.retryAllHidden, 'limit card hidden, retry available', afterSwitch);
    await page.click('#btn-retry-all');
    await waitEnd(page);
    const j2 = await job(page);
    const retried = (await calls(page)).slice(planCalls);
    const files = await page.evaluate(() => ({ uploads: window.__mockUploads.length, deletes: window.__mockDeletes.length }));
    await page.click('#tab-summary');
    await page.waitForTimeout(500);
    const meta = await resultMeta(page);
    step('retried-in-key-mode', { state: j2.state, summaryStatus: j2.summaryStatus, model: j2.model, source: j2.source, chunks: j2.chunks.map(x => x.id + ':' + x.status), files, retried: retried.map(x => ({ auth: x.auth, task: x.task, model: x.model, hasFileId: x.hasFileId, hasFileData: x.hasFileData, hasMeta: x.hasMeta, hasMaxOut: x.hasMaxOut })), meta: { text: meta.text, chip: meta.chip } });
    expect(j2.state === 'done' && j2.summaryStatus === 'done', 'job completed after switching to the API key', { state: j2.state, summaryStatus: j2.summaryStatus });
    expect(files.uploads === 1 && files.deletes === 1, 'PDF uploaded once to the Files API and deleted when done', files);
    expect(retried.length > 0 && retried.every(x => x.auth === 'key' && x.hasFileId && !x.hasFileData && !x.fileUrl && x.hasMeta && x.hasMaxOut), 'retried bodies are key-mode bodies with file_id', retried[0]);
    expect(retried.every(x => x.model === 'gpt-5.4-mini') && j2.model === 'gpt-5.4-mini', 'retry uses the key-mode model', { model: j2.model });
    expect(!meta.chip && /예상 비용/.test(meta.text || '') && !/ChatGPT 플랜/.test(meta.text || ''), 'header shows cost, no plan chip', meta);
    await shot('done');
  });

  await scenario('chatgpt-switch-key-midrun', { slowTranslate: true, rateLimitOnce: false }, async ({ page, step, expect }) => {
    const r = await signIn(page);
    expect(r.connected, 'signed in', r);
    await start(page, ARXIV);
    await page.waitForFunction(() => { const s = RPT.state; const j = s.currentJobId && s.jobs[s.currentJobId]; return j && j.state === 'running' && j.chunks.some(c => c.status === 'running' && c.text.length > 50); }, null, { timeout: 30000 });
    await page.click('#btn-settings');
    await page.waitForTimeout(300);
    await page.click('#btn-switch-auth');
    await page.waitForTimeout(300);
    await keyInGate(page);
    await waitEnd(page);
    const j1 = await job(page);
    const c1 = await calls(page);
    step('cancelled-by-switch', { state: j1.state, chunks: j1.chunks.map(x => x.id + ':' + x.status), auths: [...new Set(c1.map(x => x.auth))], status: await status(page), running: await page.evaluate(() => !!RPT.state.run) });
    expect(j1.state === 'cancelled', 'switching login method cancels the running job', j1.state);
    expect(c1.every(x => x.auth === 'plan'), 'no call billed to the API key before the retry', [...new Set(c1.map(x => x.auth))]);
    await page.evaluate(() => { window.__mockCfg.slowTranslate = false; });
    await page.click('#btn-retry-all');
    await waitEnd(page);
    const j2 = await job(page);
    const c2 = (await calls(page)).slice(c1.length);
    await page.click('#tab-summary');
    await page.waitForTimeout(500);
    const meta = await resultMeta(page);
    step('retried-in-key-mode', { state: j2.state, model: j2.model, chunks: j2.chunks.map(x => x.id + ':' + x.status), retried: c2.map(x => ({ auth: x.auth, task: x.task, model: x.model, hasMeta: x.hasMeta, hasMaxOut: x.hasMaxOut, fileUrl: !!x.fileUrl })), meta: { text: meta.text, chip: meta.chip } });
    expect(j2.state === 'done', 'retry completes in key mode', j2.state);
    expect(c2.length > 0 && c2.every(x => x.auth === 'key' && x.hasMeta && x.hasMaxOut && x.fileUrl && x.model === 'gpt-5.4-mini'), 'retried bodies are key-mode bodies with the key-mode model', c2[0]);
    expect(!meta.chip && /예상 비용/.test(meta.text || ''), 'header switched to cost estimate', meta);
  });

  await scenario('chatgpt-cancel-during-refresh', { rateLimitOnce: false }, async ({ page, step, expect }) => {
    const r = await signIn(page);
    expect(r.connected, 'signed in', r);
    expect(await expireTokens(page), 'token record found to expire');
    await setCfg(page, { refreshDelayMs: 1500 });
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(1000);
    await start(page, ARXIV);
    await page.waitForFunction(() => window.__mockTokenCalls.some(t => t.grant === 'refresh_token'), null, { polling: 30, timeout: 20000 });
    await page.waitForTimeout(200);
    await page.click('#btn-cancel');
    await page.waitForTimeout(2500);
    const j1 = await job(page);
    const mid = { state: j1.state, error: j1.error, tokenCalls: await tokenCalls(page), apiCalls: (await calls(page)).length, storage: await storage(page), gate: (await gate(page)).open };
    step('cancelled-during-refresh', mid);
    expect(['cancelled', 'failed'].includes(j1.state) && mid.apiCalls === 0, 'job stopped before any API call', { state: j1.state, apiCalls: mid.apiCalls });
    expect(mid.tokenCalls.filter(t => t.grant === 'refresh_token').length === 1 && mid.tokenCalls.every(t => t.ok), 'refresh completed despite the cancel', mid.tokenCalls);
    expect(mid.storage.hasTokens && mid.storage.expiresInMin !== null && mid.storage.expiresInMin >= 55, 'rotated token stored', { expiresInMin: mid.storage.expiresInMin });
    expect(!mid.gate, 'no gate after cancel', mid.gate);
    await goHome(page);
    await start(page, ARXIV);
    await waitEnd(page);
    const j2 = await job(page);
    const tc = await tokenCalls(page);
    step('next-job', { state: j2.state, tokenCalls: tc, apiCalls: (await calls(page)).length, gate: (await gate(page)).open });
    expect(j2.state === 'done', 'next job completes with the stored token', j2.state);
    expect(tc.filter(t => t.grant === 'refresh_token').length === 1 && tc.every(t => t.ok), 'no further refresh and no reuse error', tc);
  });

  await scenario('chatgpt-strip-guard', { planContextOnce: true, rateLimitOnce: false }, async ({ page, step, expect }) => {
    const r = await signIn(page);
    expect(r.connected, 'signed in', r);
    await start(page, ARXIV);
    await waitEnd(page);
    const j1 = await job(page);
    const c1 = await calls(page);
    const ev = await planEvents(page);
    const hit = ev.find(e => e.kind === 'contextLength');
    const hitCall = hit && c1.find(x => x.seq === hit.seq);
    const sameChunkCalls = hitCall ? c1.filter(x => x.task === 'translate' && x.pages === hitCall.pages).length : null;
    const failed = j1.chunks.filter(x => x.status === 'failed');
    const sto = await storage(page);
    step('context-400', { state: j1.state, events: ev, sameChunkCalls, failed: failed.map(x => ({ id: x.id, err: x.err, msg: x.msg })), stripped: sto.stripped, statusStripped: (await status(page)).stripped, allInput: c1.every(x => x.inputArray) });
    expect(j1.state === 'partial' && failed.length === 1 && /HTTP 400/.test(failed[0].err) && /context window/.test(failed[0].msg), 'only the rejected chunk fails with the server message', failed);
    expect(sameChunkCalls === 1, 'rejected body not resent', sameChunkCalls);
    expect(!sto.stripped || sto.stripped === '[]', 'nothing recorded as stripped', sto.stripped);
    expect(c1.every(x => x.inputArray), 'input kept on every call', c1.map(x => x.inputArray));
    await page.click('#btn-retry-all');
    await waitEnd(page);
    const j2 = await job(page);
    const c2 = (await calls(page)).slice(c1.length);
    step('retried', { state: j2.state, chunks: j2.chunks.map(x => x.id + ':' + x.status), retried: c2.map(x => ({ task: x.task, pages: x.pages, inputArray: x.inputArray })) });
    expect(j2.state === 'done' && c2.length === 1 && c2[0].inputArray, 'manual retry resends the chunk with input', { state: j2.state, calls: c2.length });
  });

  await scenario('chatgpt-strip-unstrippable', { planUnsupportedParamOnce: 'input', rateLimitOnce: false }, async ({ page, step, expect }) => {
    const r = await signIn(page);
    expect(r.connected, 'signed in', r);
    await start(page, ARXIV);
    await waitEnd(page);
    const j1 = await job(page);
    const c1 = await calls(page);
    const sto = await storage(page);
    step('unstrippable', { state: j1.state, error: j1.error, events: await planEvents(page), apiCalls: c1.length, stripped: sto.stripped, progress: (await ui(page)).progress });
    expect(j1.state === 'failed' && c1.length === 1, 'outline fails once without a retry', { state: j1.state, apiCalls: c1.length });
    expect(j1.error && j1.error.message === `${COPY.unsupported} (input)`, 'unsupported-option message with the param', j1.error);
    expect(!sto.stripped || sto.stripped === '[]', 'nothing recorded as stripped', sto.stripped);
    await goHome(page);
    await start(page, ARXIV);
    await waitEnd(page);
    const j2 = await job(page);
    const c2 = (await calls(page)).slice(c1.length);
    step('next-job', { state: j2.state, calls: c2.length, allInput: c2.every(x => x.inputArray) });
    expect(j2.state === 'done' && c2.every(x => x.inputArray), 'next job sends input normally', { state: j2.state, allInput: c2.every(x => x.inputArray) });
  });

  await scenario('chatgpt-strip-reasoning', { planUnsupportedParamAlways: 'reasoning.effort', rateLimitOnce: false }, async ({ page, step, expect }) => {
    const r = await signIn(page);
    expect(r.connected, 'signed in', r);
    await start(page, ARXIV);
    await waitEnd(page);
    const j1 = await job(page);
    const c1 = await calls(page);
    const ev = await planEvents(page);
    const sto = await storage(page);
    const st = await status(page);
    const withReasoning = c1.filter(x => x.hasReasoning);
    step('reasoning-stripped', { state: j1.state, summaryStatus: j1.summaryStatus, events: ev, apiCalls: c1.length, withReasoning: withReasoning.map(x => x.task), first2: c1.slice(0, 2).map(x => ({ task: x.task, hasReasoning: x.hasReasoning, effort: x.effort, verbosity: x.verbosity, format: x.format })), stripped: sto.stripped, statusStripped: st && st.stripped });
    expect(j1.state === 'done' && j1.summaryStatus === 'done', 'job done after stripping reasoning', { state: j1.state, summaryStatus: j1.summaryStatus });
    expect(ev.length === 1 && ev[0].kind === 'paramAlways' && ev[0].param === 'reasoning.effort', 'reasoning.effort rejected exactly once', ev);
    expect(withReasoning.length === 1 && c1.length >= 2 && c1[0].task === 'outline' && c1[0].hasReasoning && c1[1].task === 'outline' && !c1[1].hasReasoning && c1[1].format === 'paper_outline', 'only the first outline body carried reasoning; retry keeps text.format', c1.slice(0, 2).map(x => ({ task: x.task, hasReasoning: x.hasReasoning, format: x.format })));
    expect(c1.slice(1).every(x => !x.hasReasoning && x.effort === null), 'later bodies omit reasoning entirely', c1.slice(1).filter(x => x.hasReasoning).map(x => x.task));
    expect(c1.slice(1).some(x => x.verbosity !== null), 'text.verbosity kept (no over-strip)', c1.slice(1).map(x => x.verbosity));
    expect(Array.isArray(st && st.stripped) && st.stripped.includes('reasoning') && /"reasoning"/.test(sto.stripped || ''), 'reasoning path persisted for the session', { stripped: sto.stripped, statusStripped: st && st.stripped });
    await goHome(page);
    await start(page, ARXIV);
    await waitEnd(page);
    const j2 = await job(page);
    const c2 = (await calls(page)).slice(c1.length);
    const ev2 = await planEvents(page);
    step('next-job', { state: j2.state, calls: c2.length, events: ev2.length, anyReasoning: c2.some(x => x.hasReasoning) });
    expect(j2.state === 'done' && c2.length > 0 && ev2.length === 1 && c2.every(x => !x.hasReasoning), 'next job sends no reasoning and is never rejected', { state: j2.state, events: ev2.length, anyReasoning: c2.some(x => x.hasReasoning) });
  });

  await scenario('chatgpt-exchange-retry', { exchangeFailOnce: true }, async ({ page, step, expect, shot, auth }) => {
    await openGate(page);
    const r1 = await clickChatGPT(page, { expectWelcome: false });
    const g = await gate(page);
    const sto1 = await storage(page);
    const tc1 = await tokenCalls(page);
    step('exchange-failed', { result: r1, gate: g, storage: sto1, status: await status(page), tokenCalls: tc1, authorize: auth.requests[0] });
    expect(r1.connected === false && r1.error === COPY.exchange, 'exchange failure gate message', r1);
    expect(tc1.length === 1 && tc1[0].grant === 'authorization_code' && !tc1[0].ok, 'one failed code exchange', tc1);
    expect(!sto1.hasTokens && !/chatgpt/.test(sto1.authMode || ''), 'no tokens stored', sto1);
    expect(sto1.hasReg && sto1.regClientId === 'oaiapp_test' && !sto1.regEmail && !sto1.regSubject, 'issued client_id retained without identity', sto1);
    expect(g.open && !g.welcomeOpen && g.btnDisabled === false && !g.closeVisible, 'gate open and retryable, not cancellable', g);
    await shot('exchange-failed');
    const r2 = await clickChatGPT(page, { expectWelcome: true });
    const a2 = auth.requests[1] || {};
    const sto2 = await storage(page);
    const tc2 = await tokenCalls(page);
    step('retry', { request: a2, result: { connected: r2.connected, error: r2.error, welcome: !!r2.welcome }, storage: sto2, status: await status(page), tokenCalls: tc2 });
    expect(auth.requests.length === 2 && a2.clientId === 'oaiapp_test', 'retry authorizes with the issued client_id', a2.clientId);
    expect(a2.agentNameHint === null && a2.loginHint === null && a2.prompt === null, 'retry omits agent_name_hint/login_hint/prompt', { agentNameHint: a2.agentNameHint, loginHint: a2.loginHint, prompt: a2.prompt });
    expect(r2.connected === true && !!r2.welcome, 'connected with welcome on the retry', { connected: r2.connected, welcome: !!r2.welcome, error: r2.error });
    expect(sto2.hasTokens && sto2.regClientId === 'oaiapp_test' && sto2.regEmail === EMAIL && sto2.regSubject === 'user_test', 'registration completed with identity', sto2);
    expect(tc2.length === 1 && tc2[0].grant === 'authorization_code' && tc2[0].ok, 'second exchange succeeded', tc2);
  });

  await scenario('chatgpt-switch-key-revoke', {}, async ({ page, step, expect, shot }) => {
    const r = await signIn(page);
    expect(r.connected, 'signed in', r);
    await page.click('#btn-settings');
    await page.waitForTimeout(300);
    await page.click('#btn-switch-auth');
    await page.waitForTimeout(300);
    await keyInGate(page);
    const revoked = await page.evaluate(() => window.__mockRevoked.slice());
    const sto = await storage(page);
    const st = await status(page);
    const si = await settingsInfo(page);
    step('switched-to-key', { revoked, storage: sto, status: st, accountText: si.accountText, usageLinkVisible: si.usageLink && si.usageLink.visible });
    expect(revoked.length === 1 && revoked[0].clientId === 'oaiapp_test' && revoked[0].tokenTypeHint === 'refresh_token' && revoked[0].tokenIsCurrentRefresh, 'ChatGPT refresh token revoked on key login', revoked);
    expect(!sto.hasTokens && sto.hasReg && sto.hasApiKey && sto.authMode === 'key', 'tokens cleared, registration and key kept', sto);
    expect(st && st.mode === 'key' && !st.connected && st.hasReg, 'status in key mode', st);
    expect(si.accountText === 'OpenAI API 키', 'account text shows the API key', si.accountText);
    await page.evaluate(() => { location.hash = '#home'; });
    await page.waitForTimeout(300);
    await page.click('#btn-logout');
    await page.waitForTimeout(400);
    const ci = await confirmInfo(page);
    if (ci.open) await page.click('#confirm-ok');
    await page.waitForFunction(() => document.getElementById('gate').open, null, { timeout: 10000 });
    await page.waitForTimeout(400);
    const g = await gate(page);
    const sto2 = await storage(page);
    step('key-logout', { confirm: ci, gate: g, storage: sto2, revoked: await page.evaluate(() => window.__mockRevoked.length) });
    expect(ci.open && ci.ok === '키 삭제', 'key-mode logout confirm', ci);
    expect(g.open && !g.closeVisible, 'gate not cancellable without any session', g);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    expect((await gate(page)).open, 'Escape does not close the gate');
    expect(!sto2.hasApiKey && !sto2.hasTokens && sto2.hasReg, 'key removed, no stale tokens', sto2);
    await shot('logged-out');

    await setCfg(page, { revokeFails: true });
    const r2 = await clickChatGPT(page, { expectWelcome: false });
    expect(r2.connected === true && !r2.welcome, 'signed in again without welcome', r2);
    await page.click('#btn-settings');
    await page.waitForTimeout(300);
    await page.click('#btn-switch-auth');
    await page.waitForTimeout(300);
    await keyInGate(page);
    const u = await ui(page);
    const sto3 = await storage(page);
    step('switched-revoke-fails', { toasts: u.toasts, storage: sto3, status: await status(page), revoked: await page.evaluate(() => window.__mockRevoked.length) });
    expect(u.toasts.some(t => t.includes(COPY.revokeFail)) && u.toasts.some(t => t.includes(COPY.loggedIn)), 'revoke failure toast plus login toast', u.toasts);
    expect(!sto3.hasTokens && sto3.hasApiKey && sto3.authMode === 'key' && !u.gateOpen, 'tokens cleared locally even when revoke fails', { storage: sto3, gateOpen: u.gateOpen });
  });

  await scenario('chatgpt-deny', {}, async ({ page, step, expect, shot, auth }) => {
    await openGate(page);
    const r = await clickChatGPT(page);
    const g = await gate(page);
    const sto = await storage(page);
    step('denied', { result: r, gate: g, storage: sto, status: await status(page), tokenCalls: await tokenCalls(page), authorize: auth.requests[0] });
    expect(r.connected === false && r.error === COPY.denied, 'denied gate message', r);
    expect(g.open && !g.welcomeOpen && g.btnDisabled === false, 'gate open, no welcome, button re-enabled', g);
    expect(!sto.hasTokens && !/chatgpt/.test(sto.authMode || ''), 'no tokens stored', sto);
    expect((await tokenCalls(page)).length === 0, 'no token exchange on deny');
    expect(r.search === '', 'callback query removed', r.search);
    await shot('denied');
  }, { deny: true });

  await scenario('chatgpt-noscope', { authNoPlanScope: true }, async ({ page, step, expect, shot, auth }) => {
    await openGate(page);
    const r = await clickChatGPT(page);
    const g = await gate(page);
    step('noscope', { result: r, gate: g, storage: await storage(page), status: await status(page), tokenCalls: await tokenCalls(page) });
    expect(r.connected === false && r.error === COPY.noScope, 'missing-scope gate message', r);
    expect(g.open && !g.welcomeOpen, 'gate open without welcome', g);
    await shot('noscope');
    await setCfg(page, { authNoPlanScope: false });
    const r2 = await clickChatGPT(page, { expectWelcome: true });
    const a2 = auth.requests[1] || {};
    step('reconsent', { request: a2, result: { connected: r2.connected, error: r2.error, welcome: !!r2.welcome }, status: await status(page), storage: await storage(page) });
    expect(a2.prompt === 'consent', 'reconsent sends prompt=consent', a2.prompt);
    expect(a2.clientId === 'oaiapp_test' && a2.agentNameHint === null, 'reconsent reuses issued client_id', { clientId: a2.clientId, agentNameHint: a2.agentNameHint });
    expect(r2.connected === true && !!r2.welcome, 'connected with welcome after consent', { connected: r2.connected, welcome: !!r2.welcome, error: r2.error });
  });

  await scenario('chatgpt-admission401', { planAdmission401Once: true, rateLimitOnce: false }, async ({ page, step, expect }) => {
    const r = await signIn(page);
    expect(r.connected, 'signed in', r);
    await start(page, ARXIV);
    await waitEnd(page);
    const j = await job(page);
    const c = await calls(page);
    const tc = await tokenCalls(page);
    step('recovered', { state: j.state, summaryStatus: j.summaryStatus, chunks: j.chunks.map(x => x.id + ':' + x.status), events: await planEvents(page), tokenCalls: tc, firstTasks: c.slice(0, 3).map(x => x.task), gateOpen: (await gate(page)).open });
    expect(j.state === 'done', 'job done after refresh+retry', j.state);
    expect(tc.filter(t => t.grant === 'refresh_token').length === 1 && tc.every(t => t.ok), 'one refresh after admission 401', tc);
    expect(c.length >= 2 && c[0].task === 'outline' && c[1].task === 'outline', 'outline retried once', c.slice(0, 2).map(x => x.task));
    expect(!(await gate(page)).open, 'gate stays closed');
  });

  await scenario('chatgpt-admission401-persist', { planAdmission401Always: true, rateLimitOnce: false }, async ({ page, step, expect, shot }) => {
    const r = await signIn(page);
    expect(r.connected, 'signed in', r);
    await start(page, ARXIV);
    const settled = await poll(page, () => { const g = document.getElementById('gate'); const e = document.getElementById('gate-error'); return g.open && !e.hidden && e.textContent.trim() ? { error: e.textContent.trim() } : null; }, 30000, 'gate after persistent 401').catch(() => null);
    await page.waitForTimeout(800);
    const info = { settled, job: (({ state, chunks }) => ({ state, chunks: chunks.map(x => x.id + ':' + x.status) }))((await job(page)) || { state: null, chunks: [] }), tokenCalls: await tokenCalls(page), apiCalls: (await calls(page)).length, storage: await storage(page), status: await status(page) };
    step('persistent-401', info);
    expect(settled && settled.error === COPY.expired, 'gate shows expired message', settled);
    expect(info.tokenCalls.filter(t => t.grant === 'refresh_token').length === 1, 'single refresh attempt, no loop', info.tokenCalls);
    expect(info.apiCalls === 2, 'original + one retry only', info.apiCalls);
    expect(!info.storage.hasTokens && info.storage.hasReg, 'tokens cleared, registration kept', info.storage);
    await shot('gate');
  });

  await scenario('chatgpt-ineligible', { planNotEligible: true, rateLimitOnce: false }, async ({ page, step, expect, shot }) => {
    const r = await signIn(page);
    expect(r.connected, 'signed in', r);
    await start(page, ARXIV);
    const settled = await poll(page, () => { const g = document.getElementById('gate'); const e = document.getElementById('gate-error'); return g.open && !e.hidden && e.textContent.trim() ? { error: e.textContent.trim() } : null; }, 30000, 'gate after not-eligible').catch(() => null);
    await waitEnd(page);
    const j = await job(page);
    const info = { settled, state: j.state, error: j.error, events: await planEvents(page), apiCalls: (await calls(page)).length, tokenCalls: await tokenCalls(page), storage: await storage(page), gate: await gate(page) };
    step('ineligible', info);
    expect(settled && settled.error === COPY.ineligible, 'gate shows not-eligible message', settled);
    expect(['failed', 'cancelled'].includes(j.state), 'job stopped', j.state);
    expect(info.apiCalls === 1, 'no retry after 403', info.apiCalls);
    expect(info.tokenCalls.filter(t => t.grant === 'refresh_token').length === 0, 'no refresh on 403', info.tokenCalls);
    expect(info.storage.hasTokens && info.gate.closeVisible, 'session kept, gate cancellable', { hasTokens: info.storage.hasTokens, closeVisible: info.gate.closeVisible });
    await shot('gate');
  });

  await scenario('chatgpt-models-fail', { planModelsFail: 'forbidden', planModelsFailOnce: true, rateLimitOnce: false }, async ({ page, step, expect, shot }) => {
    const r = await signIn(page);
    expect(r.connected, 'signed in despite model-list failure', r);
    await page.fill('#url-input', ARXIV);
    await page.waitForTimeout(200);
    const home = () => page.evaluate(() => ({
      note: document.getElementById('model-help').hidden ? null : document.getElementById('model-help-text').textContent,
      options: [...document.getElementById('model-select').options].map(o => o.value),
      startDisabled: document.getElementById('btn-start').disabled,
      badge: document.getElementById('model-badge').textContent,
      toasts: document.getElementById('toast-region').textContent
    }));
    const before = { ...(await home()), status: await status(page) };
    step('models-failed', before);
    expect(before.options.length === 0 && before.startDisabled && before.badge === '-', 'no models, start disabled', before);
    expect(!!before.note && /HTTP 403/.test(before.note) && /subscription_sharing_user_not_eligible/.test(before.note), 'home note shows the reason', before.note);
    expect(before.status.models === 0 && /HTTP 403/.test(before.status.modelsError || ''), 'status exposes modelsError', before.status);
    await shot('models-failed');
    await page.click('#btn-models-retry');
    await poll(page, () => document.getElementById('model-select').options.length > 0, 10000, 'models after retry');
    const after = { ...(await home()), status: await status(page) };
    step('models-retried', after);
    expect(after.options.join(',') === 'gpt-6.1-sol,gpt-6.1-mini' && !after.startDisabled && after.note === null, 'retry loads the catalog and enables start', after);
    expect(after.status.modelsError === '' && after.status.models === 2, 'error cleared', after.status);
    await page.evaluate(() => { window.__mockOnce.planModelsFail = false; });
    await setCfg(page, { planModelsFail: 'legacy' });
    await page.click('#btn-settings');
    await page.waitForFunction(() => document.getElementById('settings').open, null, { timeout: 5000 });
    const refreshVisible = await page.evaluate(() => !document.getElementById('btn-models-refresh').hidden);
    expect(refreshVisible, 'settings refresh button visible in plan mode');
    await page.click('#btn-models-refresh');
    await poll(page, () => [...document.getElementById('set-model').options].map(o => o.value).join(',') === 'gpt-5.4-mini,gpt-5.4', 10000, 'legacy catalog');
    const legacy = await page.evaluate(() => ({ options: [...document.getElementById('set-model').options].map(o => o.value), help: document.getElementById('set-model-help').textContent, badge: document.getElementById('model-badge').textContent }));
    step('legacy-shape', legacy);
    expect(legacy.options.join(',') === 'gpt-5.4-mini,gpt-5.4' && legacy.help === COPY.modelHelpPlan && legacy.badge === 'gpt-5.4-mini', 'legacy data[] shape accepted, o3 filtered', legacy);
    await setCfg(page, { planModelsFail: 'network', planModelsFailOnce: false });
    await page.click('#btn-models-refresh');
    await poll(page, () => /네트워크/.test(document.getElementById('toast-region').textContent), 10000, 'network toast');
    const net = await page.evaluate(() => ({ toast: document.getElementById('toast-region').textContent, options: document.getElementById('set-model').options.length, help: document.getElementById('set-model-help').textContent, startDisabled: document.getElementById('btn-start').disabled, status: RPT.auth.status() }));
    step('network-error', net);
    expect(net.options === 2 && !net.startDisabled && net.help === COPY.modelHelpPlan, 'cached catalog kept when a refresh fails', net);
    expect(/네트워크/.test(net.status.modelsError), 'network failure recorded in status', net.status);
    await shot('settings-network');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    await setCfg(page, { planModelsFail: 'hidden' });
    await page.evaluate(() => { localStorage.removeItem('rpt.settings.v1'); });
    await page.reload({ waitUntil: 'load' });
    await poll(page, () => { const n = document.getElementById('model-help'); return n && !n.hidden ? document.getElementById('model-help-text').textContent : null; }, 15000, 'hidden-only note');
    const hidden = await home();
    step('hidden-only', hidden);
    expect(hidden.options.length === 0 && /visibility hidden/.test(hidden.note || ''), 'all-hidden catalog explains itself', hidden);
  });

  await scenario('chatgpt-no-proxy', { proxyMissing: true }, async ({ page, step, expect, shot, auth }) => {
    await openGate(page);
    await page.click('#btn-chatgpt');
    const settled = await poll(page, () => { const e = document.getElementById('gate-error'); return !e.hidden && e.textContent.trim() ? { error: e.textContent.trim() } : null; }, 10000, 'gate error').catch(() => null);
    await page.waitForTimeout(400);
    const g = await gate(page);
    const st = await status(page);
    const sto = await storage(page);
    step('no-proxy', { settled, gate: g, status: st, authorize: auth.requests.length, tokenCalls: await tokenCalls(page), storage: sto, href: await page.evaluate(() => location.href) });
    expect(settled && settled.error === COPY.noProxy && g.error === COPY.noProxy, 'gate shows the serve.py notice', settled);
    expect(auth.requests.length === 0 && !sto.pending, 'no authorize navigation', { requests: auth.requests.length, pending: sto.pending });
    expect(g.open && g.btnDisabled === false && g.btnText === COPY.button && !g.closeVisible, 'button re-enabled, gate stays', g);
    expect(st && st.proxy === false && !st.connected && !sto.hasTokens, 'status reports proxy false, no session', { proxy: st && st.proxy, connected: st && st.connected, hasTokens: sto.hasTokens });
    await shot('no-proxy');
  });

  await scenario('chatgpt-no-proxy-localhost', { proxyMissing: true }, async ({ page, step, expect, auth }) => {
    const localUrl = BASE.replace('127.0.0.1', 'localhost');
    if (localUrl === BASE) { step('skipped', { reason: 'BASE is not 127.0.0.1' }); return; }
    try { await openGate(page, localUrl); }
    catch (e) { step('skipped', { reason: 'localhost not reachable: ' + e.message.split('\n')[0] }); return; }
    const r = await clickChatGPT(page, { expectWelcome: false });
    const g = await gate(page);
    const st = await status(page);
    const sto = await storage(page);
    const href = await page.evaluate(() => location.href);
    step('no-proxy-localhost', { result: r, gate: g, status: st, authorize: auth.requests.length, storage: sto, href });
    expect(/^http:\/\/127\.0\.0\.1:/.test(href) && r.search === '', 'handed off to 127.0.0.1 with the start flag consumed', href);
    expect(r.connected === false && r.error === COPY.noProxy && g.error === COPY.noProxy, 'gate shows the serve.py notice after the hand-off', r);
    expect(auth.requests.length === 0 && !sto.pending, 'no authorize navigation', { requests: auth.requests.length, pending: sto.pending });
    expect(g.open && g.btnDisabled === false && g.btnText === COPY.button && st && st.proxy === false, 'button re-enabled, proxy false', { btnDisabled: g.btnDisabled, btnText: g.btnText, proxy: st && st.proxy });
  });

  await scenario('chatgpt-proxy-lost', { rateLimitOnce: false }, async ({ page, step, expect, shot }) => {
    const r = await signIn(page);
    expect(r.connected, 'signed in', r);
    await setCfg(page, { proxyMissing: true });
    const t0 = Date.now();
    await start(page, ARXIV);
    await waitEnd(page);
    const elapsedMs = Date.now() - t0;
    const j = await job(page);
    const u = await ui(page);
    const tc = await tokenCalls(page);
    const sto = await storage(page);
    const st = await status(page);
    const hits = await proxyHits(page);
    step('proxy-lost', { state: j.state, error: j.error, chunks: j.chunks.length, ui: u, apiCalls: (await calls(page)).length, proxyHits: hits, elapsedMs, tokenCalls: tc, storage: sto, status: st });
    expect(j.state === 'failed' && j.error && j.error.message === COPY.noProxy, 'job fails with the serve.py notice', { state: j.state, error: j.error });
    expect(j.error && j.error.code === 'HTTP 501', 'POST answered like python -m http.server (501)', j.error);
    expect(hits === 1 && elapsedMs < 5000, 'single relay attempt, no retry', { proxyHits: hits, elapsedMs });
    expect(/중계 기능이 없습니다/.test(u.progress), 'notice shown in the progress card', u.progress);
    expect(tc.filter(t => t.grant === 'refresh_token').length === 0, 'no token refresh', tc);
    expect(sto.hasTokens && st && st.connected && !u.gateOpen, 'tokens kept, gate closed', { hasTokens: sto.hasTokens, connected: st && st.connected, gateOpen: u.gateOpen });
    expect(st && st.proxy === false, 'status reports proxy false', st && st.proxy);
    await shot('proxy-lost');
  });

  await scenario('chatgpt-upstream-down', { rateLimitOnce: false }, async ({ page, step, expect, shot }) => {
    const r = await signIn(page);
    expect(r.connected, 'signed in', r);
    await setCfg(page, { proxyUpstreamDown: true });
    await start(page, ARXIV);
    await waitEnd(page);
    const j = await job(page);
    const u = await ui(page);
    const sto = await storage(page);
    const st = await status(page);
    const hits = await proxyHits(page);
    step('upstream-down', { state: j.state, error: j.error, ui: u, proxyHits: hits, tokenCalls: await tokenCalls(page), storage: sto, status: st });
    expect(j.state === 'failed' && j.error && j.error.message === COPY.network && j.error.code === 'HTTP 502', 'job fails with the network notice', { state: j.state, error: j.error });
    expect(hits === 4, 'initial attempt plus three retries', hits);
    expect(/OpenAI에 연결할 수 없습니다/.test(u.progress), 'network notice in the progress card', u.progress);
    expect(sto.hasTokens && st && st.connected && !u.gateOpen && st.proxy === true, 'tokens kept, proxy still reported', { hasTokens: sto.hasTokens, connected: st && st.connected, gateOpen: u.gateOpen, proxy: st && st.proxy });
    await shot('upstream-down');
  });

  await scenario('visual-390', { planLimitOnce: true, rateLimitOnce: false }, async ({ page, step, expect, shot }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openGate(page);
    const g = await fit(page, '#gate');
    step('gate-390', g);
    expect(fits(g), 'gate fits 390px', g);
    await shot('gate-390');
    const r = await clickChatGPT(page, { expectWelcome: true, beforeOk: async () => { const w = await fit(page, '#welcome'); step('welcome-390', w); expect(fits(w), 'welcome fits 390px', w); await shot('welcome-390'); } });
    expect(r.connected && !!r.welcome, 'signed in with welcome', r);
    await start(page, ARXIV);
    await poll(page, () => { const c = document.getElementById('limit-card'); return c && !c.hidden; }, 60000, 'limit card');
    await waitEnd(page);
    const lc = await fit(page, '#limit-card');
    const rm = await fit(page, '#result-meta');
    const hd = await fit(page, '#topbar');
    step('result-390', { limitCard: lc, resultMeta: rm, header: hd });
    expect(fits(lc) && fits(rm) && fits(hd), 'limit card, result meta and header fit 390px', { lc, rm, hd });
    await shot('limit-390');
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.waitForTimeout(300);
    await shot('limit-390-dark');
    await page.click('#limit-switch-key');
    await page.waitForTimeout(400);
    const g2 = await fit(page, '#gate');
    expect(fits(g2), 'gate fits 390px (dark)', g2);
    await shot('gate-390-dark');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
  });

  await scenario('file-mode', {}, async ({ page, step, expect, shot }) => {
    if (FILE_URL.startsWith('file:') && !fs.existsSync(fileURLToPath(FILE_URL))) { step('skipped', { reason: 'index.html not found; set FILE_URL', fileUrl: FILE_URL }); return; }
    await openGate(page, FILE_URL);
    const g = await gate(page);
    step('gate', g);
    expect(g.btn && g.btnDisabled === true, 'chatgpt button disabled on file://', { btn: g.btn, disabled: g.btnDisabled });
    expect(g.hintVisible && g.hint === COPY.hint && g.hintHasCode && g.hintRole === 'note', 'loopback hint visible with command', { visible: g.hintVisible, hint: g.hint, code: g.hintHasCode, role: g.hintRole });
    await shot('gate');
    await page.fill('#api-key', 'sk-test-valid-key-123');
    await page.click('#btn-login');
    await page.waitForFunction(() => !document.getElementById('gate').open, null, { timeout: 10000 });
    await page.waitForTimeout(500);
    const m = await models(page);
    const st = await status(page);
    step('key-login', { models: m, status: st, storage: await storage(page) });
    expect(m.options.length > 0 && m.options.every(o => /^gpt-5/.test(o)), 'key-mode model list', m.options);
    expect(st && st.mode === 'key', 'status mode key', st);
    await page.fill('#url-input', ARXIV);
    await page.waitForTimeout(200);
    expect(!(await page.evaluate(() => document.getElementById('btn-start').disabled)), 'start enabled in key mode');
  });

  await scenario('key-mode-regression', { slowTranslate: true }, async ({ page, step, expect, shot }) => {
    await loginKey(page);
    for (const [label, url] of [['scheme', 'hello world'], ['paywalled', 'https://ieeexplore.ieee.org/document/9999999'], ['scholar', 'https://scholar.google.com/scholar?q=attention'], ['unsupported', 'https://example.com/some/page']]) {
      await page.fill('#url-input', url);
      await page.waitForTimeout(150);
      const disabled = await page.evaluate(() => document.getElementById('btn-start').disabled);
      if (!disabled) { await page.click('#btn-start'); await page.waitForTimeout(800); }
      const info = { disabled, error: await page.evaluate(() => ({ hidden: document.getElementById('url-error').hidden, text: document.getElementById('url-error').textContent })), hash: await page.evaluate(() => location.hash), calls: await page.evaluate(() => window.__mockCalls.length) };
      step(label, info);
      expect(info.calls === 0 && (info.disabled || !info.error.hidden), `url rejected: ${label}`, info);
    }
    await start(page, ARXIV);
    await page.waitForFunction(() => { const s = RPT.state; const j = s.currentJobId && s.jobs[s.currentJobId]; return j && j.state === 'running' && j.chunks.some(c => c.status === 'running' && c.text.length > 50); }, null, { timeout: 30000 });
    await page.click('#btn-cancel');
    await page.waitForTimeout(900);
    const j1 = await job(page);
    step('after-cancel', { state: j1.state, chunks: j1.chunks.map(x => x.id + ':' + x.status), ui: await ui(page), chips: await chips(page) });
    expect(j1.state === 'cancelled' && j1.chunks.some(x => x.status === 'failed'), 'cancel stops the job', j1.state);
    await page.evaluate(() => { window.__mockCfg.slowTranslate = false; });
    await page.click('#btn-retry-all');
    await waitEnd(page);
    const j2 = await job(page);
    const c = await calls(page);
    step('after-retry', { state: j2.state, chunks: j2.chunks.map(x => x.id + ':' + x.status), auths: [...new Set(c.map(x => x.auth))], hasMeta: c.every(x => x.hasMeta), fileUrl: c.every(x => !!x.fileUrl), viaProxy: c.some(x => x.viaProxy), calls: c.length });
    expect(j2.state === 'done', 'retry completes the job', j2.state);
    expect(c.every(x => x.auth === 'key' && x.hasMeta && x.hasMaxOut), 'key-mode bodies unchanged', c[0]);
    expect(c.length > 0 && c.every(x => x.viaProxy === false), 'key-mode calls go straight to api.openai.com', c.map(x => x.viaProxy));
    await shot('done');
  });

  await scenario('legacy-job-retry', { rateLimitOnce: false }, async ({ page, step, expect }) => {
    await loginKey(page);
    await start(page, ARXIV);
    await waitEnd(page);
    const j1 = await job(page);
    expect(j1.state === 'done', 'url job done', j1.state);
    const legacy = await page.evaluate(async (id) => {
      const rec = await RPT.store.loadJob(id);
      delete rec.planMode; delete rec.modelLabel;
      rec.model = 'gpt-5.4';
      rec.chunks[1].status = 'failed'; rec.chunks[1].text = ''; rec.chunks[1].error = 'HTTP 500'; rec.chunks[1].errorCode = 'HTTP 500';
      rec.state = 'partial';
      await RPT.store.saveJob(rec);
      const back = await RPT.store.loadJob(id);
      return { hasPlanMode: 'planMode' in back, model: back.model, state: back.state };
    }, j1.id);
    step('legacy-record', legacy);
    expect(!legacy.hasPlanMode && legacy.model === 'gpt-5.4' && legacy.state === 'partial', 'legacy record stored', legacy);
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => !document.getElementById('view-result').hidden && document.querySelectorAll('#tr-main article.section-card').length > 0, null, { timeout: 10000 });
    await page.waitForTimeout(500);
    const before = { model: (await job(page)).model, meta: (await resultMeta(page)).text, retryAllHidden: (await ui(page)).retryAllHidden };
    step('restored', before);
    expect(before.model === 'gpt-5.4' && /^gpt-5\.4 · /.test(before.meta || '') && !before.retryAllHidden, 'header shows the stored model, retry offered', before);
    await page.click('#btn-retry-all');
    await waitEnd(page);
    const j2 = await job(page);
    const c2 = await calls(page);
    step('retried', { state: j2.state, model: j2.model, calls: c2.map(x => ({ task: x.task, model: x.model, auth: x.auth })), meta: (await resultMeta(page)).text });
    expect(j2.state === 'done' && j2.model === 'gpt-5.4', 'retry keeps the stored model', { state: j2.state, model: j2.model });
    expect(c2.length === 1 && c2[0].model === 'gpt-5.4' && c2[0].auth === 'key', 'retried body uses the stored model', c2);

    await goHome(page);
    await setCfg(page, { slowTranslate: true });
    await page.setInputFiles('#file-input', PDF);
    await page.waitForTimeout(300);
    await page.click('#btn-start');
    await page.waitForFunction(() => { const s = RPT.state; const j = s.currentJobId && s.jobs[s.currentJobId]; return j && j.state === 'running' && j.chunks.some(c => c.status === 'running' && c.text.length > 50); }, null, { timeout: 30000 });
    await page.click('#btn-cancel');
    await page.waitForTimeout(900);
    const j3 = await job(page);
    const legacyFile = await page.evaluate(async (id) => {
      const rec = await RPT.store.loadJob(id);
      delete rec.planMode; delete rec.modelLabel;
      await RPT.store.saveJob(rec);
      const back = await RPT.store.loadJob(id);
      return { hasPlanMode: 'planMode' in back, fileId: back.source.fileId, fileDeleted: back.source.fileDeleted, state: back.state, uploads: window.__mockUploads.length };
    }, j3.id);
    step('legacy-upload-record', { state: j3.state, chunks: j3.chunks.map(x => x.id + ':' + x.status), legacyFile });
    expect(j3.state === 'cancelled' && !legacyFile.hasPlanMode && legacyFile.fileId === 'file-mock' && !legacyFile.fileDeleted && legacyFile.uploads === 1, 'cancelled upload job keeps a live file_id', legacyFile);
    await setCfg(page, { slowTranslate: false });
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => !document.getElementById('view-result').hidden && document.querySelectorAll('#tr-main article.section-card').length > 0, null, { timeout: 10000 });
    await page.waitForTimeout(500);
    await page.click('#btn-retry-all');
    await page.waitForTimeout(800);
    const early = await ui(page);
    await waitEnd(page);
    const j4 = await job(page);
    const c4 = await calls(page);
    const files = await page.evaluate(() => ({ uploads: window.__mockUploads.length, deletes: window.__mockDeletes.length }));
    step('upload-retried', { state: j4.state, source: j4.source, chunks: j4.chunks.map(x => x.id + ':' + x.status), files, calls: c4.map(x => ({ task: x.task, hasFileId: x.hasFileId, hasFileData: x.hasFileData })), earlyToasts: early.toasts });
    expect(!early.toasts.some(t => t.includes(COPY.fileExpired)), 'no file-expired toast', early.toasts);
    expect(j4.state === 'done' && files.uploads === 0 && files.deletes === 1 && c4.length > 0 && c4.every(x => x.auth === 'key' && x.hasFileId && !x.hasFileData), 'retry resends the stored file_id without re-uploading', { state: j4.state, files, calls: c4.length });
  });

  await scenario('ideas-retry', { ideasFailOnce: true, rateLimitOnce: false }, async ({ page, step, expect, shot }) => {
    await loginKey(page);
    await start(page, ARXIV);
    await waitEnd(page);
    const j1 = await job(page);
    const u1 = await ui(page);
    await page.keyboard.press('3');
    await page.waitForTimeout(400);
    const p1 = await ideasPanel(page);
    step('after-failure', { state: j1.state, summaryStatus: j1.summaryStatus, ideasStatus: j1.ideasStatus, ideasError: j1.ideasError, chunks: j1.chunks.map(x => x.id + ':' + x.status), ui: u1, panel: p1 });
    expect(j1.state === 'partial' && j1.summaryStatus === 'done' && j1.ideasStatus === 'failed' && j1.chunks.every(x => x.status !== 'failed'), 'ideas failure alone makes the job partial', { state: j1.state, ideasStatus: j1.ideasStatus });
    expect(!u1.retryAllHidden, 'retry-all offered for the failed ideas', u1.retryAllHidden);
    expect(p1.tab === 'tab-ideas' && /\/ideas$/.test(p1.hash) && !p1.hidden, 'key 3 opens the ideas tab', p1);
    expect(p1.kind === 'failed' && p1.notice === '주제 제안을 만들지 못했습니다. Mock ideas failure' && JSON.stringify(p1.buttons) === JSON.stringify(['다시 만들기']) && p1.cards === 0, 'failed notice with 다시 만들기', p1);
    await shot('failed');
    const n1 = (await calls(page)).length;
    await page.click('#btn-retry-all');
    await waitEnd(page);
    const j2 = await job(page);
    const c2 = (await calls(page)).slice(n1);
    const p2 = await ideasPanel(page);
    step('after-retry-all', { state: j2.state, ideasStatus: j2.ideasStatus, ideaCount: j2.ideaCount, calls: c2.map(x => x.task), panel: p2, ui: await ui(page) });
    expect(j2.state === 'done' && j2.ideasStatus === 'done' && j2.ideaCount === 5, 'retry-all regenerates the ideas', { state: j2.state, ideasStatus: j2.ideasStatus, ideasError: j2.ideasError });
    expect(c2.length === 1 && c2[0].task === 'ideas', 'retry-all sends only the ideas call', c2.map(x => x.task));
    expect(p2.kind === 'ideas' && p2.cards === 5 && JSON.stringify(p2.buttons) === JSON.stringify(['다시 만들기']), 'ideas rendered with 다시 만들기', p2);
    expect((await ui(page)).retryAllHidden, 'retry-all hidden once everything is done');
    await page.click('#panel-ideas button[data-ideas-action]');
    await poll(page, () => { const s = RPT.state; const j = s.jobs[s.currentJobId]; return window.__mockCalls.length > 0 && j.state === 'done' && j.ideasStatus === 'done' && !s.run; }, 20000, 'ideas regenerated');
    await page.waitForTimeout(300);
    const c3 = (await calls(page)).slice(n1 + c2.length);
    const p3 = await ideasPanel(page);
    step('after-regenerate', { calls: c3.map(x => x.task), panel: p3 });
    expect(c3.length === 1 && c3[0].task === 'ideas' && p3.cards === 5, '다시 만들기 sends one ideas call', { calls: c3.map(x => x.task), cards: p3.cards });
    await shot('done');
  });

  await scenario('legacy-ideas', { rateLimitOnce: false }, async ({ page, step, expect, shot }) => {
    await loginKey(page);
    await start(page, ARXIV);
    await waitEnd(page);
    const j1 = await job(page);
    const seeded = await page.evaluate(async (id) => {
      const rec = await RPT.store.loadJob(id);
      delete rec.ideasStatus; delete rec.ideas; delete rec.ideasError;
      await RPT.store.saveJob(rec);
      const back = await RPT.store.loadJob(id);
      return { hasIdeasFields: ['ideasStatus', 'ideas', 'ideasError'].some(k => k in back), state: back.state };
    }, j1.id);
    step('seeded', seeded);
    expect(!seeded.hasIdeasFields && seeded.state === 'done', 'v1.2.0-shaped record stored', seeded);
    await page.evaluate((id) => { location.hash = `#result/${id}/ideas`; }, j1.id);
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => !document.getElementById('view-result').hidden && !document.getElementById('panel-ideas').hidden, null, { timeout: 10000 });
    await page.waitForTimeout(500);
    const p1 = await ideasPanel(page);
    const j2 = await job(page);
    step('reopened', { panel: p1, state: j2.state, ideasStatus: j2.ideasStatus === undefined ? 'undefined' : j2.ideasStatus, calls: (await calls(page)).length, progress: (await ui(page)).progress });
    expect(p1.tab === 'tab-ideas' && p1.kind === 'notice' && p1.notice === '이 분석에는 주제 제안이 없습니다.' && JSON.stringify(p1.buttons) === JSON.stringify(['주제 제안 만들기']), 'legacy notice with 주제 제안 만들기', p1);
    expect(j2.state === 'done' && j2.ideasStatus === undefined && (await calls(page)).length === 0, 'reopening makes no API call and keeps the record as is', { state: j2.state, ideasStatus: j2.ideasStatus });
    await shot('legacy');
    await page.click('#panel-ideas button[data-ideas-action]');
    await poll(page, () => { const s = RPT.state; const j = s.jobs[s.currentJobId]; return j.ideasStatus === 'done' && j.state === 'done' && !s.run; }, 20000, 'ideas generated');
    await page.waitForTimeout(400);
    const c = await calls(page);
    const p2 = await ideasPanel(page);
    const stored = await page.evaluate(async (id) => { const r = await RPT.store.loadJob(id); return { ideasStatus: r.ideasStatus, count: r.ideas && r.ideas.ideas ? r.ideas.ideas.length : 0, state: r.state }; }, j1.id);
    step('generated', { calls: c.map(x => x.task + ':' + x.format), panel: p2, stored, progress: (await ui(page)).progress });
    expect(c.length === 1 && c[0].task === 'ideas' && c[0].format === 'paper_ideas', 'only the ideas call is sent', c.map(x => x.task));
    expect(p2.kind === 'ideas' && p2.cards === 5, 'ideas rendered for the legacy record', p2);
    expect(stored.ideasStatus === 'done' && stored.count === 5 && stored.state === 'done', 'ideas persisted with the record', stored);
    await page.keyboard.press('4');
    await page.waitForTimeout(300);
    const t4 = await page.evaluate(() => ({ tab: document.querySelector('#tabs [aria-selected="true"]').id, hash: location.hash }));
    step('key-4', t4);
    expect(t4.tab === 'tab-source' && /\/source$/.test(t4.hash), 'key 4 opens the source tab', t4);
  });

  await scenario('toc-subheadings', { rateLimitOnce: false }, async ({ page, step, expect, shot }) => {
    await loginKey(page);
    await start(page, ARXIV);
    await waitEnd(page);
    await page.click('#tab-translation');
    await page.waitForTimeout(800);
    const j = await job(page);
    const toc = await tocInfo(page);
    const byId = Object.fromEntries(j.chunks.map(c => [c.id, c]));
    const labels = subLabels(toc);
    step('toc', { chunks: j.chunks.map(c => c.id + ':' + c.kind + ':' + c.status), labels, depths: toc.map(t => t.subs.map(x => x.depth).join('')) });
    const body = toc.filter(t => byId[t.sec] && (byId[t.sec].kind === 'body' || byId[t.sec].kind === 'appendix'));
    expect(toc.length === j.chunks.length, 'one TOC entry per section', toc.length);
    expect(body.length >= 4 && body.every(t => t.subs.length >= 3), 'every body section lists its sub-headings', labels);
    expect(toc.filter(t => byId[t.sec] && (byId[t.sec].kind === 'abstract' || byId[t.sec].kind === 'references')).every(t => t.subs.length === 0), 'abstract and references have no sub-headings', labels);
    const merged = toc.find(t => t.subs.some(x => x.label === '2 Background'));
    expect(!!merged && sameLabels(merged.subs.map(x => x.label), ['1.1 라우팅 구조', '1.1.1 게이트 계산', '1.2 전문가 수 k의 영향', '2 Background']) && merged.subs.map(x => x.depth).join('') === '1211', 'merged section labels and depths', merged && merged.subs);
    expect(toc.every(t => t.subs.every(x => x.target && /^#sec-c\d+-h\d+$/.test(x.href))), 'every sub-link points at its own heading (tabindex -1)', toc.map(t => t.subs.filter(x => !x.target).length));
    expect(toc.every(t => t.subs.every(x => !/kk|\$/.test(x.label))), 'math in labels is not duplicated', labels);
    const split = toc.filter(t => byId[t.sec] && /^3\./.test((t.subs[0] || {}).label || ''));
    expect(split.length === 2 && sameLabels(split[0].subs.map(x => x.label), ['3.1 라우팅 구조', '3.1.1 게이트 계산', '3.2 전문가 수 k의 영향']) && sameLabels(split[1].subs.map(x => x.label), ['3.3 라우팅 구조', '3.3.1 게이트 계산', '3.4 전문가 수 k의 영향']), 'split section continues the numbering', split.map(t => t.subs.map(x => x.label)));
    const layout = await page.evaluate(() => {
      const li = [...document.querySelectorAll('#toc-list > li')].find(x => x.querySelector('.toc-sub-link'));
      const sec = li.querySelector(':scope > a');
      const a = sec.getBoundingClientRect();
      const subs = [...li.querySelectorAll('.toc-sub-link')];
      const r0 = subs[0].getBoundingClientRect();
      const d2 = subs.find(x => x.dataset.depth === '2');
      const lbl = (x) => x.querySelector('.lbl').getBoundingClientRect().left;
      return { indent: Math.round(lbl(subs[0]) - lbl(sec)), below: r0.top >= a.bottom - 1, deeper: d2 ? Math.round(lbl(d2) - lbl(subs[0])) : null, secFont: parseFloat(getComputedStyle(li.querySelector(':scope > a')).fontSize), subFont: parseFloat(getComputedStyle(subs[0]).fontSize), dots: li.querySelectorAll('.toc-sub .dot').length, sticky: getComputedStyle(document.getElementById('toc')).position };
    });
    step('sidebar-layout', layout);
    expect(layout.indent > 4 && layout.below && layout.deeper > 4 && layout.subFont < layout.secFont && layout.dots === 0 && layout.sticky === 'sticky', 'sidebar nests and indents sub-headings', layout);
    await shot('toc-1440');

    const route = await page.evaluate(() => location.hash);
    const target = split[0].subs[2];
    await page.locator(`#toc-list a.toc-sub-link[href="${target.href}"]`).click();
    await page.waitForTimeout(1600);
    const landed = await page.evaluate((href) => { const h = document.querySelector(href); const r = h.getBoundingClientRect(); return { top: Math.round(r.top), focused: document.activeElement === h, hash: location.hash, label: h.textContent.trim() }; }, target.href);
    const t1 = await tocInfo(page);
    const cur1 = t1.flatMap(t => t.subs.filter(x => x.current === 'true').map(x => x.label));
    const sec1 = t1.find(t => t.sec === split[0].sec);
    step('click-sub', { landed, current: cur1, section: { current: sec1.current, contains: sec1.contains } });
    expect(landed.top >= 56 && landed.top < 140, 'heading lands just below the top bar', landed.top);
    expect(landed.focused && landed.hash === route, 'heading focused, route unchanged', landed);
    expect(sameLabels(cur1, ['3.2 전문가 수 k의 영향']) && sec1.current === 'false' && sec1.contains, 'clicked sub-link becomes current, its section is marked as containing it', { cur1, sec: sec1 });

    const s2 = split[1];
    await page.evaluate((href) => { const h = document.querySelector(href); window.scrollTo({ top: h.getBoundingClientRect().top + window.scrollY - 70, behavior: 'instant' }); }, s2.subs[0].href);
    await page.waitForTimeout(400);
    const t2 = await tocInfo(page);
    const cur2 = t2.flatMap(t => t.subs.filter(x => x.current === 'true').map(x => x.label));
    const sec2 = t2.find(t => t.sec === s2.sec);
    step('scroll-sub', { current: cur2, section: { current: sec2.current, contains: sec2.contains } });
    expect(sameLabels(cur2, ['3.3 라우팅 구조']) && sec2.contains && sec2.current === 'false', 'aria-current follows the scroll', { cur2, sec: sec2 });
    await page.evaluate((id) => { const c = document.getElementById('sec-' + id); window.scrollTo({ top: c.getBoundingClientRect().top + window.scrollY - 70, behavior: 'instant' }); }, s2.sec);
    await page.waitForTimeout(400);
    const t3 = await tocInfo(page);
    const sec3 = t3.find(t => t.sec === s2.sec);
    const cur3 = t3.flatMap(t => [t.current === 'true' ? t.sec : null, ...t.subs.filter(x => x.current === 'true').map(x => x.label)]).filter(Boolean);
    step('scroll-section-top', { current: cur3, contains: sec3.contains });
    expect(sameLabels(cur3, [s2.sec]) && !sec3.contains, 'before the first sub-heading the section link is current', cur3);

    await page.focus(`#toc-list > li[data-sec="${merged.sec}"] > a.toc-link`);
    await page.keyboard.press('Tab');
    const tab1 = await page.evaluate(() => document.activeElement.textContent.trim());
    for (let i = 0; i < merged.subs.length; i++) await page.keyboard.press('Tab');
    const tab2 = await page.evaluate(() => ({ cls: document.activeElement.className, sec: document.activeElement.dataset.sec }));
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1600);
    const entered = await page.evaluate(() => ({ label: document.activeElement.textContent.trim(), tag: document.activeElement.tagName, top: Math.round(document.activeElement.getBoundingClientRect().top) }));
    step('keyboard', { tab1, tab2, entered });
    const nextSec = toc[toc.findIndex(t => t.sec === merged.sec) + 1].sec;
    expect(tab1 === '1.1 라우팅 구조' && tab2.sec === nextSec && /toc-link/.test(tab2.cls), 'Tab order: section, its sub-links, next section', { tab1, tab2 });
    expect(entered.label === '2 Background' && entered.tag === 'H2' && entered.top >= 56 && entered.top < 140, 'Enter on a sub-link moves focus to its heading', entered);
    await page.evaluate(() => document.activeElement.blur());
    await page.keyboard.press('t');
    const tFocus = await page.evaluate(() => ({ first: document.activeElement === document.querySelector('#toc-list a'), cls: document.activeElement.className }));
    expect(tFocus.first, 't still focuses the first TOC link', tFocus);

    await page.click('#raw-math');
    await page.waitForTimeout(600);
    const raw = await tocInfo(page);
    step('raw-math', { checked: await page.evaluate(() => document.getElementById('raw-math').checked), labels: subLabels(raw) });
    expect(sameLabels(subLabels(raw), labels) && raw.every(t => t.subs.every(x => x.target)), 'labels and targets survive the raw-math toggle', subLabels(raw));
    await page.click('#raw-math');
    await page.waitForTimeout(600);
    expect(sameLabels(subLabels(await tocInfo(page)), labels), 'labels unchanged after turning KaTeX back on');

    const retrySec = split[0].sec;
    await page.click(`#sec-${retrySec} .act-retry`);
    await page.waitForTimeout(300);
    await poll(page, () => { const s = RPT.state; const j = s.jobs[s.currentJobId]; return j.state === 'done' && !s.run; }, 30000, 'section retranslated');
    await page.waitForTimeout(500);
    const re = await tocInfo(page);
    step('retry', { labels: subLabels(re)[retrySec], targets: re.find(t => t.sec === retrySec).subs.map(x => x.target) });
    expect(sameLabels(subLabels(re), labels) && re.every(t => t.subs.every(x => x.target)), 'sub-headings rebuilt after a section retry', subLabels(re)[retrySec]);

    await page.setViewportSize({ width: 1100, height: 900 });
    await page.click('#side-by-side');
    await page.waitForTimeout(700);
    const sbs = await page.evaluate(() => {
      const li = [...document.querySelectorAll('#toc-list > li')].find(x => x.querySelector('.toc-sub-link'));
      const a = li.querySelector(':scope > a').getBoundingClientRect();
      const r0 = li.querySelector('.toc-sub-link').getBoundingClientRect();
      const list = document.getElementById('toc-list');
      return { sbs: document.getElementById('tr-layout').dataset.sbs, follows: r0.left >= a.right - 1 && Math.abs((r0.top + r0.bottom) / 2 - (a.top + a.bottom) / 2) < 8, rowScrolls: list.scrollWidth > list.clientWidth, scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth };
    });
    step('sbs-1100', sbs);
    expect(sbs.sbs === '1' && sbs.follows && sbs.rowScrolls && sbs.scrollWidth <= sbs.innerWidth, 'side-by-side at 1100: sub-heading pills follow their section', sbs);
    await page.screenshot({ path: path.join(OUT, 'toc-subheadings-sbs-1100.png') });
    await page.click('#side-by-side');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(700);
    const mob = await page.evaluate(() => {
      const lis = [...document.querySelectorAll('#toc-list > li')];
      const li = lis.find(x => x.querySelector('.toc-sub-link'));
      const a = li.querySelector(':scope > a').getBoundingClientRect();
      const subs = [...li.querySelectorAll('.toc-sub-link')].map(x => x.getBoundingClientRect());
      const next = lis[lis.indexOf(li) + 1].querySelector(':scope > a').getBoundingClientRect();
      const list = document.getElementById('toc-list');
      return { follows: subs[0].left >= a.right - 1 && subs.every((r, i) => i === 0 || r.left >= subs[i - 1].right - 1) && next.left >= subs[subs.length - 1].right - 1, rowScrolls: list.scrollWidth > list.clientWidth, scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth };
    });
    step('mobile-390', mob);
    expect(mob.follows && mob.rowScrolls && mob.scrollWidth <= mob.innerWidth, '390px: sub-heading pills follow their section without page overflow', mob);
    await page.screenshot({ path: path.join(OUT, 'toc-subheadings-390.png') });
    await page.setViewportSize({ width: 1440, height: 1000 });

    await goHome(page);
    await setCfg(page, { slowTranslate: true });
    await start(page, ARXIV);
    await page.waitForFunction(() => /^#result\//.test(location.hash) && !document.getElementById('view-result').hidden, null, { timeout: 10000 });
    await page.click('#tab-translation');
    const live = await poll(page, () => {
      const s = RPT.state; const j = s.currentJobId && s.jobs[s.currentJobId];
      if (!j) return null;
      for (const c of j.chunks) {
        if (c.status !== 'running') continue;
        const n = document.querySelectorAll(`#toc-list > li[data-sec="${c.id}"] .toc-sub-link`).length;
        if (n > 0) return { sec: c.id, subs: n, textLen: c.text.length, labels: [...document.querySelectorAll(`#toc-list > li[data-sec="${c.id}"] .toc-sub-link`)].map(a => a.textContent.trim()) };
      }
      return null;
    }, 30000, 'sub-headings while streaming');
    step('streaming', live);
    expect(live && live.subs > 0, 'sub-headings appear while the section streams', live);
    await waitEnd(page);
    const fin = await tocInfo(page);
    expect(sameLabels(subLabels(fin)[live.sec], labels[live.sec] || subLabels(fin)[live.sec]) && fin.every(t => t.subs.every(x => x.target)), 'final sub-headings after streaming', subLabels(fin)[live.sec]);
  });

  await scenario('localhost-redirect', {}, async ({ page, step, expect, auth }) => {
    const localUrl = BASE.replace('127.0.0.1', 'localhost');
    if (localUrl === BASE) { step('skipped', { reason: 'BASE is not 127.0.0.1' }); return; }
    try { await openGate(page, localUrl); }
    catch (e) { step('skipped', { reason: 'localhost not reachable: ' + e.message.split('\n')[0] }); return; }
    const g = await gate(page);
    step('gate-localhost', { btnDisabled: g.btnDisabled, hintVisible: g.hintVisible });
    expect(g.btnDisabled === false && !g.hintVisible, 'button enabled on localhost', g);
    const r = await clickChatGPT(page);
    const a1 = auth.requests[0] || {};
    step('after-redirect', { request: a1, result: r, href: await page.evaluate(() => location.href) });
    expect(a1.redirectUri === REDIRECT_URI, 'authorize started from 127.0.0.1 origin', a1.redirectUri);
    expect(r.connected === true && r.search === '', 'connected after localhost hand-off', r);
  });

  await browser.close();
  const clone = JSON.parse(JSON.stringify(report));
  for (const s of clone.scenarios) delete s.authorize;
  report.tokenLeak = /oat-|rt-\d|eyJ[A-Za-z0-9_-]+\.eyJ/.test(JSON.stringify(clone));
  if (report.tokenLeak) report.scenarios.push({ name: 'token-leak-guard', cfg: {}, steps: [], fails: ['token string found in report.json'], errors: [], console: [] });
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 1));
  for (const s of report.scenarios) console.log(`== ${s.name}: errors=${JSON.stringify(s.errors)} fails=${JSON.stringify(s.fails)} console=${JSON.stringify(s.console.slice(0, 4))}`);
  console.log('TOKEN-LEAK:', report.tokenLeak);
  console.log('ERRORS:', JSON.stringify(report.scenarios.filter(s => s.errors.length || s.fails.length).map(s => s.name)));
})().catch(e => { console.error('RUN FAILED:', e); fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 1)); process.exit(1); });
