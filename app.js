(function () {
  'use strict';

  const VERSION = '1.3.0';
  const API_BASE = 'https://api.openai.com';
  const PROXY_PREFIX = '/__rpt/openai';
  const HEALTH_PATH = '/__rpt/health';
  const P = window.RPT_PROMPTS;

  const LS = {
    apiKey: 'rpt.apiKey',
    settings: 'rpt.settings.v1',
    history: 'rpt.history.v1',
    browserId: 'rpt.browserId',
    s2cache: 'rpt.s2cache.v1',
    jobPrefix: 'rpt.result.',
    authMode: 'rpt.authMode',
    cgHost: 'rpt.chatgpt.host',
    cgReg: 'rpt.chatgpt.reg.v1',
    cgTokens: 'rpt.chatgpt.tokens.v1'
  };
  const SS = { pending: 'rpt.chatgpt.pending', stripped: 'rpt.chatgpt.stripped' };
  const OAUTH = {
    issuer: 'https://auth.openai.com',
    authorize: 'https://auth.openai.com/api/accounts/authorize',
    token: 'https://auth.openai.com/api/accounts/oauth/token',
    revoke: 'https://auth.openai.com/api/accounts/oauth/revoke'
  };
  const OAUTH_SCOPES = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
  const OAUTH_RESOURCE = 'https://api.openai.com/v1';
  const CLIENT_DYNAMIC = 'dynamic_agent_client';
  const AGENT_NAME = 'Read Paper Together';
  const PLAN_SCOPE = 'chatgpt.tokens.use.direct';
  const REFRESH_SKEW_MS = 120000;
  const REFRESH_TIMEOUT_MS = 30000;
  const REVOKE_TIMEOUT_MS = 15000;
  const PENDING_TTL_MS = 600000;
  const REFRESH_LOCK = 'rpt.chatgpt.refresh';
  const LOOPBACK_HOSTS = ['127.0.0.1', 'localhost', '[::1]', '::1'];
  const REFRESH_FATAL = new Set(['invalid_grant', 'invalid_refresh_token', 'token_expired', 'refresh_token_expired', 'refresh_token_invalidated', 'refresh_token_reused']);
  const USAGE_URL = 'https://chatgpt.com/settings/usage';
  const MODEL_PREFS = ['gpt-5.4-mini', 'gpt-5.4', 'gpt-5.5', 'gpt-5.2', 'gpt-5.1', 'gpt-5-mini', 'gpt-5', 'gpt-5.6-terra', 'gpt-5.6-luna'];
  const MODEL_INCLUDE = /^gpt-(5|6)/;
  const MODEL_EXCLUDE = /pro|realtime|audio|image|codex|search|transcribe|tts|chat-latest|-\d{4}-\d{2}-\d{2}$/;
  const MINIMAL_EFFORT_MODELS = /^gpt-5(-mini|-nano)?(-\d{4}-\d{2}-\d{2})?$/;
  const PARAM_ERROR = /reasoning|verbosity|effort|unsupported_parameter|unsupported_value/i;
  const PLAN_OPTIONAL = /^(prompt_cache_key|stream_options(\.include_obfuscation)?|text(\.verbosity)?|input\[\d+\]\.content\[\d+\]\.detail)$/;
  const PDF_FETCH_ERROR = /file|url|download|fetch|pdf/i;
  const PRICES = {
    'gpt-5-nano': [0.05, 0.005, 0.40], 'gpt-5-mini': [0.25, 0.025, 2.00], 'gpt-5': [1.25, 0.125, 10],
    'gpt-5.1': [1.25, 0.125, 10], 'gpt-5.2': [1.75, 0.175, 14], 'gpt-5.4': [2.50, 0.25, 15],
    'gpt-5.4-mini': [0.75, 0.075, 4.50], 'gpt-5.4-nano': [0.20, 0.02, 1.25], 'gpt-5.5': [5, 0.50, 30],
    'gpt-5.6-luna': [0.20, 0.02, 1.20], 'gpt-5.6-terra': [2, 0.20, 12], 'gpt-4.1': [2, 0.50, 8]
  };
  const MAX_TOKENS = { outline: 12000, summary: 32000, ideas: 16000, translate: 16000, translateRetry: 32000 };
  const RETRY_DELAYS = [2000, 6000, 15000];
  const WATCHDOG_MS = 90000;
  const REASONING_WATCHDOG_MS = 300000;
  const MAX_FILE_BYTES = 50 * 1024 * 1024;
  const LS_JOB_LIMIT = 2 * 1024 * 1024;
  const LS_WARN_BYTES = 4 * 1024 * 1024;
  const HISTORY_MAX = 50;
  const GLOSSARY_CAP = 60;
  const ABORT_USER = 'user';
  const ABORT_WATCHDOG = 'watchdog';
  const ABORT_QUOTA = 'quota';
  const ABORT_AUTH = 'auth';
  const ABORT_PLAN_LIMIT = 'plan_limit';
  const ABORT_PLAN_INELIGIBLE = 'plan_ineligible';
  const ABORT_PLAN_MODEL = 'plan_model';
  const DEFAULT_SETTINGS = { model: '', effort: 'low', concurrency: 3, theme: 'auto', fontScale: 'normal', modelsCache: null, modelPlan: '', modelsCachePlan: null };
  const FONT_SCALES = { small: 0.92, normal: 1, large: 1.1 };
  const FONT_ORDER = ['small', 'normal', 'large'];
  const EFFORT_LABELS = { none: '없음', low: '낮음', medium: '중간', high: '높음' };
  const STATE_LABELS = { done: '완료', partial: '일부 실패', cancelled: '중단됨', failed: '실패', running: '진행 중', outlining: '진행 중' };
  const CHIP_LABELS = { pending: '대기', running: '번역 중', done: '완료', failed: '실패', retrying: '재시도', skipped: '건너뜀' };
  const TECH_CATS = {
    architecture: '모델 구조', training: '학습 방법', objective_loss: '손실·목적함수', data: '데이터',
    optimization: '최적화·효율화', inference: '추론 기법', evaluation: '평가 방법', theory: '이론적 분석',
    system_infra: '시스템·인프라', other: '기타'
  };
  const IDEA_CATS = {
    limitation_fix: '한계 극복', extension: '확장·일반화', new_application: '새로운 응용', combination: '다른 연구와 결합',
    efficiency: '효율화', analysis_theory: '분석·이론', dataset_benchmark: '데이터·벤치마크'
  };
  const IDEA_LEVELS = { low: '하', medium: '중', high: '상' };
  const IDEAS_MAX = 10;
  const SCHOLAR_URL = 'https://scholar.google.com/scholar?q=';
  const IDEAS_INTRO = '이 논문을 바탕으로 GPT가 제안한 후속 연구 주제입니다. 이미 연구된 주제일 수 있으니 키워드로 선행 연구를 확인하세요.';
  const TOC_THROTTLE_MS = 300;
  const SCROLL_GAP = 12;
  const RADAR_AXES = [['novelty', '참신성'], ['clarity', '명확성'], ['rigor', '실험 엄밀성'], ['reproducibility', '재현성'], ['impact', '영향력']];
  const KATEX_DELIMS = [
    { left: '$$', right: '$$', display: true },
    { left: '\\[', right: '\\]', display: true },
    { left: '\\(', right: '\\)', display: false },
    { left: '$', right: '$', display: false }
  ];
  const KATEX_OPTS = { delimiters: KATEX_DELIMS, throwOnError: false, strict: 'ignore', ignoredTags: ['pre', 'code', 'script', 'style', 'textarea'] };

  const MSG = {
    network: 'OpenAI에 연결할 수 없습니다. 네트워크 연결을 확인해 주세요.',
    netLost: '연결이 끊어졌습니다. 네트워크를 확인해 주세요.',
    key401: 'API 키가 올바르지 않습니다. 키를 다시 확인해 주세요.',
    key403: '이 키에는 API 접근 권한이 없습니다. 조직/프로젝트 설정을 확인해 주세요.',
    key429: '요청 한도를 초과했습니다. 잠시 후 다시 시도해 주세요.',
    keyInvalidated: '저장된 키가 더 이상 유효하지 않습니다. 다시 로그인해 주세요.',
    e401: 'API 키가 유효하지 않습니다. 다시 로그인해 주세요.',
    e403: '접근 권한이 없습니다.',
    pdfFetch: 'OpenAI가 PDF를 가져오지 못했습니다. 공개된 PDF 링크인지 확인하거나 파일을 업로드해 주세요.',
    tooBig: 'PDF가 너무 큽니다. 50MB 이하 파일을 사용해 주세요.',
    e429: '요청 한도를 초과했습니다. 동시 번역 수를 줄이거나 잠시 후 다시 시도해 주세요.',
    quota: '크레딧이 부족합니다. OpenAI 계정의 결제 상태를 확인해 주세요.',
    userAbort: '사용자가 중단함',
    reloadAbort: '페이지를 새로 고쳐 중단됨',
    storageFull: '브라우저 저장 공간이 부족해 결과를 저장하지 못했습니다. 기록을 정리해 주세요.',
    summaryParse: '요약 결과를 해석하지 못했습니다. 다시 시도해 주세요.',
    summaryTruncated: '요약 결과가 출력 한도에 걸려 잘렸습니다. 추론 강도를 낮춰 다시 시도해 주세요.',
    ideasParse: '주제 제안 결과를 해석하지 못했습니다. 다시 시도해 주세요.',
    ideasTruncated: '주제 제안 결과가 출력 한도에 걸려 잘렸습니다. 추론 강도를 낮춰 다시 시도해 주세요.',
    reduceConcurrency: '동시 번역 수를 줄여 주세요',
    urlScheme: 'http 또는 https로 시작하는 링크를 입력해 주세요.',
    pdfOnly: 'PDF 파일만 올릴 수 있습니다.',
    fileTooBig: '파일이 50MB를 넘습니다.',
    unsupported: '지원하지 않는 링크입니다. PDF 직접 링크를 붙여넣거나 파일을 업로드해 주세요.',
    paywalled: '이 사이트(출판사/유료 DB)는 로그인·봇 차단 때문에 자동으로 PDF를 가져올 수 없습니다. 기관 계정으로 PDF를 내려받아 업로드해 주세요.',
    scholar: 'Google Scholar 검색/인용 페이지는 논문 파일이 아닙니다. 결과 목록의 [PDF] 링크나 arXiv/학회 페이지 링크를 붙여넣거나 PDF를 업로드해 주세요.',
    fileExpired: '업로드한 PDF는 다시 사용할 수 없습니다. 파일을 다시 올려 새로 분석해 주세요.',
    busy: '다른 분석이 진행 중입니다. 먼저 중단하거나 완료될 때까지 기다려 주세요.',
    cgDenied: 'ChatGPT 연결이 취소되었습니다. 플랜 사용을 허용해야 분석할 수 있습니다.',
    cgNoScope: 'ChatGPT 플랜 사용 권한이 허용되지 않았습니다. 다시 로그인해 권한을 허용하거나 API 키를 사용해 주세요.',
    cgState: '로그인 확인에 실패했습니다. 로그인을 시작한 탭에서 다시 시도해 주세요.',
    cgExchange: 'ChatGPT 로그인 처리 중 오류가 발생했습니다. 다시 시도해 주세요.',
    cgExpired: 'ChatGPT 로그인이 만료되었습니다. 다시 로그인해 주세요.',
    cgMismatch: '다른 ChatGPT 계정으로 로그인했습니다. 원래 계정을 선택하거나 다시 로그인해 주세요.',
    cgIneligible: '이 ChatGPT 계정 또는 워크스페이스에서는 앱의 플랜 사용이 허용되지 않습니다. API 키로 로그인해 주세요.',
    cgLimit: 'ChatGPT 플랜 사용 한도에 도달했습니다. ChatGPT 설정 → 사용량에서 한도를 확인하거나 조정한 뒤 다시 시도해 주세요.',
    cgModelUnsupported: '선택한 모델은 ChatGPT 플랜으로 사용할 수 없습니다. 설정에서 다른 모델을 선택해 주세요.',
    cgUnsupported: 'ChatGPT 플랜으로는 지원되지 않는 요청 옵션이 있어 거부되었습니다.',
    cg403: 'ChatGPT 정책 또는 지역 제한으로 요청이 거부되었습니다.',
    cg503: 'ChatGPT 플랜 사용 여부를 확인할 수 없습니다. 잠시 후 다시 시도해 주세요.',
    cgRevokeFail: '원격 연결 해제를 확인하지 못했습니다. ChatGPT 설정에서 앱 연결을 해제할 수 있습니다.',
    cgModelsEmpty: '모델 목록을 불러오지 못했습니다',
    cgNoProxy: '이 서버에는 ChatGPT 중계 기능이 없습니다. 터미널에서 python3 serve.py 를 실행한 뒤 http://127.0.0.1:8000 을 여세요.',
    cgBusyRedirect: 'ChatGPT로 이동하는 중…'
  };


  const $ = (id) => document.getElementById(id);

  function el(tag, props, ...children) {
    const node = document.createElement(tag);
    if (props) {
      for (const [k, v] of Object.entries(props)) {
        if (v == null || v === false) continue;
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = v;
        else if (k === 'dataset') Object.assign(node.dataset, v);
        else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
        else if (typeof v === 'boolean') node[k] = v;
        else node.setAttribute(k, v);
      }
    }
    for (const c of children.flat()) if (c != null && c !== false) node.append(c);
    return node;
  }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); return node; }
  function escapeHtml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function escapeRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function hashStr(s) { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0; return h.toString(16); }
  function fmtBytes(n) { return n >= 1048576 ? `${(n / 1048576).toFixed(1)}MB` : `${Math.max(1, Math.round(n / 1024))}KB`; }
  function fmtDate(ms) { const d = new Date(ms); return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`; }
  function fmtDuration(ms) { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}분 ${s % 60}초`; }
  function fmtK(n) { return n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}` : `${(n / 1000).toFixed(2)}`; }
  function sanitizeFilename(name) { return (name || '논문').replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 80) || '논문'; }
  function abortError(reason) { const e = new Error('aborted'); e.name = 'AbortError'; e.reason = reason; return e; }
  function isAbort(e) { return !!e && e.name === 'AbortError'; }
  function reducedMotion() { return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
  function narrowScreen() { return window.matchMedia && window.matchMedia('(max-width: 899px)').matches; }

  function sleep(ms, signal) {
    return new Promise((resolve, reject) => {
      if (signal && signal.aborted) return reject(abortError(signal.reason));
      const onAbort = () => { clearTimeout(t); reject(abortError(signal.reason)); };
      const t = setTimeout(() => { if (signal) signal.removeEventListener('abort', onAbort); resolve(); }, ms);
      if (signal) signal.addEventListener('abort', onAbort, { once: true });
    });
  }

  const ls = {
    get(k, fallback) { try { const v = localStorage.getItem(k); return v == null ? fallback : JSON.parse(v); } catch { return fallback; } },
    getRaw(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { return ls.setRaw(k, JSON.stringify(v)); },
    setRaw(k, v) {
      try { localStorage.setItem(k, v); return { ok: true }; }
      catch (e) { return { ok: false, quota: !!e && (e.name === 'QuotaExceededError' || e.code === 22 || e.code === 1014) }; }
    },
    remove(k) { try { localStorage.removeItem(k); } catch {} },
    keys() { try { return Object.keys(localStorage); } catch { return []; } }
  };

  let dbPromise = null;
  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve) => {
      try {
        if (!window.indexedDB) return resolve(null);
        const req = indexedDB.open('rpt', 1);
        req.onupgradeneeded = () => { const db = req.result; if (!db.objectStoreNames.contains('jobs')) db.createObjectStore('jobs', { keyPath: 'id' }); };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
        req.onblocked = () => resolve(null);
      } catch { resolve(null); }
    });
    return dbPromise;
  }
  function idb(mode, fn) {
    return openDb().then((db) => new Promise((resolve, reject) => {
      if (!db) return reject(new Error('no-idb'));
      try {
        const req = fn(db.transaction('jobs', mode).objectStore('jobs'));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      } catch (e) { reject(e); }
    }));
  }

  function serializeJob(job) {
    return JSON.parse(JSON.stringify(job, (k, v) => ((k === 'blobUrl' || k === 'fileData') ? undefined : v)));
  }
  function readFileDataUrl(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(new ApiError('파일을 읽지 못했습니다.', { status: 0, code: 'file_read' }));
      r.readAsDataURL(file);
    });
  }
  function evictOldestLocal(keepId) {
    const hist = store.loadHistory();
    const listed = new Set(hist.map((h) => h.id));
    for (const k of ls.keys()) {
      const id = k.startsWith(LS.jobPrefix) ? k.slice(LS.jobPrefix.length) : '';
      if (id && id !== keepId && !listed.has(id)) { ls.remove(k); return true; }
    }
    for (let i = hist.length - 1; i >= 0; i--) {
      const h = hist[i];
      if (h.id !== keepId && ls.getRaw(LS.jobPrefix + h.id) != null) {
        ls.remove(LS.jobPrefix + h.id);
        hist.splice(i, 1);
        store.saveHistory(hist);
        renderHistory();
        return true;
      }
    }
    return false;
  }
  function saveJobLocal(data) {
    let text = JSON.stringify(data);
    if (text.length * 2 > LS_JOB_LIMIT) {
      data = { ...data, chunks: data.chunks.map((c) => ({ ...c, text: '' })), storageTruncated: true };
      text = JSON.stringify(data);
    }
    for (let i = 0; i < 4; i++) {
      const r = ls.setRaw(LS.jobPrefix + data.id, text);
      if (r.ok) return true;
      if (!r.quota || !evictOldestLocal(data.id)) break;
    }
    toast(MSG.storageFull, 'error');
    return false;
  }

  const store = {
    async saveJob(job) {
      const data = serializeJob(job);
      try { await idb('readwrite', (s) => s.put(data)); return true; } catch {}
      return saveJobLocal(data);
    },
    async loadJob(id) {
      try { const j = await idb('readonly', (s) => s.get(id)); if (j) return j; } catch {}
      return ls.get(LS.jobPrefix + id, null);
    },
    async deleteJob(id) {
      try { await idb('readwrite', (s) => s.delete(id)); } catch {}
      ls.remove(LS.jobPrefix + id);
    },
    async clearJobs() {
      try { await idb('readwrite', (s) => s.clear()); } catch {}
      for (const k of ls.keys()) if (k.startsWith(LS.jobPrefix)) ls.remove(k);
    },
    loadHistory() { const h = ls.get(LS.history, []); return Array.isArray(h) ? h : []; },
    saveHistory(list) { ls.set(LS.history, list.slice(0, HISTORY_MAX)); },
    localJobBytes() { let n = 0; for (const k of ls.keys()) if (k.startsWith(LS.jobPrefix)) n += (ls.getRaw(k) || '').length * 2; return n; }
  };

  function loadSettings() {
    const s = ls.get(LS.settings, null);
    const merged = { ...DEFAULT_SETTINGS, ...(s && typeof s === 'object' ? s : {}) };
    if (!EFFORT_LABELS[merged.effort]) merged.effort = DEFAULT_SETTINGS.effort;
    merged.concurrency = clamp(parseInt(merged.concurrency, 10) || 3, 1, 5);
    if (!['auto', 'light', 'dark'].includes(merged.theme)) merged.theme = 'auto';
    if (!FONT_SCALES[merged.fontScale]) merged.fontScale = 'normal';
    return merged;
  }
  function saveSettings() { ls.set(LS.settings, state.settings); }
  function ensureBrowserId() {
    let id = ls.getRaw(LS.browserId);
    if (!id) { id = 'rpt-' + uid() + uid(); ls.setRaw(LS.browserId, id); }
    return id;
  }

  const state = {
    settings: loadSettings(),
    apiKey: '',
    browserId: '',
    jobs: {},
    currentJobId: null,
    currentTab: 'summary',
    run: null,
    sbs: false,
    planModelsError: '',
    rawMath: false,
    pendingFile: null,
    lastHash: '#home',
    radarChart: null,
    radarView: null,
    authFailing: false,
    starting: false,
    proxyOk: null
  };
  const renderTimers = new Map();
  const renderState = new Map();
  const tocTimers = new Map();
  const tocLast = new Map();
  let spyFrame = 0;
  let spyActive = null;
  let scrollSeq = 0;

  function availableModels() {
    if (isPlan()) {
      const c = state.settings.modelsCachePlan;
      return c && Array.isArray(c.list) ? c.list.slice() : [];
    }
    const c = state.settings.modelsCache;
    const ids = c && Array.isArray(c.ids) && c.ids.length ? c.ids : MODEL_PREFS.slice();
    return ids.map((id) => ({ id, label: id }));
  }
  function defaultModel(ids) { return MODEL_PREFS.find((m) => ids.includes(m)) || ids[0] || 'gpt-5.4-mini'; }
  function currentModel() {
    const ids = availableModels().map((m) => m.id);
    if (isPlan()) return ids.includes(state.settings.modelPlan) ? state.settings.modelPlan : (ids[0] || '');
    return ids.includes(state.settings.model) ? state.settings.model : defaultModel(ids);
  }
  function modelLabel(id) { const m = availableModels().find((x) => x.id === id); return m ? m.label : (id || '-'); }
  function filterModels(data) {
    const ids = (Array.isArray(data) ? data : []).map((m) => m && m.id).filter((id) => typeof id === 'string' && MODEL_INCLUDE.test(id) && !MODEL_EXCLUDE.test(id));
    const rank = (id) => { const i = MODEL_PREFS.indexOf(id); return i < 0 ? MODEL_PREFS.length : i; };
    return [...new Set(ids)].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  }
  function filterPlanModels(data) {
    if (data && Array.isArray(data.models)) {
      return data.models.filter((m) => m && typeof m.slug === 'string' && (m.visibility === 'list' || m.visibility == null)).map((m) => ({ id: m.slug, label: m.display_name || m.slug }));
    }
    if (data && Array.isArray(data.data)) return filterModels(data.data).map((id) => ({ id, label: id }));
    return [];
  }
  function describeCatalog(data) {
    if (!data || typeof data !== 'object') return `응답 형식 ${typeof data}`;
    const arr = Array.isArray(data.models) ? data.models : (Array.isArray(data.data) ? data.data : null);
    if (!arr) return `응답 키 ${Object.keys(data).join(', ') || '없음'}`;
    const vis = [...new Set(arr.map((m) => (m && m.visibility) || '-'))].join('/');
    return `항목 ${arr.length}개, visibility ${vis}`;
  }
  function describeModelsError(e) {
    if (!e) return '알 수 없는 오류';
    if (e.code === 'network') return '네트워크 오류 (응답 없음, CORS 차단 가능)';
    const parts = [];
    if (e.status) parts.push(`HTTP ${e.status}`);
    if (e.code && e.code !== 'detail') parts.push(e.code);
    if (e.message && !/^HTTP \d+$/.test(e.message)) parts.push(e.message);
    return (parts.join(' · ') || String(e)).slice(0, 240);
  }
  function priceFor(model) { return PRICES[String(model || '').replace(/-\d{4}-\d{2}-\d{2}$/, '')] || null; }
  function estimateCost(job) {
    if (job.planMode) return null;
    const p = priceFor(job.model);
    if (!p) return null;
    const u = job.usage;
    return (Math.max(0, u.input - u.cached) * p[0] + u.cached * p[1] + u.output * p[2]) / 1e6;
  }

  function applyTheme() {
    document.documentElement.dataset.theme = state.settings.theme;
    if (state.radarChart) rebuildRadar();
  }
  function applyFontScale() {
    document.documentElement.style.setProperty('--reading-scale', String(FONT_SCALES[state.settings.fontScale] || 1));
  }

  function toast(msg, kind) {
    const region = $('toast-region');
    while (region.children.length >= 3) region.firstChild.remove();
    const t = el('div', { class: 'toast', dataset: { kind: kind || 'info' }, text: msg });
    region.append(t);
    setTimeout(() => t.remove(), 4000);
  }
  function confirmDialog({ title, body, ok, okClass }) {
    return new Promise((resolve) => {
      const dlg = $('confirm');
      if (dlg.open) { resolve(false); return; }
      const okBtn = $('confirm-ok');
      const cancelBtn = $('confirm-cancel');
      $('confirm-title').textContent = title;
      $('confirm-body').textContent = body;
      okBtn.textContent = ok || '확인';
      okBtn.className = okClass || 'btn-danger';
      const cleanup = () => { okBtn.removeEventListener('click', onOk); cancelBtn.removeEventListener('click', onCancel); dlg.removeEventListener('close', onClose); };
      const done = (v) => { cleanup(); if (dlg.open) dlg.close(); resolve(v); };
      const onOk = () => done(true);
      const onCancel = () => done(false);
      const onClose = () => done(false);
      okBtn.addEventListener('click', onOk);
      cancelBtn.addEventListener('click', onCancel);
      dlg.addEventListener('close', onClose);
      dlg.showModal();
    });
  }

  class ApiError extends Error {
    constructor(message, info) {
      super(message);
      this.name = 'ApiError';
      const i = info || {};
      this.status = i.status || 0;
      this.code = i.code || '';
      this.type = i.type || '';
      this.param = i.param || '';
    }
  }

  function authMode() { return ls.getRaw(LS.authMode) === 'chatgpt' ? 'chatgpt' : 'key'; }
  function isPlan() { return authMode() === 'chatgpt'; }
  function isLoopbackHttp() {
    const p = location.protocol;
    return (p === 'http:' || p === 'https:') && LOOPBACK_HOSTS.includes(location.hostname);
  }
  function getReg() { return ls.get(LS.cgReg, null); }
  function getTokens() { return ls.get(LS.cgTokens, null); }
  function saveTokens(t) { ls.set(LS.cgTokens, t); }
  function hasApiKeySession() { return !!ls.getRaw(LS.apiKey); }
  function hasPlanSession() { const t = getTokens(); return !!(t && t.accessToken); }
  function anySession() { return hasApiKeySession() || hasPlanSession(); }
  function hasActiveAuth() { return isPlan() ? hasPlanSession() : !!state.apiKey; }
  function hostId() {
    let id = ls.getRaw(LS.cgHost);
    if (!id || !/^urn:uuid:/.test(id)) { id = 'urn:uuid:' + crypto.randomUUID(); ls.setRaw(LS.cgHost, id); }
    return id;
  }

  function b64url(input) {
    const arr = input instanceof ArrayBuffer ? new Uint8Array(input) : input;
    let s = '';
    for (let i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function randB64url(n) { const a = new Uint8Array(n); crypto.getRandomValues(a); return b64url(a); }
  async function sha256b64url(str) { return b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str))); }
  function b64urlToStr(s) {
    const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
    const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
    return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  }
  function decodeJwt(token) {
    const parts = String(token || '').split('.');
    if (parts.length < 2) throw new ApiError('bad jwt', { code: 'id_invalid' });
    return JSON.parse(b64urlToStr(parts[1]));
  }
  function validateIdClaims(claims, clientId, nonce, checkNonce) {
    const now = Date.now() / 1000;
    if (!claims || claims.iss !== OAUTH.issuer) throw new ApiError('bad iss', { code: 'id_invalid' });
    const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!aud.includes(clientId)) throw new ApiError('bad aud', { code: 'id_invalid' });
    if (Array.isArray(claims.aud) && claims.aud.length > 1 && claims.azp !== clientId) throw new ApiError('bad azp', { code: 'id_invalid' });
    if (!(typeof claims.exp === 'number' && claims.exp > now - 5)) throw new ApiError('expired id', { code: 'id_invalid' });
    if (typeof claims.iat !== 'number') throw new ApiError('bad iat', { code: 'id_invalid' });
    if (!(typeof claims.sub === 'string' && claims.sub)) throw new ApiError('bad sub', { code: 'id_invalid' });
    if (checkNonce && claims.nonce !== nonce) throw new ApiError('bad nonce', { code: 'id_invalid' });
  }

  function getStripped() {
    try { const a = JSON.parse(sessionStorage.getItem(SS.stripped) || '[]'); return Array.isArray(a) ? a : []; } catch { return []; }
  }
  function isStripped(path) { return getStripped().includes(path); }
  function addStripped(path) {
    const a = getStripped();
    if (!a.includes(path)) { a.push(path); try { sessionStorage.setItem(SS.stripped, JSON.stringify(a)); } catch {} }
  }
  function deleteByPath(obj, path) {
    const keys = String(path).replace(/\[(\d+)\]/g, '.$1').split('.').filter((k) => k !== '');
    if (!keys.length) return;
    let cur = obj;
    for (let i = 0; i < keys.length - 1; i++) { if (cur == null) return; cur = cur[keys[i]]; }
    if (cur == null) return;
    const last = keys[keys.length - 1];
    if (Array.isArray(cur)) { const idx = Number(last); if (Number.isInteger(idx)) cur.splice(idx, 1); }
    else delete cur[last];
  }
  function lenientJsonParse(text) {
    const t = stripFence(String(text || '').trim());
    try { return JSON.parse(t); } catch {}
    const start = t.indexOf('{');
    if (start < 0) return null;
    let depth = 0, inStr = false, esc = false;
    for (let i = start; i < t.length; i++) {
      const ch = t[i];
      if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
      if (ch === '"') inStr = true;
      else if (ch === '{') depth++;
      else if (ch === '}') { depth--; if (depth === 0) { try { return JSON.parse(t.slice(start, i + 1)); } catch { return null; } } }
    }
    return null;
  }
  function parseStructured(job, text) {
    if (job.planMode) return lenientJsonParse(text);
    try { return JSON.parse(text); } catch { return null; }
  }

  function redirectUri() {
    const u = new URL('auth/callback', location.href);
    u.hostname = '127.0.0.1';
    u.hash = '';
    u.search = '';
    return u.href;
  }
  function planStatus() {
    const mode = authMode();
    const reg = getReg();
    const tok = getTokens();
    return {
      mode,
      connected: mode === 'chatgpt' && !!(tok && tok.accessToken),
      email: reg ? reg.email || '' : '',
      welcomed: !!(tok && tok.welcomed),
      hasReg: !!(reg && reg.clientId),
      stripped: getStripped(),
      models: availableModels().length,
      modelsError: state.planModelsError,
      proxy: state.proxyOk
    };
  }

  function setChatGPTBusy(busy) {
    const btn = $('btn-chatgpt');
    if (!btn) return;
    clear(btn);
    if (busy) { btn.append(el('span', { class: 'spinner', 'aria-hidden': 'true' }), ' ' + MSG.cgBusyRedirect); btn.disabled = true; }
    else { btn.textContent = 'ChatGPT로 계속하기'; btn.disabled = !isLoopbackHttp(); }
  }
  async function checkProxy() {
    let ok = false;
    try {
      const res = await fetch(location.origin + HEALTH_PATH, { cache: 'no-store' });
      ok = res.ok && (await res.json()).proxy === true;
    } catch { ok = false; }
    state.proxyOk = ok;
    return ok;
  }
  async function startChatGPT(opts) {
    const o = opts || {};
    if (!isLoopbackHttp()) return;
    setChatGPTBusy(true);
    $('gate-error').hidden = true;
    if (!(await checkProxy())) { setChatGPTBusy(false); showGateError(MSG.cgNoProxy); return; }
    try {
      const reg = getReg();
      const verifier = randB64url(32);
      const challenge = await sha256b64url(verifier);
      const stateVal = randB64url(32);
      const nonce = randB64url(32);
      const redirect = redirectUri();
      const clientId = reg && reg.clientId ? reg.clientId : CLIENT_DYNAMIC;
      const reconsent = o.reconsent || !!(reg && reg.planDeclined);
      const pending = { state: stateVal, nonce, verifier, redirectUri: redirect, clientId, returnHash: location.hash || '', startedAt: Date.now() };
      try { sessionStorage.setItem(SS.pending, JSON.stringify(pending)); } catch {}
      const q = new URLSearchParams();
      q.set('client_id', clientId);
      if (clientId === CLIENT_DYNAMIC) q.set('agent_name_hint', AGENT_NAME);
      q.set('ext_agent_host_id', hostId());
      q.set('response_type', 'code');
      q.set('redirect_uri', redirect);
      q.set('scope', OAUTH_SCOPES);
      q.set('resource', OAUTH_RESOURCE);
      q.set('state', stateVal);
      q.set('nonce', nonce);
      q.set('code_challenge_method', 'S256');
      q.set('code_challenge', challenge);
      if (reg && reg.clientId && reg.email) q.set('login_hint', reg.email);
      if (reconsent) q.set('prompt', 'consent');
      location.assign(OAUTH.authorize + '?' + q.toString());
    } catch {
      setChatGPTBusy(false);
      showGateError(MSG.cgExchange);
    }
  }

  async function oauthError(res) {
    let body = null;
    try { body = await res.json(); } catch {}
    const code = (body && (typeof body.error === 'string' ? body.error : (body.error && body.error.code))) || '';
    return new ApiError(`oauth ${res.status}`, { status: res.status, code });
  }
  function parseEarliest(v) {
    if (typeof v === 'number') return v * 1000;
    if (typeof v === 'string') { const t = Date.parse(v); return Number.isFinite(t) ? t : null; }
    return null;
  }
  function storeTokenResponse(tok, scopes, extra) {
    const now = Date.now();
    const rec = {
      accessToken: tok.access_token,
      refreshToken: tok.refresh_token,
      idToken: tok.id_token,
      expiresAt: now + (Number(tok.expires_in) || 3600) * 1000,
      earliestRefreshAt: parseEarliest(tok.earliest_refresh_at),
      scopes: scopes && scopes.length ? scopes : String(tok.scope || '').split(/\s+/).filter(Boolean),
      savedAt: now,
      welcomed: !!(extra && extra.welcomed)
    };
    saveTokens(rec);
    return rec;
  }
  async function exchangeCode(code, pending, clientId) {
    const body = new URLSearchParams();
    body.set('grant_type', 'authorization_code');
    body.set('client_id', clientId);
    body.set('code', code);
    body.set('code_verifier', pending.verifier);
    body.set('redirect_uri', pending.redirectUri);
    body.set('resource', OAUTH_RESOURCE);
    const res = await fetch(OAUTH.token, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() });
    if (!res.ok) throw await oauthError(res);
    return res.json();
  }

  function needsRefresh(tok) {
    const now = Date.now();
    if (now < (tok.expiresAt || 0) - REFRESH_SKEW_MS) return false;
    if (tok.earliestRefreshAt && now < tok.earliestRefreshAt && now < (tok.expiresAt || 0)) return false;
    return true;
  }
  async function rotateTokens(staleBearer) {
    const tok = getTokens();
    if (!tok || !tok.refreshToken) throw new ApiError(MSG.cgExpired, { status: 401, code: 'no_token' });
    if (staleBearer ? tok.accessToken !== staleBearer : !needsRefresh(tok)) return;
    const reg = getReg();
    const clientId = reg && reg.clientId;
    const body = new URLSearchParams();
    body.set('grant_type', 'refresh_token');
    body.set('client_id', clientId || '');
    body.set('refresh_token', tok.refreshToken);
    body.set('resource', OAUTH_RESOURCE);
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), REFRESH_TIMEOUT_MS);
    let res;
    try {
      res = await fetch(OAUTH.token, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString(), signal: ctl.signal });
    } catch {
      throw new ApiError(MSG.netLost, { status: 0, code: 'network' });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      const err = await oauthError(res);
      if (REFRESH_FATAL.has(err.code) || err.code === 'invalid_client') {
        clearPlanSession({ dropReg: err.code === 'invalid_client' });
        throw new ApiError(MSG.cgExpired, { status: 401, code: 'refresh_failed' });
      }
      throw new ApiError(MSG.cgExpired, { status: res.status || 0, code: 'refresh_failed' });
    }
    const data = await res.json();
    const cur = getTokens();
    if (!cur || cur.refreshToken !== tok.refreshToken) {
      if (data.refresh_token) revokeToken(data.refresh_token, clientId || '');
      return;
    }
    saveTokens({
      accessToken: data.access_token,
      refreshToken: data.refresh_token || cur.refreshToken,
      idToken: data.id_token || cur.idToken,
      expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000,
      earliestRefreshAt: parseEarliest(data.earliest_refresh_at),
      scopes: data.scope ? String(data.scope).split(/\s+/).filter(Boolean) : cur.scopes,
      savedAt: Date.now(),
      welcomed: !!cur.welcomed
    });
  }
  let refreshPromise = null;
  async function refreshTokens(signal, staleBearer) {
    const aborted = () => !!(signal && signal.aborted);
    if (aborted()) throw abortError(signal.reason);
    if (!refreshPromise) {
      const run = () => rotateTokens(staleBearer);
      const p = Promise.resolve().then(() => ((navigator.locks && navigator.locks.request) ? navigator.locks.request(REFRESH_LOCK, run) : run()));
      refreshPromise = p;
      p.finally(() => { if (refreshPromise === p) refreshPromise = null; }).catch(() => {});
    }
    try { await refreshPromise; }
    catch (e) { if (aborted()) throw abortError(signal.reason); throw e; }
    if (aborted()) throw abortError(signal.reason);
  }
  async function ensureAccessToken(signal, staleBearer) {
    let tok = getTokens();
    if (!tok || !tok.accessToken) throw new ApiError(MSG.cgExpired, { status: 401, code: 'no_token' });
    if (!staleBearer && !needsRefresh(tok)) return tok.accessToken;
    await refreshTokens(signal, staleBearer);
    tok = getTokens();
    if (!tok || !tok.accessToken) throw new ApiError(MSG.cgExpired, { status: 401, code: 'no_token' });
    return tok.accessToken;
  }

  async function revokeToken(refreshToken, clientId) {
    const body = new URLSearchParams();
    body.set('token', refreshToken);
    body.set('token_type_hint', 'refresh_token');
    body.set('client_id', clientId);
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), REVOKE_TIMEOUT_MS);
    try {
      const res = await fetch(OAUTH.revoke, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString(), signal: ctl.signal });
      return res.ok;
    } catch { return false; }
    finally { clearTimeout(timer); }
  }
  function clearPlanSession(opts) {
    const o = opts || {};
    ls.remove(LS.cgTokens);
    if (o.dropReg) ls.remove(LS.cgReg);
    try { sessionStorage.removeItem(SS.stripped); } catch {}
  }
  async function logoutChatGPT() {
    const tok = getTokens();
    const reg = getReg();
    let revokeOk = true;
    if (tok && tok.refreshToken) revokeOk = await revokeToken(tok.refreshToken, (reg && reg.clientId) || '');
    clearPlanSession({ dropReg: false });
    return revokeOk;
  }

  async function handleAuthCallback() {
    const params = new URLSearchParams(location.search);
    const code = params.get('code');
    const stateParam = params.get('state');
    const error = params.get('error');
    const cbClientId = params.get('client_id');
    let pending = null;
    try { pending = JSON.parse(sessionStorage.getItem(SS.pending) || 'null'); } catch { pending = null; }
    try { sessionStorage.removeItem(SS.pending); } catch {}
    const appBase = location.pathname;
    const returnHash = pending && pending.returnHash ? pending.returnHash : '';
    const cleanUrl = () => { try { history.replaceState(null, '', appBase + returnHash); } catch {} };
    if (!pending || !stateParam || stateParam !== pending.state || (pending.startedAt && Date.now() - pending.startedAt > PENDING_TTL_MS)) {
      cleanUrl(); openGate(MSG.cgState); return;
    }
    cleanUrl();
    if (error) { openGate(error === 'access_denied' ? MSG.cgDenied : MSG.cgExchange); return; }
    if (!code) { openGate(MSG.cgState); return; }
    const reg = getReg();
    const issuedClientId = pending.clientId !== CLIENT_DYNAMIC ? pending.clientId : cbClientId;
    if (!issuedClientId || issuedClientId === CLIENT_DYNAMIC) { openGate(MSG.cgExchange); return; }
    if ((cbClientId && cbClientId !== issuedClientId) || (reg && reg.clientId && issuedClientId !== reg.clientId)) { openGate(MSG.cgMismatch); return; }
    let tok = null;
    let stored = false;
    const discard = () => { if (tok && tok.refresh_token && !stored) revokeToken(tok.refresh_token, issuedClientId); };
    try {
      tok = await exchangeCode(code, pending, issuedClientId);
      const claims = decodeJwt(tok.id_token);
      validateIdClaims(claims, issuedClientId, pending.nonce, true);
      if (reg && reg.subject && claims.sub !== reg.subject) { discard(); clearPlanSession({ dropReg: true }); openGate(MSG.cgMismatch); return; }
      const scopes = String(tok.scope || '').split(/\s+/).filter(Boolean);
      const hasPlan = scopes.includes(PLAN_SCOPE);
      const prevTok = getTokens();
      const wasWelcomed = !!((prevTok && prevTok.welcomed) || (reg && reg.welcomed));
      ls.set(LS.cgReg, {
        clientId: issuedClientId, subject: claims.sub,
        email: claims.email || (reg && reg.email) || '', name: claims.name || (reg && reg.name) || '',
        registeredAt: (reg && reg.registeredAt) || Date.now(), welcomed: wasWelcomed, planDeclined: !hasPlan
      });
      if (!hasPlan) { discard(); clearPlanSession({ dropReg: false }); openGate(MSG.cgNoScope); return; }
      storeTokenResponse(tok, scopes, { welcomed: wasWelcomed });
      stored = true;
      ls.setRaw(LS.authMode, 'chatgpt');
      state.apiKey = '';
      await refreshModelsPlan(true);
      if (!hasPlanSession()) return;
      closeGate();
      updateAuthUI();
      if (!wasWelcomed) { markWelcomed(); showWelcome(); }
      toast('로그인되었습니다');
    } catch {
      discard();
      if (pending.clientId === CLIENT_DYNAMIC && cbClientId && !getReg()) ls.set(LS.cgReg, { clientId: cbClientId, subject: '', email: '', name: '', registeredAt: Date.now() });
      openGate(MSG.cgExchange);
    }
  }
  function markWelcomed() {
    const tok = getTokens();
    if (tok) { tok.welcomed = true; saveTokens(tok); }
    const reg = getReg();
    if (reg) { reg.welcomed = true; ls.set(LS.cgReg, reg); }
  }
  function showWelcome() {
    const dlg = $('welcome');
    if (dlg && !dlg.open && typeof dlg.showModal === 'function') { try { dlg.showModal(); } catch {} }
  }

  async function readErrorBody(res, plan) {
    let body = null;
    try { body = await res.json(); } catch {}
    if (plan && body == null && (res.status === 404 || res.status === 405 || res.status === 501)) {
      state.proxyOk = false;
      return new ApiError(MSG.cgNoProxy, { status: res.status, code: 'no_proxy' });
    }
    let message = `HTTP ${res.status}`, code = '', type = '', param = '';
    if (body && body.error && typeof body.error === 'object') {
      message = body.error.message || message; code = body.error.code || ''; type = body.error.type || ''; param = body.error.param || '';
    } else if (body && typeof body.error === 'string') {
      code = body.error; message = body.error_description || body.error;
    } else if (body && body.detail != null) {
      const d = body.detail;
      message = typeof d === 'string' ? d : ((d && d.message) || JSON.stringify(d));
      code = 'detail';
    }
    return new ApiError(message, { status: res.status, code, type, param });
  }
  function apiUrl(path) { return isPlan() ? location.origin + PROXY_PREFIX + path : API_BASE + path; }
  async function apiFetch(path, opts) {
    const o = opts || {};
    const plan = isPlan();
    const doFetch = async (bearer) => {
      try {
        return await fetch(apiUrl(path), { ...o, headers: { Authorization: `Bearer ${bearer}`, ...(o.headers || {}) } });
      } catch (e) {
        if (o.signal && o.signal.aborted) throw abortError(o.signal.reason);
        if (isAbort(e)) throw e;
        throw new ApiError(MSG.netLost, { status: 0, code: 'network' });
      }
    };
    let bearer = plan ? await ensureAccessToken(o.signal) : state.apiKey;
    let res = await doFetch(bearer);
    if (res.status === 401 && plan) {
      bearer = await ensureAccessToken(o.signal, bearer);
      res = await doFetch(bearer);
    }
    if (!res.ok) throw await readErrorBody(res, plan);
    if (plan) state.proxyOk = true;
    return res;
  }

  function extractText(resp) {
    const msg = (resp.output || []).find((i) => i && i.type === 'message');
    const parts = msg && Array.isArray(msg.content) ? msg.content : [];
    const refusal = parts.find((c) => c && c.type === 'refusal');
    if (refusal) throw new ApiError(`모델이 요청을 거부했습니다. ${refusal.refusal || ''}`.trim(), { status: 0, code: 'refusal' });
    return parts.filter((c) => c && c.type === 'output_text').map((c) => c.text || '').join('');
  }
  function finishResponse(resp, streamedText) {
    if (!resp) throw new ApiError('응답이 완료되지 않았습니다.', { status: 0, code: 'no_terminal' });
    if (resp.status === 'failed') {
      const e = resp.error || {};
      throw new ApiError(e.message || '응답 생성에 실패했습니다.', { status: 0, code: e.code || 'response_failed' });
    }
    const fromOutput = extractText(resp);
    const text = streamedText != null && streamedText.length >= fromOutput.length ? streamedText : fromOutput;
    const details = resp.incomplete_details || {};
    return { text, response: resp, truncated: resp.status === 'incomplete', reason: details.reason || '', usage: resp.usage || null };
  }

  // Single HTTP attempt with an idle watchdog and SSE parsing.
  async function runAttempt(body, opts) {
    const parentSignal = opts.parentSignal;
    if (parentSignal.aborted) throw abortError(parentSignal.reason);
    const ctl = new AbortController();
    const relay = () => ctl.abort(parentSignal.reason);
    parentSignal.addEventListener('abort', relay, { once: true });
    if (opts.onController) opts.onController(ctl);
    let timer = null;
    let textSeen = false;
    const touch = () => { clearTimeout(timer); timer = setTimeout(() => ctl.abort(ABORT_WATCHDOG), textSeen ? WATCHDOG_MS : (opts.initialWatchdogMs || WATCHDOG_MS)); };
    touch();
    try {
      const res = await apiFetch('/v1/responses', { method: 'POST', signal: ctl.signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!body.stream) return finishResponse(await res.json(), null);
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      let full = '';
      let final = null;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf = (buf + dec.decode(value, { stream: true })).replace(/\r\n/g, '\n');
        let idx;
        while ((idx = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          const data = block.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('\n');
          if (!data || data === '[DONE]') continue;
          let ev;
          try { ev = JSON.parse(data); } catch { continue; }
          if (ev.type === 'response.output_text.delta' || ev.type === 'response.output_text.done') textSeen = true;
          touch();
          switch (ev.type) {
            case 'response.output_text.delta':
              full += ev.delta || '';
              if (opts.onDelta) opts.onDelta(full);
              break;
            case 'response.output_text.done':
              if (typeof ev.text === 'string') full = ev.text;
              if (opts.onDelta) opts.onDelta(full);
              break;
            case 'response.completed':
            case 'response.incomplete':
            case 'response.failed':
              final = ev.response;
              break;
            case 'error':
              throw new ApiError(ev.message || '스트림 오류', { status: 0, code: ev.code || 'stream_error' });
            default:
              break;
          }
        }
      }
      return finishResponse(final, full);
    } catch (e) {
      if (ctl.signal.aborted) {
        if (ctl.signal.reason === ABORT_WATCHDOG && !parentSignal.aborted) throw new ApiError('응답이 오래 멈춰 연결을 끊었습니다.', { status: 0, code: 'timeout' });
        throw abortError(ctl.signal.reason);
      }
      if (e instanceof TypeError) throw new ApiError(MSG.netLost, { status: 0, code: 'network' });
      throw e;
    } finally {
      clearTimeout(timer);
      parentSignal.removeEventListener('abort', relay);
    }
  }

  function isRetryable(err) {
    if (!err || isAbort(err)) return false;
    if (err.code === 'no_proxy') return false;
    const s = err.status;
    if (typeof err.code === 'string' && err.code.indexOf('subscription_sharing_') === 0) {
      return err.code === 'subscription_sharing_usage_unavailable' || err.code === 'subscription_sharing_user_unavailable';
    }
    if (s === 429) return err.code !== 'insufficient_quota';
    if (s === 403) return false;
    if (s === 408 || s === 409 || s >= 500) return true;
    return s === 0 && ['network', 'timeout', 'server_error', 'no_terminal'].includes(err.code);
  }
  // Maps a param the plan route rejected to a strippable path, or ''.
  function planStripPath(param) {
    const p = String(param || '');
    if (/^text\.format(\.|$)/.test(p)) return 'text.format';
    if (/^reasoning(\.|$)/.test(p)) return 'reasoning';
    return PLAN_OPTIONAL.test(p) ? p : '';
  }
  async function withRetry(run, opts) {
    const signal = opts.signal;
    let stripped = false;
    let timedOut = false;
    const strips = [];
    for (let attempt = 0; ; attempt++) {
      try {
        const r = await run({ stripParams: stripped, strips });
        for (const p of strips) addStripped(p);
        return r;
      } catch (err) {
        if (isAbort(err) || (signal && signal.aborted)) throw err;
        if (err.status === 401) throw err;
        if (opts.plan && err.status === 400 && err.code === 'subscription_sharing_unsupported_capability') {
          if (err.param === 'model') throw new ApiError(MSG.cgModelUnsupported, { status: 400, code: 'model_unsupported' });
          const path = planStripPath(err.param);
          if (path && strips.length < 3 && !strips.includes(path) && !isStripped(path)) { strips.push(path); attempt--; continue; }
          throw err;
        }
        if (err.status === 400 && !stripped && PARAM_ERROR.test(`${err.code} ${err.message}`)) { stripped = true; attempt--; continue; }
        if (err.code === 'timeout') { if (timedOut) throw err; timedOut = true; }
        if (!isRetryable(err) || attempt >= RETRY_DELAYS.length) throw err;
        const delay = Math.round(RETRY_DELAYS[attempt] * (0.7 + Math.random() * 0.6));
        if (opts.onRetry) opts.onRetry(err, delay);
        await sleep(delay, signal);
      }
    }
  }

  function abortMessage(reason) {
    if (reason === ABORT_QUOTA) return MSG.quota;
    if (reason === ABORT_AUTH) return isPlan() ? MSG.cgExpired : MSG.e401;
    if (reason === ABORT_PLAN_LIMIT) return MSG.cgLimit;
    if (reason === ABORT_PLAN_INELIGIBLE) return MSG.cgIneligible;
    if (reason === ABORT_PLAN_MODEL) return MSG.cgModelUnsupported;
    return MSG.userAbort;
  }
  function errorMessage(err) {
    if (!err) return '알 수 없는 오류';
    if (isAbort(err)) return abortMessage(err.reason);
    const code = err.code || '';
    if (code === 'no_proxy') return MSG.cgNoProxy;
    if (code === 'proxy_upstream') return MSG.network;
    if (code === 'subscription_sharing_usage_limit_exceeded') return MSG.cgLimit;
    if (code === 'subscription_sharing_user_not_eligible') return MSG.cgIneligible;
    if (code === 'model_unsupported') return MSG.cgModelUnsupported;
    if (code === 'subscription_sharing_unsupported_capability') return err.param ? `${MSG.cgUnsupported} (${err.param})` : MSG.cgUnsupported;
    if (code === 'subscription_sharing_usage_unavailable' || code === 'subscription_sharing_user_unavailable') return MSG.cg503;
    if (code === 'subscription_sharing_route_not_supported') return MSG.cg403;
    if (code === 'chatpass_v2_scope_not_authorized' || code === 'chatpass_v2_invalid_authorization_context') return MSG.cg403;
    if (code === 'subscription_sharing_invalid_user') return isPlan() ? MSG.cgExpired : MSG.e401;
    const s = err.status || 0;
    if (s === 401) return isPlan() ? MSG.cgExpired : MSG.e401;
    if (s === 403) return isPlan() ? MSG.cg403 : MSG.e403;
    if (s === 400 && PDF_FETCH_ERROR.test(err.message || '')) return MSG.pdfFetch;
    if (s === 413) return MSG.tooBig;
    if (s === 429) return err.code === 'insufficient_quota' ? MSG.quota : (isPlan() ? MSG.cgLimit : MSG.e429);
    if (s >= 500) return isPlan() ? MSG.cg503 : `OpenAI 서버 오류입니다 (HTTP ${s}). 잠시 후 다시 시도해 주세요.`;
    if (err.code === 'network') return MSG.netLost;
    return err.message || '알 수 없는 오류';
  }
  function errorCode(err) {
    if (!err) return '';
    if (isAbort(err)) return '중단';
    if (err.status) return `HTTP ${err.status}`;
    return err.code || '';
  }

  async function uploadFile(file, signal) {
    const res = await withRetry(() => {
      const fd = new FormData();
      fd.append('purpose', 'user_data');
      fd.append('expires_after[anchor]', 'created_at');
      fd.append('expires_after[seconds]', '86400');
      fd.append('file', file, file.name);
      return apiFetch('/v1/files', { method: 'POST', body: fd, signal });
    }, { signal });
    const data = await res.json();
    if (!data || !data.id) throw new ApiError('파일 업로드 응답이 올바르지 않습니다.', { status: 0, code: 'upload' });
    return data.id;
  }
  function deleteFile(id) {
    apiFetch(`/v1/files/${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => {});
  }
  async function countPdfPages(file) {
    try {
      const text = new TextDecoder('latin1').decode(await file.arrayBuffer());
      if (/\/ObjStm\b/.test(text)) return 0;
      const m = text.match(/\/Type\s*\/Page(?!s)/g);
      return m ? m.length : 0;
    } catch { return 0; }
  }

  const URL_RE = {
    paywalled: /^https?:\/\/(?:[^/]+\.)?(?:ieeexplore\.ieee\.org|ieee\.org|dl\.acm\.org|sciencedirect\.com|springer\.com|springerlink\.com|nature\.com|wiley\.com|tandfonline\.com|jstor\.org|elsevier\.com|cell\.com|science\.org|pnas\.org)\//i,
    scholar: /^https?:\/\/scholar\.google\.[a-z.]+\//i,
    arxiv: /^(?:https?:\/\/)?(?:www\.)?(?:(?:export\.)?arxiv\.org\/(?:abs|pdf|html|format|e-print)\/|ar5iv\.(?:labs\.)?arxiv\.org\/html\/|alphaxiv\.org\/(?:abs|overview|pdf)\/|huggingface\.co\/papers\/|doi\.org\/10\.48550\/arXiv\.|arxiv:\s*)?(\d{2}(?:0[1-9]|1[0-2])\.\d{4,5}|[a-z]+(?:-[a-z]+)?(?:\.[A-Z]{2})?\/\d{2}(?:0[1-9]|1[0-2])\d{3})(v\d+)?(?:\.pdf)?(?:[?#].*)?$/i,
    arxivId: /(?<![\w.])(\d{2}(?:0[1-9]|1[0-2])\.\d{4,5}(?:v\d+)?|[a-z]+(?:-[a-z]+)?(?:\.[A-Z]{2})?\/\d{2}(?:0[1-9]|1[0-2])\d{3}(?:v\d+)?)(?!\d|\.\d)/,
    openreviewQ: /openreview\.net\/.*?[?&]id=([A-Za-z0-9_-]+)/i,
    openreviewP: /openreview\.net\/pdf\/([A-Za-z0-9_-]+)\.pdf/i,
    acl: /^https?:\/\/(?:www\.)?(?:aclanthology\.org|aclweb\.org\/anthology)\/((?:\d{4}\.[a-z0-9]+-[a-z0-9]+\.\d+)|(?:[A-Z]\d{2}-\d{4}))(?:\.pdf|\/)?(?:[?#].*)?$/,
    cvf: /^https?:\/\/openaccess\.thecvf\.com\/(content(?:_[A-Za-z]+_\d{4}(?:_workshops)?|\/[A-Za-z]+\d{4}[A-Za-z]*(?:\/[^/]+)?))\/(?:html|papers)\/([^/?#]+?)(?:\.html|\.pdf)(?:[?#].*)?$/,
    pmlr: /^https?:\/\/proceedings\.mlr\.press\/(v\d+)\/([a-z0-9-]+?)(?:\/\2)?(?:\.html|\.pdf)?\/?(?:[?#].*)?$/,
    neurips: /^https?:\/\/(?:proceedings\.neurips\.cc|papers\.nips\.cc|papers\.neurips\.cc)\/(paper_files\/paper|paper)\/(\d{4})\/(?:hash|file)\/([0-9a-f]{32})-(?:Abstract|Paper)((?:-[A-Za-z_]+)?)(?:\.html|\.pdf)(?:[?#].*)?$/,
    rxiv: /^https?:\/\/(?:www\.)?(biorxiv|medrxiv)\.org\/content\/(?:(?:biorxiv|medrxiv)\/early\/\d{4}\/\d{2}\/\d{2}\/|10\.1101\/)(\d{4}\.\d{2}\.\d{2}\.\d{6,8})(v\d+)?(?:\.full|\.abstract|\.full\.pdf|\.full-text\.pdf|\.full\.pdf\+html)?\/?(?:[?#].*)?$/,
    s2: /^https?:\/\/(?:www\.)?semanticscholar\.org\/(?:paper\/(?:[^/?#]+\/)?([0-9a-f]{40})|arxiv\/(\d{4}\.\d{4,5}(?:v\d+)?))(?:[?#].*)?$/,
    pdf: /^https?:\/\/[^\s?#]+\.pdf(?:[?#].*)?$/i
  };

  function arxivResult(id, ver) {
    const full = id + (ver || '');
    return { kind: 'pdf', site: 'arxiv', pdfUrl: `https://arxiv.org/pdf/${full}`, landingUrl: `https://arxiv.org/abs/${full}`, iframeOk: true, arxivId: full };
  }
  function normalizeUrl(input) {
    let url = String(input || '').trim();
    if (!url) return { kind: 'unsupported', reason: MSG.urlScheme };
    url = url.replace(/^http:\/\//i, 'https://');
    const scholarRedirect = URL_RE.scholar.test(url) && /[?&]url=([^&]+)/.exec(url);
    if (scholarRedirect) { try { url = decodeURIComponent(scholarRedirect[1]); } catch {} }
    if (URL_RE.paywalled.test(url)) return { kind: 'unsupported', reason: MSG.paywalled };
    if (URL_RE.scholar.test(url)) return { kind: 'unsupported', reason: MSG.scholar };
    let m = URL_RE.arxiv.exec(url);
    if (m) return arxivResult(m[1], m[2]);
    m = URL_RE.openreviewQ.exec(url) || URL_RE.openreviewP.exec(url);
    if (m) return { kind: 'pdf', site: 'openreview', pdfUrl: `https://openreview.net/pdf?id=${m[1]}`, landingUrl: `https://openreview.net/forum?id=${m[1]}`, iframeOk: false };
    m = URL_RE.acl.exec(url);
    if (m) return { kind: 'pdf', site: 'acl', pdfUrl: `https://aclanthology.org/${m[1]}.pdf`, landingUrl: `https://aclanthology.org/${m[1]}/`, iframeOk: true };
    m = URL_RE.cvf.exec(url);
    if (m) return { kind: 'pdf', site: 'cvf', pdfUrl: `https://openaccess.thecvf.com/${m[1]}/papers/${m[2]}.pdf`, landingUrl: `https://openaccess.thecvf.com/${m[1]}/html/${m[2]}.html`, iframeOk: true };
    m = URL_RE.pmlr.exec(url);
    if (m) {
      const nested = `https://proceedings.mlr.press/${m[1]}/${m[2]}/${m[2]}.pdf`;
      const flat = `https://proceedings.mlr.press/${m[1]}/${m[2]}.pdf`;
      const newer = parseInt(m[1].slice(1), 10) >= 80;
      const given = /\.pdf(?:[?#].*)?$/i.test(url) ? url.replace(/[?#].*$/, '') : null;
      return { kind: 'pdf', site: 'pmlr', pdfUrl: given || (newer ? nested : flat), altPdfUrl: given ? null : (newer ? flat : nested), landingUrl: `https://proceedings.mlr.press/${m[1]}/${m[2]}.html`, iframeOk: true };
    }
    m = URL_RE.neurips.exec(url);
    if (m) return { kind: 'pdf', site: 'neurips', pdfUrl: `https://proceedings.neurips.cc/${m[1]}/${m[2]}/file/${m[3]}-Paper${m[4]}.pdf`, landingUrl: `https://proceedings.neurips.cc/${m[1]}/${m[2]}/hash/${m[3]}-Abstract${m[4]}.html`, iframeOk: false };
    m = URL_RE.rxiv.exec(url);
    if (m) {
      const base = `https://www.${m[1]}.org/content/10.1101/${m[2]}${m[3] || ''}`;
      return { kind: 'pdf', site: m[1], pdfUrl: `${base}.full.pdf`, landingUrl: base, iframeOk: m[1] === 'biorxiv' };
    }
    m = URL_RE.s2.exec(url);
    if (m) return m[2] ? arxivResult(m[2].replace(/v\d+$/, ''), (m[2].match(/v\d+$/) || [''])[0]) : { kind: 's2', paperId: m[1], landingUrl: url };
    if (URL_RE.pdf.test(url)) return { kind: 'pdf', site: 'direct', pdfUrl: url, landingUrl: url, iframeOk: true };
    m = URL_RE.arxivId.exec(url);
    if (m) { const v = m[1].match(/v\d+$/); return arxivResult(m[1].replace(/v\d+$/, ''), v ? v[0] : ''); }
    if (!/^https?:\/\//i.test(url)) return { kind: 'unsupported', reason: MSG.urlScheme };
    return { kind: 'unsupported', reason: MSG.unsupported };
  }

  async function resolveS2(paperId) {
    const cache = ls.get(LS.s2cache, {}) || {};
    if (typeof cache[paperId] === 'string') return cache[paperId];
    const url = `https://api.semanticscholar.org/graph/v1/paper/${paperId}?fields=title,externalIds,openAccessPdf`;
    let res;
    try {
      res = await fetch(url);
      if (res.status === 429) { await sleep(1500); res = await fetch(url); }
    } catch { throw new Error('Semantic Scholar에 연결할 수 없습니다. 네트워크를 확인해 주세요.'); }
    if (!res.ok) throw new Error(`Semantic Scholar 조회에 실패했습니다 (HTTP ${res.status}).`);
    const data = await res.json();
    const arx = data && data.externalIds && data.externalIds.ArXiv;
    const target = arx ? `https://arxiv.org/abs/${arx}` : ((data && data.openAccessPdf && data.openAccessPdf.url) || '');
    cache[paperId] = target;
    ls.set(LS.s2cache, cache);
    return target;
  }
  async function resolveSource(input) {
    let n = normalizeUrl(input);
    if (n.kind === 's2') {
      const target = await resolveS2(n.paperId);
      if (!target) return { kind: 'unsupported', reason: 'Semantic Scholar에서 공개 PDF를 찾지 못했습니다. PDF를 업로드해 주세요.' };
      const resolved = normalizeUrl(target);
      if (resolved.kind !== 'pdf') return { kind: 'unsupported', reason: MSG.unsupported };
      n = { ...resolved, landingUrl: n.landingUrl };
    }
    if (n.kind === 'pdf' && n.altPdfUrl) {
      try {
        const head = await fetch(n.pdfUrl, { method: 'HEAD' });
        if (!head.ok) n = { ...n, pdfUrl: n.altPdfUrl };
      } catch {}
    }
    return n;
  }

  function normalizeOutline(rawOutline, rawTotal, pageHint) {
    const items = (Array.isArray(rawOutline) ? rawOutline : [])
      .filter((s) => s && Number.isFinite(+s.start_page) && Number.isFinite(+s.end_page))
      .map((s) => ({
        number: String(s.number || '').trim(),
        titleEn: String(s.title_en || '').trim(),
        titleKo: String(s.title_ko || '').trim(),
        startPage: Math.round(+s.start_page),
        endPage: Math.round(+s.end_page),
        kind: ['body', 'abstract', 'references', 'appendix', 'acknowledgments'].includes(s.kind) ? s.kind : 'body'
      }));
    let total = Math.round(+rawTotal) || 0;
    if (pageHint > 0 && (total <= 0 || total > pageHint)) total = pageHint;
    if (total <= 0) total = items.reduce((m, s) => Math.max(m, s.endPage), 0);
    if (total <= 0) return { sections: [], totalPages: 0, fallback: true };
    items.sort((a, b) => a.startPage - b.startPage);
    const sections = [];
    let prevEnd = 1;
    for (const s of items) {
      if (s.startPage > total) continue;
      let start = clamp(s.startPage, 1, total);
      let end = clamp(s.endPage, 1, total);
      start = Math.max(start, prevEnd);
      if (end < start) continue;
      sections.push({ ...s, startPage: start, endPage: end });
      prevEnd = end;
    }
    if (sections.length) { sections[0].startPage = 1; sections[sections.length - 1].endPage = total; }
    const covered = sections.reduce((n, s) => n + (s.endPage - s.startPage + 1), 0);
    const bodyCount = sections.filter((s) => s.kind === 'body').length;
    if (!sections.length || bodyCount < 2 || covered / total < 0.6) return { sections: fallbackSections(total), totalPages: total, fallback: true };
    sections.forEach((s, i) => { s.id = `s${String(i + 1).padStart(2, '0')}`; });
    return { sections, totalPages: total, fallback: false };
  }
  function fallbackSections(total) {
    const out = [];
    for (let p = 1; p <= total; p += 4) {
      const end = Math.min(total, p + 3);
      out.push({ id: `s${String(out.length + 1).padStart(2, '0')}`, number: '', titleEn: `Pages ${p}–${end}`, titleKo: `${p}–${end} 페이지`, startPage: p, endPage: end, kind: 'body' });
    }
    return out;
  }

  function sectionLabel(s) { return s ? [s.number, s.titleEn].filter(Boolean).join(' ') : ''; }
  function sectionLabelKo(s) { return s ? [s.number, s.titleKo || s.titleEn].filter(Boolean).join(' ') : ''; }

  function buildChunksFromSections(sections, totalPages, opts) {
    const o = opts || {};
    const includeAppendix = o.includeAppendix !== false;
    const chunks = [];
    const push = (group, startPage, endPage, extra) => {
      const first = group[0];
      const kind = first.kind === 'acknowledgments' ? 'body' : first.kind;
      chunks.push({
        id: '', kind, sectionKey: first.id, lastKey: group[group.length - 1].id, sectionNumber: first.number,
        titleEn: group.map(sectionLabel).join('; '), titleKo: group.map(sectionLabelKo).join('; '),
        sections: o.fallback ? [] : group.map((s) => ({ number: s.number, titleEn: s.titleEn, titleKo: s.titleKo })),
        startPage, endPage, prev: '', next: '', nextSec: null, partIndex: 1, partCount: 1,
        status: 'pending', text: '', truncated: false, truncReason: '', error: null, errorCode: '', attempts: 0, attemptId: 0,
        ...extra
      });
    };
    let i = 0;
    while (i < sections.length) {
      const s = sections[i];
      if (s.kind === 'abstract') {
        const title = `## ${s.titleKo || '초록'}(${s.titleEn || 'Abstract'})`;
        push([s], s.startPage, s.endPage, { status: 'done', text: o.abstractKo ? `${title}\n\n${o.abstractKo}` : `${title}\n\n(초록 번역 없음)` });
        i++; continue;
      }
      if (s.kind === 'references') {
        push([s], s.startPage, s.endPage, { status: 'skipped', text: `> 참고문헌 목록은 원문 ${s.startPage}–${s.endPage} 페이지를 참조한다.` });
        i++; continue;
      }
      const len = s.endPage - s.startPage + 1;
      if (len > 6) {
        const parts = Math.ceil(len / 4);
        const base = Math.floor(len / parts);
        let rem = len % parts;
        let p = s.startPage;
        for (let k = 1; k <= parts; k++) {
          const size = base + (rem > 0 ? 1 : 0);
          rem = Math.max(0, rem - 1);
          push([s], p, p + size - 1, { partIndex: k, partCount: parts });
          p += size;
        }
        i++; continue;
      }
      const group = [s];
      let j = i + 1;
      while (j < sections.length) {
        const n = sections[j];
        const compatible = n.kind === s.kind || (n.kind === 'acknowledgments' && s.kind === 'body');
        if (!compatible || n.endPage - s.startPage + 1 > 5) break;
        group.push(n); j++;
      }
      push(group, s.startPage, group[group.length - 1].endPage, {});
      i = j;
    }
    const secIndex = new Map(sections.map((s, idx) => [s.id, idx]));
    chunks.forEach((c, idx) => {
      c.id = `c${String(idx + 1).padStart(2, '0')}`;
      const firstIdx = secIndex.get(c.sectionKey);
      const lastIdx = secIndex.get(c.lastKey);
      const prevSec = sections[firstIdx - 1] || null;
      const nextSec = sections[lastIdx + 1] || null;
      const middle = c.partCount > 1;
      c.prev = middle && c.partIndex > 1 ? '같은 섹션의 이전 페이지 조각' : (sectionLabel(prevSec) || '(없음, 문서 시작)');
      c.next = middle && c.partIndex < c.partCount ? '같은 섹션의 다음 페이지 조각' : (sectionLabel(nextSec) || '(없음, 문서 끝)');
      c.nextSec = middle && c.partIndex < c.partCount ? null : (nextSec ? { number: nextSec.number, titleEn: nextSec.titleEn, titleKo: nextSec.titleKo } : null);
      if (c.kind === 'appendix' && !includeAppendix && c.status === 'pending') {
        c.status = 'skipped';
        c.text = '> 부록은 설정에 따라 번역에서 제외되었다. 카드의 "번역" 버튼으로 이 부록만 번역할 수 있다.';
        c.optional = true;
      }
    });
    return chunks;
  }
  function buildChunks(rawOutline, totalPages, opts) {
    const o = opts || {};
    const norm = normalizeOutline(rawOutline, totalPages, o.pageHint || 0);
    return buildChunksFromSections(norm.sections, norm.totalPages, { ...o, fallback: norm.fallback });
  }
  function queueOrder(chunks) {
    return chunks.map((c, i) => [c, i]).sort((a, b) => ((a[0].kind === 'appendix') - (b[0].kind === 'appendix')) || (a[1] - b[1])).map((x) => x[0]);
  }

  function mergeGlossary(paperList) {
    const seen = new Map();
    for (const g of (Array.isArray(paperList) ? paperList : [])) {
      if (!g || typeof g.en !== 'string') continue;
      const en = g.en.trim().toLowerCase();
      if (!en || seen.has(en)) continue;
      seen.set(en, { en, ko: String(g.ko || '').trim() || g.en.trim() });
    }
    const paperCount = seen.size;
    for (const g of P.DEFAULT_GLOSSARY) {
      if (seen.size >= GLOSSARY_CAP) break;
      const key = g.en.toLowerCase();
      if (!seen.has(key)) seen.set(key, g);
    }
    return { list: [...seen.values()].slice(0, GLOSSARY_CAP), paperCount };
  }

  function stripFence(t) {
    const m = /^```[^\n]*\n([\s\S]*?)\n```\s*$/.exec(t);
    return m ? m[1] : t;
  }
  function normText(s) { return String(s || '').replace(/[#*_`>\s]+/g, ' ').trim().toLowerCase(); }
  // Removes fences and neighbouring-section headings from a chunk's output.
  function cleanupChunkText(text, chunk) {
    const lines = stripFence(String(text || '').replace(/\r\n/g, '\n').trim()).split('\n');
    if (chunk.partIndex > 1 && /^#{1,6}\s/.test(lines[0] || '')) lines.shift();
    const next = chunk.nextSec;
    if (next) {
      const ownNums = new Set((chunk.sections || []).map((s) => s.number).filter(Boolean));
      const numRe = next.number ? new RegExp(`^${escapeRe(next.number)}[\\s.)]`) : null;
      const titles = [next.titleEn, next.titleKo].map((x) => String(x || '').trim().toLowerCase()).filter((x) => x.length >= 3);
      for (let i = 1; i < lines.length; i++) {
        const m = /^#{1,3}\s+(.*)$/.exec(lines[i]);
        if (!m) continue;
        const h = m[1].trim();
        const numTok = /^([A-Za-z]|\d+)(?:\.\d+)*(?=[\s.)])/.exec(h);
        if (numTok && ownNums.has(numTok[1])) continue;
        const stripped = h.replace(/^([A-Za-z]|\d+)(?:\.\d+)*[.)]?\s+/, '').toLowerCase();
        const numHit = numRe && numRe.test(h) && !ownNums.has(next.number);
        const titleHit = titles.some((t) => stripped.startsWith(t) || stripped.includes(`(${t}`));
        if (numHit || titleHit) { lines.length = i; chunk.cutAtNext = true; break; }
      }
    }
    return lines.join('\n').trim();
  }
  function dropOverlap(prevText, text) {
    const tail = normText(prevText).slice(-300);
    const lines = String(text || '').split('\n');
    let cut = 0;
    for (let i = 0; i < Math.min(lines.length, 6); i++) {
      const n = normText(lines[i]);
      if (n.length >= 15 && tail.includes(n)) cut = i + 1;
    }
    return cut ? lines.slice(cut).join('\n').replace(/^\n+/, '') : text;
  }
  function joinParts(a, b) {
    const left = String(a || '').trimEnd();
    if (!left) return b;
    if (!b) return left;
    return /[.다」)]$|\$\$$|\|$/.test(left) ? `${left}\n\n${b}` : `${left} ${b}`;
  }

  const MATH_RE = /(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`)|(\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)|\$(?!\s|\$)(?:\\.|[^\n$\\])+?(?<![\s\\])\$(?!\d))/g;
  function protectMath(text) {
    const saved = [];
    const out = text.replace(MATH_RE, (m, code, math) => {
      if (code) return m;
      saved.push(math);
      return `\uE000${saved.length - 1}\uE001`;
    });
    return { out, saved };
  }
  const CODE_RE = /(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`)/;
  const TIGHT_STRONG_RE = /\*\*(?=[^\s*])([^*\n]*?[\p{P}\p{S}])\*\*(?=[\p{L}\p{N}])/gu;
  // Converts **bold** that CommonMark won't close before a letter into <strong>.
  function fixTightStrong(text) {
    return text.split(CODE_RE).map((part, i) => (i % 2 ? part : part.replace(TIGHT_STRONG_RE, '<strong>$1</strong>'))).join('');
  }
  function plainHtml(src) {
    return src.split(/\n{2,}/).filter((p) => p.trim()).map((p) => `<p>${escapeHtml(p)}</p>`).join('');
  }
  function renderMarkdown(text) {
    const src = String(text || '');
    if (typeof marked === 'undefined' || typeof DOMPurify === 'undefined' || typeof DOMPurify.sanitize !== 'function') return plainHtml(src);
    const { out, saved } = protectMath(src);
    let html;
    try { html = marked.parse(fixTightStrong(out), { gfm: true, breaks: false }); } catch { return plainHtml(src); }
    if (typeof html !== 'string') return plainHtml(src);
    html = DOMPurify.sanitize(html, { ADD_ATTR: ['target'], FORBID_TAGS: ['style', 'iframe', 'form'], FORBID_ATTR: ['id'] });
    return html.replace(/\uE000(\d+)\uE001/g, (_, i) => escapeHtml(saved[+i] || ''));
  }
  const LIST_ITEM_RE = /^( *)([-*+]|\d{1,9}[.)])( +)(?=\S)/;
  function normalizeListIndent(text) {
    const out = [];
    const stack = [];
    let fence = false;
    let math = false;
    let prevBlank = false;
    for (const raw of String(text || '').replace(/\r\n/g, '\n').split('\n')) {
      if (fence || math) {
        if (fence && /^\s*(```|~~~)/.test(raw)) fence = false;
        else if (math && (raw.match(/\$\$/g) || []).length % 2) math = false;
        out.push(raw);
        continue;
      }
      if (!raw.trim()) { prevBlank = true; out.push(raw); continue; }
      const line = raw.replace(/^[ \t]+/, (ws) => ws.replace(/\t/g, '    '));
      const body = line.trimStart();
      const ind = line.length - body.length;
      const m = LIST_ITEM_RE.exec(line);
      if (m) while (stack.length && stack[stack.length - 1].mark >= ind) stack.pop();
      else if (prevBlank) while (stack.length && stack[stack.length - 1].orig > ind) stack.pop();
      const top = stack[stack.length - 1];
      let at = ind;
      if (top && ind >= top.orig) at = ind + top.now - top.orig;
      else if (top && m) at = top.now;
      if (m) {
        const w = m[2].length + Math.min(m[3].length, 4);
        stack.push({ mark: ind, orig: ind + w, now: at + w });
      }
      const fixed = ' '.repeat(at) + body;
      if (/^(```|~~~)/.test(body)) fence = true;
      else if ((body.match(/\$\$/g) || []).length % 2) math = true;
      out.push(fixed);
      prevBlank = false;
    }
    return out.join('\n');
  }
  function mountMarkdown(target, text) {
    target.innerHTML = renderMarkdown(text);
    for (const a of target.querySelectorAll('a[href]')) { a.setAttribute('target', '_blank'); a.setAttribute('rel', 'noopener'); }
    for (const t of target.querySelectorAll('table')) {
      if (t.parentElement && t.parentElement.classList.contains('table-wrap')) continue;
      const w = el('div', { class: 'table-wrap' });
      t.replaceWith(w);
      w.append(t);
    }
    typesetMath(target);
  }
  function typesetMath(target) {
    if (!state.rawMath && typeof renderMathInElement === 'function') {
      try { renderMathInElement(target, KATEX_OPTS); } catch {}
    }
  }

  function balancedMath(s) {
    const dd = (s.match(/\$\$/g) || []).length;
    const d = (s.match(/(?<!\\)\$/g) || []).length;
    const fences = (s.match(/^```/gm) || []).length;
    return dd % 2 === 0 && d % 2 === 0 && fences % 2 === 0;
  }
  function splitPoint(text) {
    let idx = text.lastIndexOf('\n\n');
    while (idx > 0) {
      if (balancedMath(text.slice(0, idx))) return idx + 2;
      idx = text.lastIndexOf('\n\n', idx - 1);
    }
    return 0;
  }
  function cardEl(chunkId) { return document.getElementById(`sec-${chunkId}`); }
  function scheduleRender(job, chunk) {
    if (renderTimers.has(chunk.id)) return;
    renderTimers.set(chunk.id, setTimeout(() => {
      renderTimers.delete(chunk.id);
      requestAnimationFrame(() => renderStreaming(job, chunk));
    }, 150));
  }
  function renderStreaming(job, chunk) {
    if (chunk.status !== 'running' && chunk.status !== 'retrying') return;
    if (document.hidden || state.currentTab !== 'translation' || state.currentJobId !== job.id) { chunk.dirty = true; return; }
    const card = cardEl(chunk.id);
    if (!card) return;
    const split = splitPoint(chunk.text);
    const stableText = chunk.text.slice(0, split);
    const rs = renderState.get(chunk.id) || { stableLen: -1 };
    if (stableText.length !== rs.stableLen) {
      mountMarkdown(card.querySelector('.md--stable'), stableText);
      rs.stableLen = stableText.length;
      renderState.set(chunk.id, rs);
    }
    card.querySelector('.md--tail').innerHTML = renderMarkdown(chunk.text.slice(split));
    chunk.dirty = false;
    tocHeadings(card, chunk);
    scheduleTocSub(job, chunk);
  }
  function flushDirtyRenders() {
    const job = currentJob();
    if (!job) return;
    for (const c of job.chunks) if (c.dirty) renderStreaming(job, c);
  }
  function currentJob() { return state.currentJobId ? state.jobs[state.currentJobId] || null : null; }

  const OUTLINE_FORMAT = { type: 'json_schema', name: 'paper_outline', strict: true, schema: P.OUTLINE_SCHEMA };
  const SUMMARY_FORMAT = { type: 'json_schema', name: 'paper_summary', strict: true, schema: P.SUMMARY_SCHEMA };
  const IDEAS_FORMAT = { type: 'json_schema', name: 'paper_ideas', strict: true, schema: P.IDEAS_SCHEMA };
  const fileCache = new Map();

  function makeSemaphore(n) {
    const s = { max: n, active: 0, waiters: [] };
    s.pump = () => { while (s.active < s.max && s.waiters.length) { s.active++; s.waiters.shift()(); } };
    s.acquire = () => new Promise((resolve) => { s.waiters.push(resolve); s.pump(); });
    s.release = () => { s.active = Math.max(0, s.active - 1); s.pump(); };
    return s;
  }
  function newRun(job) {
    const run = { jobId: job.id, abort: new AbortController(), sem: makeSemaphore(job.concurrency), active: 0, rateHits: 0, halved: false, cancelled: false, chunkCtl: new Map(), uploadPromise: null };
    state.run = run;
    return run;
  }
  function track(job, run, promise) {
    run.active++;
    promise.catch(() => {}).finally(() => {
      run.active--;
      if (run.active === 0) finalizeJob(job, run);
    });
  }
  function abEffort(job) { return job.effort === 'none' ? 'low' : job.effort; }
  function mapEffort(model, effort) { return effort === 'none' && MINIMAL_EFFORT_MODELS.test(model) ? 'minimal' : effort; }
  function filePart(job) {
    const s = job.source;
    if (s.type !== 'file') return { type: 'input_file', file_url: s.pdfUrl, detail: 'low' };
    if (job.planMode) return { type: 'input_file', filename: s.fileName || 'paper.pdf', file_data: s.fileData || '', detail: 'low' };
    return { type: 'input_file', file_id: s.fileId, detail: 'low' };
  }
  function buildBody(job, task, o) {
    const plan = job.planMode;
    const common = o.glossaryStr != null ? `${P.COMMON_RULES}\n\n[용어집]\n${o.glossaryStr}` : P.COMMON_RULES;
    const stripped = plan ? [...getStripped(), ...(o.strips || [])] : [];
    const formatStripped = plan && o.format && (stripped.includes('text.format') || stripped.includes('text'));
    let perCall = o.perCall;
    if (formatStripped) perCall = `${perCall}\n\n아래 JSON 스키마에 맞는 JSON 객체 하나만 출력하세요. 코드 펜스나 설명 없이 JSON만 출력합니다.\n${JSON.stringify(o.format.schema)}`;
    const body = {
      model: job.model,
      store: false,
      prompt_cache_key: job.cacheKey,
      instructions: P.SYSTEM,
      input: [{ role: 'user', content: [filePart(job), { type: 'input_text', text: common }, { type: 'input_text', text: perCall }] }]
    };
    if (!plan) {
      body.safety_identifier = state.browserId;
      body.metadata = { app: 'rpt', task, chunk: o.chunkId || '-' };
      body.max_output_tokens = o.maxTokens;
    }
    if (o.stream || plan) { body.stream = true; body.stream_options = { include_obfuscation: false }; }
    const text = {};
    if (o.format && !formatStripped) text.format = o.format;
    if (!/^gpt-4/.test(job.model) && !o.stripParams) {
      body.reasoning = { effort: mapEffort(job.model, o.effort) };
      if (o.verbosity) text.verbosity = o.verbosity;
    }
    if (Object.keys(text).length) body.text = text;
    for (const path of stripped) deleteByPath(body, path);
    if (stripped.length) for (const k of ['reasoning', 'text', 'stream_options']) if (body[k] && !Object.keys(body[k]).length) delete body[k];
    return body;
  }
  function addUsage(job, usage) {
    if (!usage) return;
    job.usage.input += usage.input_tokens || 0;
    job.usage.cached += (usage.input_tokens_details && usage.input_tokens_details.cached_tokens) || 0;
    job.usage.output += usage.output_tokens || 0;
    job.usage.calls += 1;
  }
  function noteRetry(job, run, err) {
    if (err.status !== 429) return;
    run.rateHits++;
    if (run.rateHits >= 2 && !run.halved) {
      run.halved = true;
      run.sem.max = Math.max(1, Math.floor(run.sem.max / 2));
      toast(MSG.reduceConcurrency);
    }
  }
  function handleCallError(run, err) {
    const job = state.jobs[run.jobId];
    const plan = !!(job && job.planMode);
    if (err.status === 401 || (plan && err.code === 'subscription_sharing_invalid_user')) { handleAuthFailure(); return; }
    if (plan) {
      if (err.code === 'subscription_sharing_usage_limit_exceeded') {
        job.limitHit = true;
        if (!run.abort.signal.aborted) { run.abort.abort(ABORT_PLAN_LIMIT); renderProgress(job); toast(MSG.cgLimit, 'error'); }
        return;
      }
      if (err.code === 'model_unsupported') {
        job.modelRejected = true;
        if (!run.abort.signal.aborted) { run.abort.abort(ABORT_PLAN_MODEL); toast(MSG.cgModelUnsupported, 'error'); }
        return;
      }
      if (err.code === 'subscription_sharing_user_not_eligible') {
        if (!run.abort.signal.aborted) run.abort.abort(ABORT_PLAN_INELIGIBLE);
        openGate(MSG.cgIneligible);
        return;
      }
    }
    if (err.code === 'insufficient_quota' && !run.abort.signal.aborted) { run.abort.abort(ABORT_QUOTA); toast(MSG.quota, 'error'); }
  }
  function handleAuthFailure() {
    if (state.authFailing) return;
    state.authFailing = true;
    const run = state.run;
    if (run) { run.cancelled = true; run.abort.abort(ABORT_AUTH); }
    if (isPlan()) {
      clearPlanSession({ dropReg: false });
      openGate(MSG.cgExpired);
    } else {
      state.apiKey = '';
      ls.remove(LS.apiKey);
      openGate(MSG.keyInvalidated);
    }
    setTimeout(() => { state.authFailing = false; }, 1000);
  }
  async function persist(job) {
    const ok = await store.saveJob(job);
    if (ok) updateHistory(job);
    return ok;
  }
  function historyEntry(job) {
    const m = (job.outline && job.outline.meta) || {};
    return {
      id: job.id, title_ko: m.title_ko || '', title_en: m.title_en || '', authors: m.authors || [], venue: m.venue || '', year: m.year || null,
      source: { type: job.source.type, url: job.source.landingUrl || job.source.pdfUrl || '', fileName: job.source.fileName || '' },
      model: job.model, state: job.state, createdAt: job.createdAt, chunkCount: job.chunks.length,
      bytes: job.chunks.reduce((n, c) => n + (c.text ? c.text.length * 2 : 0), 0)
    };
  }
  function updateHistory(job) {
    const list = store.loadHistory().filter((h) => h.id !== job.id);
    list.unshift(historyEntry(job));
    for (const h of list.slice(HISTORY_MAX)) { store.deleteJob(h.id); releaseJob(h.id); }
    store.saveHistory(list);
    renderHistory();
  }

  function startJob(source, file) {
    const s = state.settings;
    const job = {
      id: uid(), createdAt: Date.now(), startedAt: Date.now(), finishedAt: null,
      source, model: currentModel(), effort: s.effort, concurrency: s.concurrency,
      includeAppendix: $('include-appendix').checked, planMode: isPlan(),
      state: 'outlining', error: null, outline: null, glossaryStr: '', chunks: [],
      summaryStatus: 'pending', summary: null, summaryError: null,
      ideasStatus: 'pending', ideas: null, ideasError: null,
      usage: { input: 0, cached: 0, output: 0, calls: 0 }, cacheKey: '', pageHint: 0
    };
    job.modelLabel = modelLabel(job.model);
    state.jobs[job.id] = job;
    const run = newRun(job);
    if (file) { fileCache.set(job.id, file); job.source.blobUrl = URL.createObjectURL(file); }
    location.hash = `#result/${job.id}`;
    track(job, run, runMain(job, run, file));
  }
  async function runMain(job, run, file) {
    try {
      if (file) {
        job.pageHint = await countPdfPages(file);
        if (job.pageHint > 100) toast('100쪽이 넘는 PDF입니다. 처리 시간과 비용이 클 수 있습니다.');
        if (job.planMode) job.source.fileData = await readFileDataUrl(file);
        else job.source.fileId = await uploadFile(file, run.abort.signal);
      }
      job.cacheKey = `paper:${job.source.arxivId || job.source.fileId || hashStr(job.source.pdfUrl || job.source.fileName || '')}`;
      await runOutline(job, run);
      job.state = 'running';
      renderJob(job);
      persist(job);
      track(job, run, runSummary(job, run));
      track(job, run, runIdeas(job, run));
      for (const chunk of queueOrder(job.chunks)) if (chunk.status === 'pending') track(job, run, runChunk(job, run, chunk));
    } catch (err) {
      if (isAbort(err)) { run.cancelled = err.reason !== ABORT_QUOTA; job.state = 'cancelled'; }
      else { job.state = 'failed'; handleCallError(run, err); }
      job.error = { code: errorCode(err), message: errorMessage(err) };
      renderSummary(job);
      renderIdeas(job);
      renderProgress(job);
      renderHeader(job);
    }
  }
  async function runOutline(job, run) {
    const signal = run.abort.signal;
    const r = await withRetry((o) => runAttempt(buildBody(job, 'outline', {
      perCall: P.OUTLINE_PROMPT, format: OUTLINE_FORMAT, verbosity: 'low', effort: abEffort(job), maxTokens: MAX_TOKENS.outline, stream: true, stripParams: o.stripParams, strips: o.strips
    }), { parentSignal: signal, initialWatchdogMs: REASONING_WATCHDOG_MS }), { signal, plan: job.planMode, onRetry: (e) => noteRetry(job, run, e) });
    addUsage(job, r.usage);
    if (r.truncated) throw new ApiError('논문 구조 결과가 출력 한도에 걸려 잘렸습니다. 추론 강도를 낮추거나 다른 모델로 시도해 주세요.', { status: 0, code: 'truncated' });
    const raw = parseStructured(job, r.text);
    if (raw == null) throw new ApiError('논문 구조 결과를 해석하지 못했습니다. 다시 시도해 주세요.', { status: 0, code: 'parse' });
    applyOutline(job, typeof raw === 'object' ? raw : {});
  }
  function applyOutline(job, raw) {
    const meta = raw.meta && typeof raw.meta === 'object' ? raw.meta : {};
    const str = (x) => (typeof x === 'string' ? x.trim() : '');
    const strList = (x) => (Array.isArray(x) ? x.filter((v) => typeof v === 'string' && v.trim()).map((v) => v.trim()) : []);
    const norm = normalizeOutline(raw.outline, raw.total_pages, job.pageHint);
    const glos = mergeGlossary(raw.glossary);
    job.outline = {
      meta: { title_en: str(meta.title_en), title_ko: str(meta.title_ko), authors: strList(meta.authors), venue: str(meta.venue), year: Number.isFinite(+meta.year) && meta.year ? +meta.year : null, arxiv_id: str(meta.arxiv_id), abstract_ko: str(meta.abstract_ko), keywords_ko: strList(meta.keywords_ko) },
      total_pages: norm.totalPages, glossary: glos.list, fallback: norm.fallback
    };
    job.glossaryStr = P.renderGlossary(glos.list);
    job.chunks = buildChunksFromSections(norm.sections, norm.totalPages, { abstractKo: job.outline.meta.abstract_ko, includeAppendix: job.includeAppendix, fallback: norm.fallback });
    if (norm.fallback && norm.totalPages) toast('섹션 구조를 확인하지 못해 4페이지 단위로 번역합니다.');
    if (glos.paperCount < 10) toast('논문 용어집이 적어 기본 용어집을 함께 사용합니다.');
  }
  function ensureUploaded(job, run) {
    if (job.source.type !== 'file') return Promise.resolve();
    if (job.planMode) {
      if (job.source.fileData) return Promise.resolve();
      if (!run.uploadPromise) {
        run.uploadPromise = (async () => {
          const f = fileCache.get(job.id);
          if (!f) throw new ApiError(MSG.fileExpired, { status: 0, code: 'file_expired' });
          job.source.fileData = await readFileDataUrl(f);
        })();
      }
      return run.uploadPromise;
    }
    if (job.source.fileId && !job.source.fileDeleted) return Promise.resolve();
    if (!run.uploadPromise) {
      run.uploadPromise = (async () => {
        const f = fileCache.get(job.id);
        if (!f) throw new ApiError(MSG.fileExpired, { status: 0, code: 'file_expired' });
        job.source.fileId = await uploadFile(f, run.abort.signal);
        job.source.fileDeleted = false;
      })();
    }
    return run.uploadPromise;
  }
  async function structuredCall(job, run, task, o) {
    const signal = run.abort.signal;
    const makeBody = (r, low) => buildBody(job, task, {
      perCall: o.perCall, glossaryStr: job.glossaryStr, stream: true, format: o.format,
      verbosity: low ? 'low' : 'medium', effort: low ? 'low' : abEffort(job), maxTokens: o.maxTokens, stripParams: r.stripParams, strips: r.strips
    });
    const retryOpts = { signal, plan: job.planMode, onRetry: (e) => noteRetry(job, run, e) };
    const attempt = (low) => withRetry((r) => runAttempt(makeBody(r, low), { parentSignal: signal, initialWatchdogMs: REASONING_WATCHDOG_MS }), retryOpts);
    await ensureUploaded(job, run);
    let r = await attempt(false);
    addUsage(job, r.usage);
    if (r.truncated && r.reason === 'max_output_tokens') {
      r = await attempt(true);
      addUsage(job, r.usage);
    }
    if (r.truncated) throw new ApiError(o.truncatedMsg, { status: 0, code: 'truncated' });
    return parseStructured(job, r.text);
  }
  async function runSummary(job, run) {
    job.summaryStatus = 'running';
    job.summaryError = null;
    renderSummary(job);
    renderProgress(job);
    try {
      const parsed = await structuredCall(job, run, 'summary', { perCall: P.buildSummaryPrompt(job.glossaryStr), format: SUMMARY_FORMAT, maxTokens: MAX_TOKENS.summary, truncatedMsg: MSG.summaryTruncated });
      if (!parsed || typeof parsed !== 'object') throw new ApiError(MSG.summaryParse, { status: 0, code: 'parse' });
      job.summary = parsed;
      job.summaryStatus = 'done';
    } catch (err) {
      job.summaryStatus = 'failed';
      job.summaryError = errorMessage(err);
      handleCallError(run, err);
    }
    renderSummary(job);
    renderProgress(job);
    renderHeader(job);
    persist(job);
  }
  async function runIdeas(job, run) {
    job.ideasStatus = 'running';
    job.ideasError = null;
    renderIdeas(job);
    renderProgress(job);
    try {
      const parsed = await structuredCall(job, run, 'ideas', { perCall: P.buildIdeasPrompt(), format: IDEAS_FORMAT, maxTokens: MAX_TOKENS.ideas, truncatedMsg: MSG.ideasTruncated });
      if (!ideasView(parsed).ideas.length) throw new ApiError(MSG.ideasParse, { status: 0, code: 'parse' });
      job.ideas = parsed;
      job.ideasStatus = 'done';
    } catch (err) {
      job.ideasStatus = 'failed';
      job.ideasError = errorMessage(err);
      handleCallError(run, err);
    }
    renderIdeas(job);
    renderProgress(job);
    renderHeader(job);
    persist(job);
  }
  async function translateRange(job, run, chunk, from, to, base, maxTokens) {
    const sub = { ...chunk, startPage: from, endPage: to };
    if (from !== chunk.startPage) {
      sub.prev = '같은 섹션의 이전 페이지 조각';
      if (chunk.partCount === 1) { sub.partIndex = 2; sub.partCount = 2; }
    }
    const perCall = P.buildTranslationPrompt(sub, job.glossaryStr);
    const r = await withRetry((o) => {
      const myId = ++chunk.attemptId;
      chunk.attempts++;
      chunk.text = base;
      const body = buildBody(job, 'translate', { chunkId: chunk.id, perCall, glossaryStr: job.glossaryStr, stream: true, effort: 'none', maxTokens, stripParams: o.stripParams, strips: o.strips });
      return runAttempt(body, {
        parentSignal: run.abort.signal,
        onController: (ctl) => run.chunkCtl.set(chunk.id, ctl),
        onDelta: (full) => {
          if (chunk.attemptId !== myId) return;
          chunk.text = base + full;
          scheduleRender(job, chunk);
        }
      });
    }, { signal: run.abort.signal, plan: job.planMode, onRetry: (e) => { chunk.status = 'retrying'; chunk.errorCode = errorCode(e); renderChunkStatus(job, chunk); noteRetry(job, run, e); } });
    addUsage(job, r.usage);
    return r;
  }
  function continuationPiece(base, text) {
    const lines = String(text || '').replace(/\r\n/g, '\n').trim().split('\n');
    if (/^#{1,6}\s/.test(lines[0] || '')) lines.shift();
    return dropOverlap(base, lines.join('\n').trim());
  }
  async function translateWhole(job, run, chunk) {
    let base = '';
    let from = chunk.startPage;
    const to = chunk.endPage;
    let bigRetried = false;
    for (;;) {
      const maxTokens = bigRetried && from >= to ? MAX_TOKENS.translateRetry : MAX_TOKENS.translate;
      const r = await translateRange(job, run, chunk, from, to, base, maxTokens);
      const piece = from === chunk.startPage ? r.text : continuationPiece(base, r.text);
      const stoppedOtherwise = r.truncated && r.reason && r.reason !== 'max_output_tokens';
      if (!r.truncated || stoppedOtherwise) {
        base += piece;
        if (stoppedOtherwise) { chunk.truncated = true; chunk.truncatedFinal = true; chunk.truncReason = r.reason; }
        break;
      }
      chunk.truncated = true;
      if (from >= to) {
        if (bigRetried || job.planMode) { base += piece; chunk.truncatedFinal = true; break; }
        bigRetried = true;
        continue;
      }
      base = `${(base + piece).trimEnd()}\n\n`;
      from = Math.floor((from + to) / 2) + 1;
    }
    return base;
  }
  async function runChunk(job, run, chunk) {
    const myRun = chunk.runSeq = (chunk.runSeq || 0) + 1;
    const stale = () => chunk.runSeq !== myRun;
    const signal = run.abort.signal;
    const prevCtl = run.chunkCtl.get(chunk.id);
    if (prevCtl) prevCtl.abort(ABORT_USER);
    const prevText = chunk.status === 'done' ? chunk.text : '';
    chunk.status = chunk.attempts > 0 ? 'retrying' : 'pending';
    chunk.error = null; chunk.errorCode = ''; chunk.truncated = false; chunk.truncatedFinal = false; chunk.truncReason = ''; chunk.cutAtNext = false; chunk.dirty = false;
    renderState.delete(chunk.id);
    renderChunkStatus(job, chunk);
    renderProgress(job);
    await run.sem.acquire();
    try {
      if (stale()) return;
      if (signal.aborted) { chunk.status = 'pending'; renderChunkStatus(job, chunk); return; }
      chunk.status = chunk.attempts > 0 ? 'retrying' : 'running';
      chunk.text = '';
      renderChunkStatus(job, chunk);
      await ensureUploaded(job, run);
      let text = cleanupChunkText(await translateWhole(job, run, chunk), chunk);
      if (stale()) return;
      if (chunk.kind === 'body' && text.length < 150 && !chunk.shortRetried) {
        chunk.shortRetried = true;
        text = cleanupChunkText(await translateWhole(job, run, chunk), chunk);
        if (stale()) return;
      }
      chunk.text = text;
      chunk.status = 'done';
      finalizeChunkText(job, chunk);
    } catch (err) {
      if (stale()) return;
      chunk.status = 'failed';
      chunk.error = errorMessage(err);
      chunk.errorCode = errorCode(err);
      if (prevText) chunk.text = prevText;
      handleCallError(run, err);
    } finally {
      run.sem.release();
      if (!stale()) run.chunkCtl.delete(chunk.id);
    }
    renderChunkFinal(job, chunk);
    renderProgress(job);
    renderToc(job);
    persist(job);
  }
  function finalizeChunkText(job, chunk) {
    if (chunk.partCount <= 1) return;
    const sib = (idx) => job.chunks.find((c) => c.sectionKey === chunk.sectionKey && c.partCount === chunk.partCount && c.partIndex === idx);
    const prev = sib(chunk.partIndex - 1);
    if (prev && prev.status === 'done') chunk.text = dropOverlap(prev.text, chunk.text);
    const next = sib(chunk.partIndex + 1);
    if (next && next.status === 'done') { next.text = dropOverlap(chunk.text, next.text); renderChunkFinal(job, next); }
  }
  async function finalizeJob(job, run) {
    if (run.finalized) return;
    run.finalized = true;
    if (state.run === run) state.run = null;
    const active = job.chunks.filter((c) => c.status !== 'skipped');
    const failed = active.filter((c) => c.status === 'failed');
    const abortText = abortMessage(run.abort.signal.reason);
    for (const c of job.chunks) if (c.status === 'running' || c.status === 'retrying') { c.status = 'failed'; c.error = abortText; c.errorCode = '중단'; }
    if (job.state !== 'failed' && job.state !== 'cancelled') {
      if (run.cancelled) job.state = 'cancelled';
      else if (failed.length || job.summaryStatus === 'failed' || job.ideasStatus === 'failed') job.state = failed.length === active.length && job.summaryStatus !== 'done' && job.ideasStatus !== 'done' ? 'failed' : 'partial';
      else job.state = 'done';
    }
    job.finishedAt = Date.now();
    for (const c of job.chunks) renderChunkStatus(job, c);
    renderProgress(job);
    renderHeader(job);
    renderToc(job);
    renderIdeas(currentJob());
    await persist(job);
    if (job.source.type === 'file' && !job.planMode && job.source.fileId && !job.source.fileDeleted && job.state === 'done') {
      deleteFile(job.source.fileId);
      job.source.fileDeleted = true;
      persist(job);
    }
  }
  function cancelJob(job) {
    const run = state.run;
    if (!job || !run || run.jobId !== job.id) return;
    run.cancelled = true;
    run.abort.abort(ABORT_USER);
    toast('분석을 중단했습니다');
  }
  // Re-picks model and file input when the sign-in mode has changed.
  function reconcileJobMode(job) {
    const plan = isPlan();
    const switched = !!job.planMode !== plan;
    if (switched) {
      job.planMode = plan;
      job.cacheKey = '';
      if (job.source.type === 'file') { job.source.fileData = ''; job.source.fileId = ''; job.source.fileDeleted = false; }
    }
    if (switched || job.modelRejected) { job.model = currentModel(); job.modelLabel = modelLabel(job.model); job.modelRejected = false; }
  }
  function ensureRun(job) {
    if (state.run) {
      if (state.run.jobId === job.id) return state.run;
      toast(MSG.busy, 'error');
      return null;
    }
    if (!hasActiveAuth()) { openGate(); return null; }
    reconcileJobMode(job);
    if (job.source.type === 'file' && job.planMode && !job.source.fileData && !fileCache.has(job.id)) { toast(MSG.fileExpired, 'error'); return null; }
    if (job.source.type === 'file' && !job.planMode && (!job.source.fileId || job.source.fileDeleted) && !fileCache.has(job.id)) { toast(MSG.fileExpired, 'error'); return null; }
    if (!job.cacheKey) job.cacheKey = `paper:${job.source.arxivId || job.source.fileId || hashStr(job.source.pdfUrl || job.source.fileName || '')}`;
    job.limitHit = false;
    const run = newRun(job);
    job.state = 'running';
    job.finishedAt = null;
    for (const c of job.chunks) renderChunkStatus(job, c);
    renderProgress(job);
    renderHeader(job);
    renderIdeas(job);
    return run;
  }
  function retryChunk(job, chunk) {
    const run = ensureRun(job);
    if (!run) return;
    chunk.optional = false;
    chunk.shortRetried = false;
    track(job, run, runChunk(job, run, chunk));
  }
  function retryFailed(job) {
    const idle = !(state.run && state.run.jobId === job.id);
    const targets = queueOrder(job.chunks).filter((c) => c.status === 'failed' || (idle && c.status === 'pending'));
    const summaryFailed = job.summaryStatus === 'failed';
    const ideasFailed = job.ideasStatus === 'failed';
    if (!targets.length && !summaryFailed && !ideasFailed) return;
    const run = ensureRun(job);
    if (!run) return;
    for (const c of targets) { c.shortRetried = false; track(job, run, runChunk(job, run, c)); }
    if (summaryFailed) track(job, run, runSummary(job, run));
    if (ideasFailed) track(job, run, runIdeas(job, run));
  }
  function regenerateSummary(job) {
    const run = ensureRun(job);
    if (!run) return;
    track(job, run, runSummary(job, run));
  }
  function regenerateIdeas(job) {
    if (job.ideasStatus === 'running') return;
    const run = ensureRun(job);
    if (!run) return;
    track(job, run, runIdeas(job, run));
  }
  function reviveJob(job) {
    job.chunks = Array.isArray(job.chunks) ? job.chunks : [];
    job.usage = job.usage || { input: 0, cached: 0, output: 0, calls: 0 };
    job.source = job.source || { type: 'url' };
    job.planMode = !!job.planMode;
    if (job.state === 'outlining' || job.state === 'running') {
      for (const c of job.chunks) if (c.status === 'running' || c.status === 'retrying') { c.status = 'failed'; c.error = MSG.reloadAbort; c.errorCode = '중단'; }
      if (job.summaryStatus === 'running' || job.summaryStatus === 'pending') { job.summaryStatus = 'failed'; job.summaryError = MSG.reloadAbort; }
      if (job.ideasStatus === 'running' || job.ideasStatus === 'pending') { job.ideasStatus = 'failed'; job.ideasError = MSG.reloadAbort; }
      job.state = job.outline ? 'partial' : 'failed';
      if (!job.outline) job.error = { code: '중단', message: MSG.reloadAbort };
    }
    return job;
  }

  function renderJob(job) {
    if (state.currentJobId !== job.id) return;
    $('progress-strip').dataset.userExpanded = '';
    renderHeader(job);
    renderProgress(job);
    renderSummary(job);
    renderTranslation(job);
    renderIdeas(job);
    renderSourcePanel(job);
  }
  function renderHeader(job) {
    if (state.currentJobId !== job.id) return;
    const meta = (job.outline && job.outline.meta) || {};
    const fallbackTitle = job.state === 'outlining' ? '논문 구조를 파악하는 중…' : (job.state === 'failed' && !job.outline ? '분석 실패' : '제목 없음');
    $('paper-title').textContent = meta.title_ko || meta.title_en || fallbackTitle;
    const link = $('source-link');
    const href = job.source.type === 'file' ? (job.source.blobUrl || '') : (job.source.landingUrl || job.source.pdfUrl || '');
    link.textContent = job.source.type === 'file' ? (job.source.fileName || '업로드한 PDF') : href;
    if (href) link.href = href; else link.removeAttribute('href');
    const u = job.usage;
    const label = job.modelLabel || modelLabel(job.model) || job.model;
    const parts = [label, `추론 ${EFFORT_LABELS[job.effort] || job.effort}`, `토큰 입력 ${fmtK(u.input)}K / 출력 ${fmtK(u.output)}K`];
    const metaEl = clear($('result-meta'));
    if (job.planMode) {
      metaEl.append(el('span', { text: parts.join(' · ') + ' ·' }),
        el('span', { id: 'plan-chip', class: 'plan-chip', text: 'ChatGPT 플랜 사용 중' }),
        el('a', { id: 'plan-usage-link', class: 'ext', href: USAGE_URL, target: '_blank', rel: 'noopener', text: '사용량 관리' }));
    } else {
      const cost = estimateCost(job);
      const costText = cost == null ? '-' : `$${cost.toFixed(cost < 0.1 ? 4 : 2)}`;
      metaEl.textContent = [...parts, `예상 비용 ${costText}`].join(' · ');
    }
  }
  function chunkCounts(job) {
    const active = job.chunks.filter((c) => c.status !== 'skipped');
    return {
      active,
      done: active.filter((c) => c.status === 'done').length,
      failed: active.filter((c) => c.status === 'failed').length,
      pending: active.filter((c) => c.status === 'pending').length,
      busy: active.some((c) => c.status === 'running' || c.status === 'retrying')
    };
  }
  function renderProgress(job) {
    if (state.currentJobId !== job.id) return;
    const strip = $('progress-strip');
    const running = job.state === 'outlining' || job.state === 'running';
    const n = chunkCounts(job);
    strip.dataset.state = job.state === 'running' ? (n.busy || n.done < n.active.length ? 'translating' : 'summarizing') : job.state;
    const stageState = {
      outline: job.outline ? 'done' : (job.state === 'outlining' ? 'active' : (job.state === 'failed' || job.state === 'cancelled' ? 'failed' : 'pending')),
      summary: { done: 'done', running: 'active', failed: 'failed' }[job.summaryStatus] || 'pending',
      translate: !job.outline ? 'pending' : n.busy ? 'active' : (n.active.length && n.done === n.active.length) ? 'done' : n.failed ? 'failed' : (job.state === 'running' ? 'active' : 'pending')
    };
    for (const li of $('stage-rail').children) li.dataset.state = stageState[li.dataset.stage] || 'pending';
    const bar = $('progress-bar');
    bar.dataset.indeterminate = job.state === 'outlining' ? '1' : '0';
    const ideasUnit = job.ideasStatus === undefined ? 0 : 1;
    const doneUnits = n.done + (job.summaryStatus === 'done' ? 1 : 0) + (job.ideasStatus === 'done' ? 1 : 0);
    const pct = job.outline ? Math.round((doneUnits / (n.active.length + 1 + ideasUnit)) * 100) : 0;
    $('progress-fill').style.width = `${pct}%`;
    if (bar.dataset.indeterminate === '1') { bar.removeAttribute('aria-valuenow'); bar.setAttribute('aria-valuetext', '논문 구조를 파악하는 중'); }
    else { bar.removeAttribute('aria-valuetext'); bar.setAttribute('aria-valuenow', String(pct)); }
    let text;
    if (job.state === 'outlining') text = '논문 구조를 파악하는 중…';
    else if (job.state === 'running') text = n.busy || n.done < n.active.length ? `번역 중 · ${n.done}/${n.active.length} 섹션 완료` : finishingText(job);
    else if (job.state === 'done') text = `완료 · ${n.active.length}개 섹션 · ${fmtDuration((job.finishedAt || Date.now()) - (job.startedAt || job.createdAt))}`;
    else if (job.state === 'partial') text = '일부 실패 · 실패한 섹션을 다시 시도해 주세요';
    else if (job.state === 'cancelled') text = '중단됨 · 완료된 섹션은 저장되었습니다';
    else text = `실패 · ${(job.error && job.error.message) || ''}`;
    $('progress-text').textContent = text;
    renderChips(job);
    $('limit-card').hidden = !job.limitHit;
    $('btn-cancel').hidden = !running;
    $('btn-retry-all').hidden = running || !(n.failed || n.pending || job.summaryStatus === 'failed' || job.ideasStatus === 'failed');
    $('btn-retry-failed').hidden = running || !(n.failed || n.pending);
    $('btn-summary-retry').disabled = running;
    const toggle = $('btn-progress-toggle');
    if (running) { strip.dataset.collapsed = '0'; toggle.hidden = true; }
    else { toggle.hidden = false; strip.dataset.collapsed = strip.dataset.userExpanded === '1' ? '0' : '1'; }
    toggle.textContent = strip.dataset.collapsed === '1' ? '자세히' : '접기';
  }
  function finishingText(job) {
    const summary = job.summaryStatus === 'running' || job.summaryStatus === 'pending';
    const ideas = job.ideasStatus === 'running' || job.ideasStatus === 'pending';
    if (summary && ideas) return '요약과 주제 제안을 만드는 중…';
    return ideas ? '주제 제안을 만드는 중…' : '요약을 만드는 중…';
  }
  function shortTitle(c) {
    const first = c.sections[0];
    const t = first ? (first.titleKo || first.titleEn) : `${c.startPage}–${c.endPage}p`;
    const part = c.partCount > 1 ? ` (${c.partIndex}/${c.partCount})` : '';
    return (t.length > 14 ? `${t.slice(0, 13)}…` : t) + part;
  }
  function cardTitle(c) {
    if (!c.sections.length) return `${c.startPage}–${c.endPage} 페이지`;
    return `§${c.titleKo}${c.partCount > 1 ? ` (${c.partIndex}/${c.partCount})` : ''}`;
  }
  function chipTooltip(c) {
    if (c.status === 'failed') return `${c.errorCode ? `${c.errorCode} · ` : ''}${c.error || ''}`;
    if (c.status === 'retrying') return `${c.errorCode ? `${c.errorCode} · ` : ''}재시도 중`;
    return '';
  }
  function renderChips(job) {
    const row = $('section-chips');
    if (row.dataset.job !== job.id || row.children.length !== job.chunks.length) {
      clear(row);
      row.dataset.job = job.id;
      for (const c of job.chunks) {
        row.append(el('button', { type: 'button', class: 'status-chip', dataset: { section: c.id }, onclick: () => scrollToChunk(job, c) }, el('span', { class: 'lbl' })));
      }
    }
    job.chunks.forEach((c, i) => {
      const b = row.children[i];
      b.dataset.status = c.status;
      b.querySelector('.lbl').textContent = `${c.sectionNumber ? `§${c.sectionNumber} ` : ''}${shortTitle(c)} · ${CHIP_LABELS[c.status] || c.status}`;
      b.title = chipTooltip(c);
    });
  }
  function scrollToChunk(job, c) {
    selectTab('translation');
    const card = cardEl(c.id);
    if (card) scrollToNode(card);
  }
  function stickyOffset() {
    const bar = document.querySelector('.topbar');
    let h = bar ? bar.offsetHeight : 56;
    const strip = $('progress-strip');
    if (strip && !$('view-result').hidden && getComputedStyle(strip).position === 'sticky') h += strip.offsetHeight;
    return h;
  }
  function readingLine() { return stickyOffset() + SCROLL_GAP + 8; }
  function scrollToNode(node) {
    const seq = ++scrollSeq;
    const target = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      return clamp(Math.round(node.getBoundingClientRect().top + window.scrollY - stickyOffset() - SCROLL_GAP), 0, Math.max(0, max));
    };
    const smooth = !reducedMotion();
    window.scrollTo({ top: target(), behavior: smooth ? 'smooth' : 'auto' });
    const done = new AbortController();
    const settle = () => {
      if (done.signal.aborted) return;
      done.abort();
      if (seq !== scrollSeq) return;
      const t = target();
      if (Math.abs(window.scrollY - t) > 2) window.scrollTo({ top: t, behavior: 'auto' });
    };
    if (!smooth) { requestAnimationFrame(settle); return; }
    const opts = { signal: done.signal, passive: true };
    window.addEventListener('scrollend', settle, opts);
    for (const type of ['wheel', 'touchstart', 'keydown']) window.addEventListener(type, () => done.abort(), opts);
    setTimeout(settle, 1500);
  }

  function toView(s) {
    const str = (x) => (typeof x === 'string' ? x : '');
    const md = (x) => normalizeListIndent(str(x));
    const arr = (x) => (Array.isArray(x) ? x : []);
    const strs = (x) => arr(x).filter((v) => typeof v === 'string' && v.trim());
    const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
    const sections = s.sections && typeof s.sections === 'object' ? s.sections : {};
    const glance = s.glance && typeof s.glance === 'object' ? s.glance : {};
    const lim = s.limitations && typeof s.limitations === 'object' ? s.limitations : {};
    const scores = {};
    for (const [k] of RADAR_AXES) {
      const v = s.scores && s.scores[k];
      const n = v && Number.isFinite(+v.score) ? clamp(Math.round(+v.score), 1, 5) : null;
      scores[k] = { score: n, rationale: v ? str(v.rationale) : '' };
    }
    return {
      tldr: str(s.tldr_ko),
      glance: { problem: str(glance.problem), method: str(glance.method), result: str(glance.result) },
      sections: {
        problem_definition: md(sections.problem_definition), proposed_method: md(sections.proposed_method), results_and_strengths: md(sections.results_and_strengths),
        weaknesses_and_limitations: md(sections.weaknesses_and_limitations), core_technology: md(sections.core_technology)
      },
      strengths: strs(s.strengths),
      limitations: [...strs(lim.weaknesses), ...strs(lim.stated_limitations)],
      futureWork: strs(lim.future_work),
      pipeline: arr(s.pipeline).filter((p) => p && typeof p.stage === 'string' && p.stage.trim()).map((p) => ({ name: p.stage.trim(), desc: str(p.description), input: str(p.input), output: str(p.output) })),
      metrics: arr(s.metrics).filter((m) => m && typeof m.metric === 'string').map((m) => ({
        name: m.metric, dataset: str(m.dataset), unit: str(m.unit), ours: num(m.proposed_value), baseline: num(m.baseline_value),
        baselineName: str(m.baseline_name), higherIsBetter: m.higher_is_better !== false, source: str(m.source), note: str(m.note)
      })),
      scores,
      hasScores: Object.values(scores).some((v) => v.score != null),
      coreTech: arr(s.core_tech).filter((t) => t && typeof t.name === 'string').map((t) => ({ name: t.name, category: TECH_CATS[t.category] ? t.category : 'other', role: str(t.role), desc: str(t.description) })),
      meta: s.meta && typeof s.meta === 'object' ? s.meta : {}
    };
  }
  function isEnglish(text) { return !!String(text || '').trim() && !/[\u3131-\u318e\uac00-\ud7a3]/.test(text); }
  function setLang(node, text) { if (isEnglish(text)) node.lang = 'en'; else node.removeAttribute('lang'); }
  function renderAuthors(target, authors) {
    clear(target);
    if (!authors.length) return;
    if (authors.length <= 6) { target.textContent = authors.join(', '); return; }
    const shown = el('span', { text: authors.slice(0, 6).join(', ') });
    const btn = el('button', { type: 'button', text: `외 ${authors.length - 6}명` });
    btn.addEventListener('click', () => { shown.textContent = authors.join(', '); btn.remove(); });
    target.append(shown, ' ', btn);
  }
  function renderSummary(job) {
    if (state.currentJobId !== job.id) return;
    const meta = (job.outline && job.outline.meta) || {};
    const view = job.summary ? toView(job.summary) : null;
    $('summary-title-ko').textContent = meta.title_ko || (view && view.meta.title_ko) || (job.outline ? '제목 없음' : (job.state === 'outlining' ? '논문 구조를 파악하는 중…' : (job.state === 'cancelled' ? '중단됨' : '분석 실패')));
    $('summary-title-en').textContent = meta.title_en || '';
    renderAuthors($('summary-authors'), meta.authors || []);
    const venue = [meta.venue, meta.year].filter(Boolean).join(' · ');
    $('summary-venue').textContent = venue;
    $('summary-venue').hidden = !venue;
    $('summary-tldr').textContent = view ? view.tldr : (job.summaryStatus === 'running' || job.state === 'outlining' ? '요약을 만드는 중…' : '-');
    const kw = clear($('summary-keywords'));
    for (const k of (meta.keywords_ko || []).slice(0, 8)) kw.append(el('li', { class: 'chip', text: k }));
    const st = $('summary-status');
    st.hidden = job.summaryStatus !== 'failed';
    if (job.summaryStatus === 'failed') $('summary-status-text').textContent = `요약을 만들지 못했습니다. ${job.summaryError || ''}`;
    const running = job.state === 'outlining' || job.state === 'running';
    $('panel-summary').dataset.summary = job.summaryStatus === 'pending' && !running ? 'failed' : job.summaryStatus;
    for (const k of ['problem', 'method', 'result']) $(`glance-${k}`).textContent = view ? view.glance[k] : '';
    const dim = job.summaryStatus === 'running' && !!view;
    const mdKeys = { problem: 'problem_definition', method: 'proposed_method', results: 'results_and_strengths', limits: 'weaknesses_and_limitations', tech: 'core_technology' };
    for (const [id, key] of Object.entries(mdKeys)) {
      const target = $(`md-${id}`);
      target.classList.toggle('dim', dim);
      if (view) mountMarkdown(target, view.sections[key]); else clear(target);
    }
    setLang($('md-tech'), view ? view.sections.core_technology : '');
    if (view) {
      renderPipeline(view);
      renderMetrics(view);
      renderRadar(view);
      renderProsCons(view);
      renderTech(view);
      for (const id of VIZ_IDS) $(id).classList.toggle('dim', dim);
    } else if (job.summaryStatus === 'running' || (job.summaryStatus === 'pending' && running)) {
      renderSkeletons();
    } else {
      renderEmptyVisuals();
    }
  }
  const VIZ_IDS = ['viz-pipeline', 'viz-metrics', 'viz-radar', 'viz-proscons', 'viz-tech'];
  function renderSkeletons() {
    const heights = { 'viz-pipeline': 72, 'viz-metrics': 200, 'viz-radar': 280, 'viz-proscons': 160, 'viz-tech': 96 };
    destroyRadar();
    $('pros-anchor').hidden = true;
    for (const id of VIZ_IDS) {
      const fig = clear($(id));
      fig.hidden = false;
      fig.classList.remove('dim');
      const sk = el('div', { class: 'skeleton', 'aria-hidden': 'true' });
      sk.style.height = `${heights[id]}px`;
      fig.append(el('figcaption', { text: '요약을 만드는 중…' }), sk);
    }
  }
  function renderEmptyVisuals() {
    destroyRadar();
    $('pros-anchor').hidden = true;
    for (const id of VIZ_IDS) {
      const fig = clear($(id));
      fig.hidden = false;
      fig.classList.remove('dim');
      fig.append(el('figcaption', { text: '시각화' }), el('p', { class: 'viz-empty', text: '요약이 생성되지 않아 시각화를 표시할 수 없습니다.' }));
    }
  }
  function tableToggle(fig) {
    const btn = el('button', { type: 'button', class: 'btn-ghost btn-sm viz-table-toggle', text: '표로 보기', 'aria-pressed': 'false' });
    btn.addEventListener('click', () => {
      const on = btn.getAttribute('aria-pressed') !== 'true';
      btn.setAttribute('aria-pressed', String(on));
      btn.textContent = on ? '그림으로 보기' : '표로 보기';
      for (const child of fig.children) {
        if (child.tagName === 'FIGCAPTION') continue;
        child.hidden = child.classList.contains('table-twin') ? !on : on;
      }
    });
    return btn;
  }
  function renderPipeline(view) {
    const fig = clear($('viz-pipeline'));
    fig.hidden = false;
    const steps = view.pipeline;
    const caption = el('figcaption', {}, el('strong', { text: '제안 기법 처리 흐름' }));
    fig.append(caption);
    if (steps.length < 3) { fig.append(el('p', { class: 'viz-empty', text: '단계별 파이프라인을 추출하지 못했습니다.' })); return; }
    caption.append(tableToggle(fig));
    const ol = el('ol', { class: 'pipeline', dataset: { n: String(steps.length) } });
    const descList = el('ol', { class: 'pipe-desc' });
    const details = el('details', { class: 'pipe-desc-wrap', open: narrowScreen() }, el('summary', { text: '단계 설명 보기' }), descList);
    steps.forEach((s, i) => {
      const label = `${i + 1}단계 ${s.name}: ${s.desc}`;
      const li = el('li', { class: 'pipe-step' });
      const fill = el('button', { type: 'button', class: 'pipe-fill', title: label, 'aria-label': label }, el('span', { class: 'pipe-num', text: String(i + 1) }), el('span', { class: 'pipe-name', text: s.name }));
      const d = el('li', {}, el('span', { class: 'pipe-num', text: String(i + 1) }), el('div', {}, el('strong', { text: s.name }), ' ', s.desc, (s.input || s.output) ? el('span', { class: 'io', text: `입력: ${s.input || '-'} → 출력: ${s.output || '-'}` }) : null));
      fill.addEventListener('click', () => {
        const on = li.dataset.active !== '1';
        for (const x of ol.children) x.dataset.active = '0';
        for (const x of descList.children) x.dataset.active = '0';
        li.dataset.active = on ? '1' : '0';
        d.dataset.active = on ? '1' : '0';
        if (on) details.open = true;
      });
      li.append(fill);
      ol.append(li);
      descList.append(d);
    });
    const table = el('table', { class: 'table-twin', hidden: true },
      el('thead', {}, el('tr', {}, el('th', { text: '단계' }), el('th', { text: '설명' }))),
      el('tbody', {}, steps.map((s, i) => el('tr', {}, el('td', { text: `${i + 1}. ${s.name}` }), el('td', { text: s.desc })))));
    fig.append(ol, details, table);
  }
  function decimals(v) { const s = String(v); const i = s.indexOf('.'); return i < 0 ? 0 : Math.min(6, s.length - i - 1); }
  function deltaChip(m) {
    if (m.ours == null || m.baseline == null) return el('span', { class: 'delta', dataset: { dir: 'flat' }, 'aria-label': '비교 불가', text: '—' });
    const d = m.ours - m.baseline;
    const abs = Math.abs(d).toFixed(Math.max(decimals(m.ours), decimals(m.baseline)));
    if (Number(abs) === 0) return el('span', { class: 'delta', dataset: { dir: 'flat' }, 'aria-label': '변화 없음', text: '— ±0' });
    const improved = (d > 0) === m.higherIsBetter;
    const rel = m.baseline !== 0 ? ` (${d > 0 ? '+' : '−'}${Math.abs((d / Math.abs(m.baseline)) * 100).toFixed(1)}%)` : '';
    const word = improved ? '개선' : '악화';
    return el('span', {
      class: 'delta', dataset: { dir: d > 0 ? 'up' : 'down', tone: improved ? 'good' : 'critical' },
      'aria-label': `${word}, ${abs} ${d > 0 ? '상승' : '하락'}`, text: `${d > 0 ? '▲' : '▼'} ${word} ${d > 0 ? '+' : '−'}${abs}${rel}`
    });
  }
  // Bar scale for metric rows without a baseline
  function soloScale(m, rows) {
    if (/%/.test(m.unit || '') && m.ours <= 100) return 100;
    if (m.ours >= 0 && m.ours <= 1) return 1;
    const peers = (rows || []).filter((r) => r.baseline == null && r.ours != null && r.name === m.name).map((r) => r.ours);
    return Math.max(m.ours, ...peers);
  }
  function metricRow(m, _i, rows) {
    const fmt = (v) => (v == null ? '—' : String(v));
    const unitEl = () => (m.unit && m.unit !== '-' ? el('span', { class: 'unit', text: m.unit }) : null);
    const maxv = m.baseline == null && m.ours != null ? soloScale(m, rows) : Math.max(m.ours != null ? m.ours : 0, m.baseline != null ? m.baseline : 0);
    const width = (v) => (v == null || v <= 0 || maxv <= 0 ? 0 : Math.round((v / maxv) * 100));
    const barOurs = el('div', { class: 'bar bar--ours' });
    barOurs.style.width = `${width(m.ours)}%`;
    const barBase = el('div', { class: 'bar bar--base' });
    barBase.style.width = `${width(m.baseline)}%`;
    return el('tr', {},
      el('td', { class: 'name' }, m.name, m.dataset ? el('span', { class: 'sub', text: m.dataset }) : null),
      el('td', { class: 'num' }, fmt(m.baseline), m.baseline != null ? unitEl() : null, m.baselineName && m.baselineName !== '-' ? el('span', { class: 'sub', text: m.baselineName }) : null),
      el('td', { class: 'num ours' }, fmt(m.ours), m.ours != null ? unitEl() : null),
      el('td', { class: 'bar-cell' }, el('div', { class: 'bars', 'aria-hidden': 'true' }, barOurs, barBase)),
      el('td', {}, deltaChip(m)),
      el('td', {}, el('span', { class: 'sub', text: [m.source, m.note].filter(Boolean).join(' · ') || '—' })));
  }
  function renderMetrics(view) {
    const fig = clear($('viz-metrics'));
    fig.hidden = false;
    const rows = view.metrics;
    const legend = el('span', { class: 'legend' }, el('span', {}, el('i', { class: 's1' }), '제안 기법'), el('span', {}, el('i', { class: 's0' }), '비교 기준'));
    fig.append(el('figcaption', {}, el('strong', { text: '주요 성능 지표 · 제안 기법 vs 비교 기준' }), legend));
    if (!rows.length) { fig.append(el('p', { class: 'viz-empty', text: '논문에서 정량 수치를 추출하지 못했습니다. 본문 설명을 참고하세요.' })); return; }
    const tbody = el('tbody');
    rows.forEach((m, i) => { const tr = metricRow(m, i, rows); tr.hidden = i >= 8; tbody.append(tr); });
    const table = el('table', { class: 'metrics-table' },
      el('thead', {}, el('tr', {}, el('th', { class: 'name', text: '지표' }), el('th', { class: 'num', text: '비교 기준' }), el('th', { class: 'num', text: '제안 기법' }), el('th', { class: 'bar-cell', text: '비교 바', title: '비교 기준이 있으면 행마다 큰 값을 100%로, 없으면 제안 기법 값을 척도(0~1, 0~100% 또는 같은 지표의 최댓값) 기준으로 표시' }), el('th', { text: '변화' }), el('th', { text: '출처' }))),
      tbody);
    fig.append(el('div', { class: 'metrics-wrap table-wrap' }, table));
    if (rows.length > 8) {
      const more = el('button', { type: 'button', class: 'btn-ghost btn-sm metrics-more', text: `${rows.length - 8}개 더 보기` });
      more.addEventListener('click', () => { for (const tr of tbody.children) tr.hidden = false; more.remove(); });
      fig.append(more);
    }
  }
  function hexToRgba(hex, alpha) {
    const m = /^#([0-9a-f]{6})$/i.exec(String(hex).trim());
    if (!m) return `rgba(42,120,214,${alpha})`;
    const n = parseInt(m[1], 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
  }
  function destroyRadar() {
    if (state.radarChart) { try { state.radarChart.destroy(); } catch {} state.radarChart = null; }
  }
  function buildRadar(canvas, view) {
    const css = getComputedStyle(document.documentElement);
    const v = (name) => css.getPropertyValue(name).trim();
    const s1 = v('--series-1');
    state.radarChart = new Chart(canvas, {
      type: 'radar',
      data: {
        labels: RADAR_AXES.map((a) => a[1]),
        datasets: [{
          data: RADAR_AXES.map(([k]) => (view.scores[k].score == null ? 0 : view.scores[k].score)),
          borderColor: s1, backgroundColor: hexToRgba(s1, 0.1), borderWidth: 2, pointRadius: 4, pointHoverRadius: 6,
          pointBackgroundColor: s1, pointBorderColor: v('--surface-1'), pointBorderWidth: 2, tension: 0
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false, animation: reducedMotion() ? false : undefined,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: v('--surface-1'), borderColor: v('--border'), borderWidth: 1, titleColor: v('--text-primary'), bodyColor: v('--text-primary'),
            callbacks: { title: () => '', label: (c) => `${c.label}: ${c.formattedValue}/5` }
          }
        },
        scales: {
          r: {
            min: 0, max: 5, ticks: { stepSize: 1, display: false }, grid: { color: v('--chart-grid'), circular: false },
            angleLines: { color: v('--chart-grid') }, pointLabels: { color: v('--text-secondary'), font: { size: 12, family: v('--font-sans') } }
          }
        }
      }
    });
  }
  function rebuildRadar() {
    const canvas = document.querySelector('#viz-radar canvas');
    destroyRadar();
    if (!canvas || !state.radarView || typeof Chart === 'undefined') return;
    buildRadar(canvas, state.radarView);
  }
  function renderRadar(view) {
    const fig = clear($('viz-radar'));
    fig.hidden = false;
    destroyRadar();
    fig.append(el('figcaption', {}, el('strong', { text: '논문 평가 점수 (1~5, GPT 추정)' })));
    if (!view.hasScores) { fig.append(el('p', { class: 'viz-empty', text: '평가 점수가 없습니다.' })); return; }
    const table = el('table', { class: 'score-table' },
      el('thead', {}, el('tr', {}, el('th', { text: '항목' }), el('th', { class: 'num', text: '점수' }))),
      el('tbody', {}, RADAR_AXES.map(([k, label]) => {
        const s = view.scores[k];
        return el('tr', {}, el('td', {}, label, s.rationale ? el('span', { class: 'rationale', text: s.rationale }) : null), el('td', { class: 'num', text: s.score == null ? '—' : `${s.score} / 5` }));
      })));
    const box = el('div', { class: 'chart-box' }, el('canvas', { role: 'img', 'aria-label': '논문 평가 점수 레이더 차트' }));
    fig.append(el('div', { class: 'radar-wrap' }, box, el('div', { class: 'table-twin' }, table)), el('p', { class: 'disclaimer', text: '점수는 GPT가 논문 내용을 바탕으로 추정한 값입니다.' }));
    state.radarView = view;
    if (typeof Chart === 'undefined') { box.remove(); return; }
    buildRadar(box.querySelector('canvas'), view);
  }
  function prosConsColumn(kind, title, items) {
    const list = el('ul');
    for (const t of items) {
      const txt = el('span', { class: t.length > 90 ? 'txt clamp' : 'txt', text: t });
      const li = el('li', {}, txt);
      if (t.length > 90) {
        const more = el('button', { type: 'button', class: 'more', text: '더 보기' });
        more.addEventListener('click', () => { txt.classList.remove('clamp'); more.remove(); });
        li.append(' ', more);
      }
      list.append(li);
    }
    return el('section', { class: 'pc-col', dataset: { kind } },
      el('h4', {}, el('span', { class: 'ico', 'aria-hidden': 'true', text: kind === 'pro' ? '✓' : '△' }), title, el('span', { class: 'count', text: `${items.length}개` })),
      items.length ? list : el('p', { class: 'none', text: '추출된 항목이 없습니다.' }));
  }
  function renderProsCons(view) {
    const fig = clear($('viz-proscons'));
    const anchor = $('pros-anchor');
    anchor.hidden = !view.strengths.length;
    anchor.textContent = `장점 ${view.strengths.length}개 → 아래 비교 보기`;
    if (!view.strengths.length && !view.limitations.length) { fig.hidden = true; return; }
    fig.hidden = false;
    fig.append(el('figcaption', {}, el('strong', { text: '장점 vs 한계점' })),
      el('div', { class: 'proscons' }, prosConsColumn('pro', '장점', view.strengths), prosConsColumn('con', '한계점', view.limitations)));
  }
  function renderTech(view) {
    const fig = clear($('viz-tech'));
    fig.hidden = false;
    fig.append(el('figcaption', {}, el('strong', { text: '핵심기술' })));
    if (!view.coreTech.length) { fig.append(el('p', { class: 'viz-empty', text: '핵심 기술 항목을 추출하지 못했습니다.' })); return; }
    const groups = new Map();
    for (const t of view.coreTech) {
      let cat = t.category;
      if (!groups.has(cat) && groups.size >= 5 && cat !== 'other') cat = 'other';
      if (!groups.has(cat)) groups.set(cat, []);
      groups.get(cat).push(t);
    }
    for (const [cat, items] of groups) {
      const wrap = el('div', { class: 'chip-wrap' });
      for (const t of items) {
        const chip = el('button', { type: 'button', class: 'tech-chip', 'aria-expanded': 'false', title: t.desc.split(/(?<=\.)\s/)[0] || t.name, text: t.name, lang: isEnglish(t.name) ? 'en' : null });
        const desc = el('div', { class: 'tech-desc', hidden: true, lang: isEnglish(t.role + t.desc) ? 'en' : null }, t.role ? el('span', { class: 'role', text: t.role }) : null, t.desc);
        chip.addEventListener('click', () => { const on = chip.getAttribute('aria-expanded') !== 'true'; chip.setAttribute('aria-expanded', String(on)); desc.hidden = !on; });
        wrap.append(chip, desc);
      }
      fig.append(el('section', { class: 'tech-group' }, el('h4', { class: 'tech-cat', text: TECH_CATS[cat] }), wrap));
    }
  }

  const hasKey = (o, k) => typeof k === 'string' && Object.prototype.hasOwnProperty.call(o, k);
  // Normalizes raw model ideas for display, dropping malformed items.
  function ideasView(raw) {
    const o = raw && typeof raw === 'object' ? raw : {};
    const str = (x) => (typeof x === 'string' ? x.trim() : '');
    const strs = (x) => (Array.isArray(x) ? x.map(str).filter(Boolean) : []);
    const ideas = (Array.isArray(o.ideas) ? o.ideas : []).filter((i) => i && typeof i === 'object' && str(i.title)).slice(0, IDEAS_MAX).map((i) => ({
      title: str(i.title), category: hasKey(IDEA_CATS, i.category) ? i.category : '', level: hasKey(IDEA_LEVELS, i.difficulty) ? i.difficulty : '',
      motivation: str(i.motivation), grounding: str(i.grounding), approach: str(i.approach), experiment: str(i.experiment),
      impact: str(i.expected_impact), resources: str(i.resources), levelReason: str(i.difficulty_reason), keywords: strs(i.keywords_en)
    }));
    return { ideas, questions: strs(o.open_questions), notes: str(o.notes) };
  }
  function ideaTags(it) { return [it.category && IDEA_CATS[it.category], it.level && `난이도 ${IDEA_LEVELS[it.level]}`].filter(Boolean); }
  function ideaBlocks(it) {
    const lv = IDEA_LEVELS[it.level];
    return [
      ['배경과 근거', [{ text: it.motivation }, { text: it.grounding && `근거: ${it.grounding}`, kind: 'ground' }]],
      ['접근 방법', [{ text: it.approach }]],
      ['검증 실험', [{ text: it.experiment }]],
      ['기대 효과', [{ text: it.impact }]],
      ['필요 자원', [{ text: it.resources }, { text: lv && it.levelReason && `난이도 ${lv}: ${it.levelReason}`, kind: 'reason' }]]
    ].map(([label, ps]) => [label, ps.filter((x) => x.text)]).filter(([, ps]) => ps.length);
  }
  function ideaCard(it, i) {
    const cat = it.category ? el('span', { class: 'idea-chip', text: IDEA_CATS[it.category] }) : null;
    const level = it.level ? el('span', { class: 'idea-chip idea-level', dataset: { level: it.level } },
      el('span', { class: 'lv-bars', 'aria-hidden': 'true' }, el('i'), el('i'), el('i')), `난이도 ${IDEA_LEVELS[it.level]}`) : null;
    const blocks = ideaBlocks(it).map(([label, ps]) => el('section', { class: 'idea-block' }, el('h5', { text: label }),
      ps.map((x) => el('p', { class: x.kind ? `idea-${x.kind}` : null, text: x.text }))));
    const kw = it.keywords.length ? el('ul', { class: 'idea-kw', 'aria-label': '키워드로 Google Scholar 검색' }, it.keywords.map((k) => el('li', {},
      el('a', { class: 'ext', href: SCHOLAR_URL + encodeURIComponent(k), target: '_blank', rel: 'noopener noreferrer', lang: 'en', title: 'Google Scholar에서 검색', text: k })))) : null;
    return el('article', { class: 'idea-card', 'aria-labelledby': `idea-${i + 1}` },
      el('h4', { id: `idea-${i + 1}`, class: 'idea-title' }, el('span', { class: 'idea-num', text: String(i + 1) }), el('span', { text: it.title })),
      cat || level ? el('div', { class: 'idea-chips' }, cat, level) : null,
      blocks, kw);
  }
  function renderIdeas(job) {
    if (!job || state.currentJobId !== job.id) return;
    const box = clear($('ideas-body'));
    const st = job.ideasStatus;
    const action = (label) => el('button', { type: 'button', class: 'btn-secondary btn-sm', dataset: { ideasAction: 'generate' }, disabled: !!state.run, text: label });
    const notice = (text, button, kind) => el('div', { class: `card ideas-state${kind ? ` ideas-state--${kind}` : ''}` }, el('p', { text }), button);
    const view = ideasView(job.ideas);
    if (st === undefined) { box.append(notice('이 분석에는 주제 제안이 없습니다.', action('주제 제안 만들기'))); return; }
    if (st === 'running') { box.append(el('p', { class: 'ideas-loading', role: 'status' }, el('span', { class: 'spinner', 'aria-hidden': 'true' }), '주제 제안을 만드는 중…')); return; }
    if (st === 'pending') {
      const busy = job.state === 'outlining' || job.state === 'running';
      box.append(notice(busy ? '논문 구조를 분석한 뒤 주제 제안을 만듭니다.' : '주제 제안이 생성되지 않았습니다.', !busy && job.outline ? action('주제 제안 만들기') : null));
      return;
    }
    if (st === 'failed') box.append(notice(`주제 제안을 만들지 못했습니다. ${job.ideasError || ''}`.trim(), action('다시 만들기'), 'failed'));
    else if (!view.ideas.length) { box.append(notice('주제 제안이 생성되지 않았습니다.', action('다시 만들기'))); return; }
    if (!view.ideas.length) return;
    box.append(el('header', { class: 'ideas-head' },
      el('div', { class: 'ideas-head-text' }, el('h3', { text: `후속 연구 주제 ${view.ideas.length}개` }), el('p', { class: 'ideas-intro', text: IDEAS_INTRO })),
      st === 'done' ? action('다시 만들기') : null));
    box.append(el('div', { class: 'ideas-list' }, view.ideas.map(ideaCard)));
    if (view.questions.length) box.append(el('section', { class: 'ideas-questions' }, el('h3', { text: '논문이 남긴 질문' }), el('ul', {}, view.questions.map((q) => el('li', { text: q })))));
    if (view.notes) box.append(el('p', { class: 'ideas-notes' }, el('strong', { text: '참고' }), ' ', view.notes));
    typesetMath(box);
  }

  function smallButton(label, cls, onClick) {
    return el('button', { type: 'button', class: `btn-ghost btn-sm ${cls}`, text: label, 'aria-label': label, onclick: onClick });
  }
  function buildCard(job, c) {
    const head = el('header', { class: 'sc-head' },
      el('h3', { text: cardTitle(c) }),
      el('span', { class: 'status-chip', dataset: { status: c.status } }, el('span', { class: 'lbl' })),
      el('span', { class: 'warn-badge', hidden: true }),
      el('div', { class: 'sc-actions' },
        smallButton('복사', 'act-copy', () => copyText(c.text).then(() => toast('클립보드에 복사했습니다'), () => toast('복사에 실패했습니다.', 'error'))),
        smallButton('다시 번역', 'act-retry', () => retryChunk(job, c)),
        smallButton(`원문 ${c.startPage}쪽`, 'act-goto', () => gotoPage(job, c))),
      el('span', { class: 'title-en', text: c.sections.length ? c.titleEn : `${c.startPage}–${c.endPage} 페이지` }));
    const body = el('div', { class: 'sc-body' },
      el('p', { class: 'waiting', text: '번역을 기다리는 중…' }),
      el('div', { class: 'md md--stable' }),
      el('div', { class: 'md md--tail' }),
      el('span', { class: 'caret', hidden: true, 'aria-hidden': 'true' }));
    const err = el('div', { class: 'sc-error', hidden: true }, el('p'), el('button', { type: 'button', class: 'btn-secondary btn-sm', text: '다시 시도', onclick: () => retryChunk(job, c) }));
    return el('article', { class: 'section-card', id: `sec-${c.id}`, dataset: { sec: c.id, status: c.status } }, head, body, err);
  }
  function renderTranslation(job) {
    if (state.currentJobId !== job.id) return;
    const main = $('tr-main');
    for (const card of main.querySelectorAll('.section-card')) card.remove();
    renderState.clear();
    $('tr-empty').hidden = !(job.outline && job.chunks.length === 0);
    for (const c of job.chunks) main.append(buildCard(job, c));
    for (const c of job.chunks) renderChunkFinal(job, c);
    renderToc(job);
    renderPdfPane(job);
  }
  function renderChunkStatus(job, c) {
    if (state.currentJobId !== job.id) return;
    const card = cardEl(c.id);
    if (card) {
      const busy = c.status === 'running' || c.status === 'retrying';
      card.dataset.status = c.status;
      card.setAttribute('aria-busy', busy ? 'true' : 'false');
      const chip = card.querySelector('.status-chip');
      chip.dataset.status = c.status;
      chip.querySelector('.lbl').textContent = CHIP_LABELS[c.status] || c.status;
      chip.title = chipTooltip(c);
      card.querySelector('.waiting').hidden = !(c.status === 'pending' || (busy && !c.text));
      card.querySelector('.caret').hidden = !busy;
      const badge = card.querySelector('.warn-badge');
      badge.hidden = !(c.truncated || c.cutAtNext);
      badge.textContent = c.truncated ? '일부 잘림' : '경계 정리됨';
      badge.title = c.truncatedFinal ? (c.truncReason ? `응답이 중단되어 뒷부분이 잘렸습니다 (${c.truncReason}).` : '출력 한도에 걸려 뒷부분이 잘렸습니다.') : (c.truncated ? '출력 한도로 번역을 나누어 이어 붙였습니다. 경계 부근이 누락·중복될 수 있습니다.' : '직후 섹션 내용이 섞여 들어와 잘라냈습니다.');
      const retryBtn = card.querySelector('.act-retry');
      const idlePending = c.status === 'pending' && !(state.run && state.run.jobId === job.id);
      retryBtn.hidden = !(c.status === 'failed' || c.status === 'done' || c.optional || idlePending);
      retryBtn.textContent = c.optional || idlePending ? '번역' : (c.status === 'failed' ? '다시 시도' : '다시 번역');
      card.querySelector('.act-copy').hidden = !c.text || busy;
    }
    const dot = document.querySelector(`#toc-list a[data-sec="${c.id}"] .dot`);
    if (dot) dot.dataset.status = c.status;
    renderChips(job);
  }
  function renderChunkFinal(job, c) {
    if (state.currentJobId !== job.id) return;
    const card = cardEl(c.id);
    if (!card) return;
    renderChunkStatus(job, c);
    const stable = card.querySelector('.md--stable');
    const tail = card.querySelector('.md--tail');
    const err = card.querySelector('.sc-error');
    renderState.delete(c.id);
    clear(tail);
    if (c.status === 'running' || c.status === 'retrying') {
      clear(stable);
      err.hidden = true;
      if (c.text) renderStreaming(job, c);
    } else {
      if (c.text) mountMarkdown(stable, c.text); else clear(stable);
      err.hidden = c.status !== 'failed';
      if (c.status === 'failed') err.querySelector('p').textContent = `번역에 실패했습니다 · ${c.error || ''}`;
    }
    refreshTocSub(job, c);
  }
  function renderToc(job) {
    if (state.currentJobId !== job.id) return;
    const list = $('toc-list');
    const items = [...list.children];
    if (list.dataset.job !== job.id || items.length !== job.chunks.length || items.some((li, i) => li.dataset.sec !== job.chunks[i].id)) {
      clear(list);
      list.dataset.job = job.id;
      for (const c of job.chunks) {
        list.append(el('li', { dataset: { sec: c.id } },
          el('a', { class: 'toc-link', href: `#sec-${c.id}`, dataset: { sec: c.id } }, el('span', { class: 'dot' }), el('span', { class: 'lbl' }))));
      }
    }
    job.chunks.forEach((c, i) => {
      const a = list.children[i].firstElementChild;
      const title = cardTitle(c);
      a.querySelector('.dot').dataset.status = c.status;
      a.querySelector('.lbl').textContent = title;
      a.title = title;
      refreshTocSub(job, c);
    });
    scheduleSpy();
  }
  function headingLabel(h) {
    const copy = h.cloneNode(true);
    for (const k of copy.querySelectorAll('.katex')) {
      const tex = k.querySelector('annotation[encoding="application/x-tex"]');
      k.replaceWith(tex ? tex.textContent : k.textContent);
    }
    return copy.textContent.replace(/\$\$([^$]+)\$\$|\$([^$\n]+)\$|\\\((.+?)\\\)/g, (m, a, b, c) => a || b || c).replace(/\s+/g, ' ').trim();
  }
  function tocHeadings(card, c) {
    if (c.status === 'failed') return [];
    const items = [];
    card.querySelectorAll('.md--stable > :is(h1, h2, h3, h4), .md--tail > :is(h1, h2, h3, h4)').forEach((h, i) => {
      const level = Number(h.tagName[1]);
      if (i === 0 && level <= 2) return;
      const label = headingLabel(h);
      if (!label) return;
      h.id = `sec-${c.id}-h${items.length + 1}`;
      h.tabIndex = -1;
      items.push({ id: h.id, depth: level === 4 ? 2 : 1, label });
    });
    return items;
  }
  function refreshTocSub(job, c) {
    clearTimeout(tocTimers.get(c.id));
    tocTimers.delete(c.id);
    tocLast.set(c.id, Date.now());
    if (state.currentJobId !== job.id) return;
    const li = document.querySelector(`#toc-list > li[data-sec="${c.id}"]`);
    const card = cardEl(c.id);
    if (!li || !card) return;
    const items = tocHeadings(card, c);
    const key = items.map((x) => `${x.depth}:${x.label}`).join('\n');
    if (li.dataset.subKey === key) return;
    li.dataset.subKey = key;
    let ol = li.querySelector(':scope > ol');
    if (!items.length) { if (ol) ol.remove(); scheduleSpy(); return; }
    if (!ol) ol = li.appendChild(el('ol', { class: 'toc-sub' }));
    items.forEach((it, i) => {
      const a = (ol.children[i] || ol.appendChild(el('li', {}, el('a', { class: 'toc-sub-link' }, el('span', { class: 'lbl' }))))).firstElementChild;
      a.setAttribute('href', `#${it.id}`);
      a.dataset.target = it.id;
      a.dataset.depth = String(it.depth);
      a.title = it.label;
      a.firstElementChild.textContent = it.label;
    });
    while (ol.children.length > items.length) ol.lastElementChild.remove();
    scheduleSpy();
  }
  function scheduleTocSub(job, c) {
    if (tocTimers.has(c.id)) return;
    const wait = Math.max(0, TOC_THROTTLE_MS - (Date.now() - (tocLast.get(c.id) || 0)));
    tocTimers.set(c.id, setTimeout(() => refreshTocSub(job, c), wait));
  }
  function onTocClick(e) {
    const a = e.target.closest('#toc-list a');
    if (!a) return;
    e.preventDefault();
    if (a.classList.contains('toc-link')) {
      const card = cardEl(a.dataset.sec);
      if (card) scrollToNode(card);
      return;
    }
    const h = document.getElementById(a.dataset.target);
    if (!h) return;
    scrollToNode(h);
    h.focus({ preventScroll: true });
  }
  function scheduleSpy() {
    if (spyFrame) return;
    spyFrame = requestAnimationFrame(() => { spyFrame = 0; updateTocSpy(); });
  }
  function updateTocSpy() {
    if (state.currentTab !== 'translation' || $('view-result').hidden) return;
    const cards = document.querySelectorAll('#tr-main .section-card');
    if (!cards.length) return;
    const list = $('toc-list');
    const line = readingLine();
    let cur = null;
    for (const card of cards) { if (card.getBoundingClientRect().top <= line) cur = card; else break; }
    if (!cur && cards[0].getBoundingClientRect().top < window.innerHeight * 0.45) cur = cards[0];
    const secId = cur ? cur.dataset.sec : '';
    let sub = null;
    if (cur) {
      for (const a of list.querySelectorAll(`:scope > li[data-sec="${secId}"] .toc-sub-link`)) {
        const h = document.getElementById(a.dataset.target);
        if (!h || h.getBoundingClientRect().top > line) break;
        sub = a;
      }
    }
    let active = null;
    for (const a of list.querySelectorAll('a')) {
      const section = a.classList.contains('toc-link');
      const own = section && a.dataset.sec === secId;
      const on = section ? own && !sub : a === sub;
      if (on) active = a;
      const v = on ? 'true' : 'false';
      if (a.getAttribute('aria-current') !== v) a.setAttribute('aria-current', v);
      if (section) a.classList.toggle('contains-current', own && !!sub);
    }
    if (active && active !== spyActive) keepTocVisible(active);
    spyActive = active;
  }
  function keepTocVisible(a) {
    const ar = a.getBoundingClientRect();
    for (const box of [$('toc'), $('toc-list')]) {
      const r = box.getBoundingClientRect();
      if (box.scrollHeight > box.clientHeight + 1) {
        if (ar.top < r.top) box.scrollTop -= r.top - ar.top + 8;
        else if (ar.bottom > r.bottom) box.scrollTop += ar.bottom - r.bottom + 8;
      }
      if (box.scrollWidth > box.clientWidth + 1) {
        if (ar.left < r.left) box.scrollLeft -= r.left - ar.left + 8;
        else if (ar.right > r.right) box.scrollLeft += ar.right - r.right + 8;
      }
    }
  }
  function pdfHref(job) { return job.source.type === 'file' ? (job.source.blobUrl || '') : (job.source.pdfUrl || ''); }
  function pdfEmbeddable(job) { return job.source.type === 'file' ? !!job.source.blobUrl : !!job.source.iframeOk; }
  function renderPdfPane(job) {
    const href = pdfHref(job);
    const link = $('pdf-open-link');
    const frame = $('pdf-frame');
    const fallback = $('pdf-fallback');
    if (href) link.href = href; else link.removeAttribute('href');
    link.hidden = !href;
    const ok = !!href && pdfEmbeddable(job);
    fallback.hidden = ok;
    fallback.textContent = href ? '이 사이트는 페이지 안에 표시할 수 없습니다. 새 탭에서 열어 주세요.' : '업로드한 PDF는 브라우저에 저장되지 않습니다. 원문 탭에서 파일을 다시 선택해 주세요.';
    frame.hidden = !ok;
    $('pdf-pane').hidden = !state.sbs;
    if (ok && state.sbs && frame.dataset.base !== href) { frame.dataset.base = href; frame.src = href; }
    if (!ok && frame.dataset.base) { frame.removeAttribute('src'); delete frame.dataset.base; }
  }
  function renderSourcePanel(job) {
    if (state.currentJobId !== job.id) return;
    const href = pdfHref(job);
    const link = $('source-open-link');
    const frame = $('source-frame');
    const ok = !!href && pdfEmbeddable(job);
    $('source-label').textContent = job.source.type === 'file' ? (job.source.fileName || '업로드한 PDF') : (job.source.pdfUrl || '');
    if (href) link.href = href; else link.removeAttribute('href');
    link.hidden = !href;
    frame.hidden = !ok;
    $('source-empty').hidden = ok;
    $('btn-source-reselect').hidden = !(job.source.type === 'file' && !href);
    $('source-empty-text').textContent = job.source.type === 'file' && !href
      ? '업로드한 PDF는 브라우저에 저장되지 않습니다. 파일을 다시 선택하면 원문을 볼 수 있습니다.'
      : '이 사이트는 페이지 안에 표시할 수 없습니다. 새 탭에서 열어 주세요.';
    if (ok && state.currentTab === 'source' && frame.dataset.base !== href) { frame.dataset.base = href; frame.src = href; }
    if (!ok && frame.dataset.base) { frame.removeAttribute('src'); delete frame.dataset.base; }
  }
  function gotoPage(job, c) {
    const href = pdfHref(job);
    if (!href) { toast('원문 PDF를 열 수 없습니다. 원문 탭에서 파일을 다시 선택해 주세요.'); return; }
    const target = `${href}#page=${c.startPage}`;
    if (!pdfEmbeddable(job)) { window.open(target, '_blank', 'noopener'); return; }
    if (state.sbs && !narrowScreen() && state.currentTab === 'translation') { $('pdf-frame').dataset.base = href; $('pdf-frame').src = target; return; }
    selectTab('source');
    $('source-frame').dataset.base = href;
    $('source-frame').src = target;
  }
  function renderHistory() {
    const list = store.loadHistory();
    const ul = clear($('history-list'));
    $('history-empty').hidden = list.length > 0;
    $('btn-history-clear').hidden = list.length === 0;
    for (const h of list) ul.append(historyItem(h));
    $('storage-warning').hidden = store.localJobBytes() < LS_WARN_BYTES;
  }
  function historyItem(h) {
    const authors = Array.isArray(h.authors) && h.authors.length ? (h.authors.length > 1 ? `${h.authors[0]} 외 ${h.authors.length - 1}명` : h.authors[0]) : '';
    const meta = [authors, [h.venue, h.year].filter(Boolean).join(' '), h.model, h.createdAt ? fmtDate(h.createdAt) : ''].filter(Boolean).join(' · ');
    const src = h.source || {};
    return el('li', { class: 'history-item' },
      el('div', { class: 'title' }, h.title_ko || h.title_en || src.fileName || src.url || '제목 없음', ' ', el('span', { class: 'status-badge', dataset: { state: h.state }, text: STATE_LABELS[h.state] || h.state })),
      el('div', { class: 'subtitle', text: h.title_en || '' }),
      el('div', { class: 'meta', text: meta }),
      el('div', { class: 'actions' },
        el('button', { type: 'button', class: 'btn-secondary btn-sm', text: '열기', onclick: () => navigate(`#result/${h.id}`) }),
        el('button', { type: 'button', class: 'btn-ghost btn-sm', text: '삭제', onclick: () => deleteHistory(h.id) })));
  }
  function releaseJob(id) {
    if (state.run && state.run.jobId === id) return;
    const j = state.jobs[id];
    if (j && j.source && j.source.blobUrl) { URL.revokeObjectURL(j.source.blobUrl); j.source.blobUrl = ''; }
    fileCache.delete(id);
    delete state.jobs[id];
  }
  async function deleteHistory(id) {
    if (state.run && state.run.jobId === id) { toast(MSG.busy, 'error'); return; }
    store.saveHistory(store.loadHistory().filter((h) => h.id !== id));
    await store.deleteJob(id);
    releaseJob(id);
    renderHistory();
    toast('기록을 삭제했습니다');
  }

  function copyText(text) {
    const primary = navigator.clipboard && navigator.clipboard.writeText ? navigator.clipboard.writeText(text) : Promise.reject(new Error('no-clipboard'));
    return primary.catch(() => {
      const ta = el('textarea', { readOnly: true, 'aria-hidden': 'true' });
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.append(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch { ok = false; }
      ta.remove();
      if (!ok) throw new Error('copy-failed');
    });
  }
  function downloadBlob(name, text, type) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = el('a', { href: url, download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function exportSections(job) {
    const out = [];
    let i = 0;
    while (i < job.chunks.length) {
      const c = job.chunks[i];
      const parts = c.partCount > 1 ? job.chunks.filter((x) => x.sectionKey === c.sectionKey && x.partCount === c.partCount).sort((a, b) => a.partIndex - b.partIndex) : [c];
      let text = '';
      for (const p of parts) if (p.text) text = joinParts(text, p.text);
      out.push({ title: cardTitle({ ...c, partCount: 1 }), text, status: parts.every((p) => p.status === 'done' || p.status === 'skipped') ? 'done' : (parts.some((p) => p.status === 'failed') ? 'failed' : 'partial') });
      i += parts.length;
    }
    return out;
  }
  function mdCell(s) { return String(s || '').replace(/\|/g, '\\|').replace(/\n/g, ' '); }
  function summaryMarkdown(job) {
    const view = job.summary ? toView(job.summary) : null;
    const L = ['# 요약'];
    if (!view) { L.push('', '(요약이 생성되지 않았습니다.)'); return L.join('\n'); }
    L.push('', `**한 줄 요약:** ${view.tldr}`, '', '## 한눈에 보기', `- 문제: ${view.glance.problem}`, `- 방법: ${view.glance.method}`, `- 결과: ${view.glance.result}`);
    L.push('', '## 문제정의', '', view.sections.problem_definition);
    L.push('', '## 해결방법(제안 기법)', '', view.sections.proposed_method);
    if (view.pipeline.length) { L.push('', '### 제안 기법 처리 흐름'); view.pipeline.forEach((p, i) => L.push(`${i + 1}. **${p.name}** — ${p.desc}`)); }
    L.push('', '## 결과 및 장점', '', view.sections.results_and_strengths);
    if (view.metrics.length) {
      L.push('', '### 주요 성능 지표', '', '| 지표 | 데이터셋 | 비교 기준 | 제안 기법 | 변화 | 출처 |', '|---|---|---|---|---|---|');
      for (const m of view.metrics) {
        const unit = m.unit && m.unit !== '-' ? m.unit : '';
        const base = m.baseline == null ? '—' : `${m.baseline}${unit}${m.baselineName && m.baselineName !== '-' ? ` (${m.baselineName})` : ''}`;
        L.push(`| ${mdCell(m.name)} | ${mdCell(m.dataset)} | ${mdCell(base)} | ${m.ours == null ? '—' : mdCell(`${m.ours}${unit}`)} | ${mdCell(deltaChip(m).textContent)} | ${mdCell([m.source, m.note].filter(Boolean).join(' · '))} |`);
      }
    }
    if (view.hasScores) {
      L.push('', '### 논문 평가 점수 (1~5, GPT 추정)', '', '| 항목 | 점수 | 근거 |', '|---|---|---|');
      for (const [k, label] of RADAR_AXES) L.push(`| ${label} | ${view.scores[k].score == null ? '—' : `${view.scores[k].score} / 5`} | ${mdCell(view.scores[k].rationale)} |`);
    }
    if (view.strengths.length) { L.push('', '### 장점'); for (const s of view.strengths) L.push(`- ${s}`); }
    L.push('', '## 단점 및 한계점', '', view.sections.weaknesses_and_limitations);
    if (view.limitations.length) { L.push('', '### 한계점 목록'); for (const s of view.limitations) L.push(`- ${s}`); }
    if (view.futureWork.length) { L.push('', '### 향후 과제'); for (const s of view.futureWork) L.push(`- ${s}`); }
    L.push('', '## 핵심기술', '', view.sections.core_technology);
    if (view.coreTech.length) { L.push('', '### 핵심기술 목록'); for (const t of view.coreTech) L.push(`- **${t.name}** (${TECH_CATS[t.category]}): ${[t.role, t.desc].filter(Boolean).join(' ')}`); }
    return L.join('\n');
  }
  function buildMarkdown(job, opts) {
    const meta = (job.outline && job.outline.meta) || {};
    const y = (s) => JSON.stringify(String(s || ''));
    const src = job.source.type === 'file' ? job.source.fileName : (job.source.landingUrl || job.source.pdfUrl);
    const fm = ['---', `title_ko: ${y(meta.title_ko)}`, `title_en: ${y(meta.title_en)}`, `authors: ${y((meta.authors || []).join(', '))}`, `venue: ${y(meta.venue)}`, `year: ${meta.year || ''}`, `source: ${y(src)}`, `model: ${job.model}`, `created: ${new Date(job.createdAt).toISOString()}`, '---', ''];
    const parts = [fm.join('\n'), summaryMarkdown(job)];
    if (!(opts && opts.summaryOnly)) {
      parts.push('', '# 전문 번역');
      for (const s of exportSections(job)) {
        parts.push('');
        if (!/^#/.test(s.text.trimStart())) parts.push(`## ${s.title}`, '');
        parts.push(s.text || `(번역 없음${s.status === 'failed' ? ' · 실패' : ''})`);
      }
      parts.push('', ideasMarkdown(job));
    }
    return `${parts.join('\n')}\n`;
  }
  function ideasMarkdown(job) {
    const view = ideasView(job.ideas);
    const L = ['# 주제 제안'];
    if (!view.ideas.length) { L.push('', '(주제 제안이 생성되지 않았습니다.)'); return L.join('\n'); }
    L.push('', `> ${IDEAS_INTRO}`);
    view.ideas.forEach((it, i) => {
      L.push('', `## ${i + 1}. ${it.title}`);
      const tags = ideaTags(it);
      if (tags.length) L.push('', `*${tags.join(' · ')}*`);
      for (const [label, ps] of ideaBlocks(it)) L.push('', `**${label}**`, '', ps.map((x) => x.text).join('\n\n'));
      if (it.keywords.length) L.push('', `**키워드** ${it.keywords.map((k) => `[${k.replace(/[[\]]/g, '\\$&')}](${SCHOLAR_URL}${encodeURIComponent(k).replace(/[()]/g, (c) => (c === '(' ? '%28' : '%29'))})`).join(', ')}`);
    });
    if (view.questions.length) { L.push('', '## 논문이 남긴 질문', ''); for (const q of view.questions) L.push(`- ${q}`); }
    if (view.notes) L.push('', `> 참고: ${view.notes}`);
    return L.join('\n');
  }
  function ideasHtml(job) {
    const view = ideasView(job.ideas);
    if (!view.ideas.length) return '<p class="muted">(주제 제안이 생성되지 않았습니다.)</p>';
    const out = [`<p class="muted">${escapeHtml(IDEAS_INTRO)}</p>`];
    view.ideas.forEach((it, i) => {
      const tags = ideaTags(it);
      const blocks = ideaBlocks(it).map(([label, ps]) => `<h3>${label}</h3>${ps.map((x) => `<p>${escapeHtml(x.text)}</p>`).join('')}`).join('');
      const kw = it.keywords.length ? `<p class="kw">${it.keywords.map((k) => `<a href="${escapeHtml(SCHOLAR_URL + encodeURIComponent(k))}" target="_blank" rel="noopener noreferrer" lang="en">${escapeHtml(k)}</a>`).join(' ')}</p>` : '';
      out.push(`<article class="sec idea"><h2>${i + 1}. ${escapeHtml(it.title)}</h2>${tags.length ? `<p class="muted">${escapeHtml(tags.join(' · '))}</p>` : ''}${blocks}${kw}</article>`);
    });
    if (view.questions.length) out.push(`<h2>논문이 남긴 질문</h2><ul>${view.questions.map((q) => `<li>${escapeHtml(q)}</li>`).join('')}</ul>`);
    if (view.notes) out.push(`<p class="muted">참고: ${escapeHtml(view.notes)}</p>`);
    return out.join('\n');
  }
  const EXPORT_CSS = `:root{color-scheme:light;--page:#f9f9f7;--surface-1:#fcfcfb;--surface-2:#f3f2ee;--text-primary:#0b0b0b;--text-secondary:#52514e;--text-muted:#898781;--border:rgba(11,11,11,.1);--series-1:#2a78d6;--chart-deemph:#c3c2b7;--status-good:#0ca30c;--status-good-text:#006300;--status-critical-text:#a12626;--status-serious:#ec835a}
@media(prefers-color-scheme:dark){:root{color-scheme:dark;--page:#0d0d0d;--surface-1:#1a1a19;--surface-2:#232322;--text-primary:#f0efec;--text-secondary:#c3c2b7;--text-muted:#898781;--border:rgba(255,255,255,.1);--series-1:#3987e5;--chart-deemph:#52514e;--status-good-text:#0ca30c;--status-critical-text:#e66767}}
body{margin:0;background:var(--page);color:var(--text-primary);font-family:-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Segoe UI","Malgun Gothic","Noto Sans KR",sans-serif;line-height:1.6}
main{max-width:880px;margin:0 auto;padding:32px 16px 64px}
h1{font-size:24px;margin:1.6em 0 .6em}h2{font-size:19px;margin:1.4em 0 .5em;padding-bottom:6px;border-bottom:1px solid var(--border)}h3{font-size:16px;margin:1.2em 0 .4em}
.head h1{margin-top:0}.head .en,.head .sub,.muted{color:var(--text-secondary);font-size:14px;margin:4px 0}
.tldr{padding:10px 14px;border-left:3px solid var(--series-1);background:var(--surface-2);border-radius:0 6px 6px 0}
.glance{list-style:none;padding:0;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.glance li{border:1px solid var(--border);border-left:3px solid var(--chart-deemph);border-radius:8px;padding:10px 12px;font-size:14px}.glance li:nth-child(2){border-left-color:var(--series-1)}.glance b{display:block;font-size:12px;color:var(--text-secondary);margin-bottom:4px}
.md{font-size:15px;line-height:1.75;word-break:keep-all;overflow-wrap:anywhere}.md p{margin:0 0 .9em}.md pre,.md code{font-family:ui-monospace,Menlo,monospace;background:var(--surface-2);border-radius:4px}.md pre{padding:12px;overflow-x:auto}.md code{padding:.1em .35em}.md pre code{padding:0;background:none}.md blockquote{margin:0 0 .9em;padding:.4em 1em;border-left:3px solid var(--chart-deemph);color:var(--text-secondary)}
.table-wrap{overflow-x:auto;margin:0 0 .9em}table{border-collapse:collapse;width:100%;font-size:13px}th,td{border:1px solid var(--border);padding:6px 8px;text-align:left;vertical-align:top}th{background:var(--surface-2)}
.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}.ours{font-weight:600}.sub{display:block;font-size:12px;color:var(--text-muted)}.unit{color:var(--text-muted);font-size:12px;margin-left:2px}
.bar-cell{min-width:160px}.bars{display:flex;flex-direction:column;gap:2px}.bar{height:8px;border-radius:0 4px 4px 0}.bar--ours{background:var(--series-1)}.bar--base{background:var(--chart-deemph)}
.legend{font-size:12px;color:var(--text-secondary)}.legend span{margin-right:12px}.legend i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:6px;vertical-align:middle}.legend .s1{background:var(--series-1)}.legend .s0{background:var(--chart-deemph)}
.delta{display:inline-block;padding:2px 8px;border-radius:999px;font-size:12px;background:var(--surface-2);color:var(--text-secondary);white-space:nowrap}.delta[data-tone=good]{color:var(--status-good-text);background:rgba(12,163,12,.12)}.delta[data-tone=critical]{color:var(--status-critical-text);background:rgba(208,59,59,.12)}
.steps{list-style:none;padding:0;display:flex;flex-direction:column;gap:8px}.steps li{display:flex;gap:10px;align-items:flex-start;font-size:14px}.steps .n{flex:none;width:20px;height:20px;border-radius:50%;background:var(--series-1);color:#fff;font-size:11px;font-weight:700;display:inline-flex;align-items:center;justify-content:center}
.proscons{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;margin:1em 0}.pc-col{border:1px solid var(--border);border-top:3px solid var(--chart-deemph);border-radius:8px;padding:10px 14px}.pc-col[data-kind=pro]{border-top-color:var(--status-good)}.pc-col[data-kind=con]{border-top-color:var(--status-serious)}.pc-col h4{margin:0 0 8px}.pc-col ul{padding-left:18px;margin:0;font-size:14px}
.tech{padding-left:18px;font-size:14px}.sec{margin-top:24px;padding:20px;border:1px solid var(--border);border-radius:12px;background:var(--surface-1)}.sec h2{margin-top:0;border:0}
.katex-display{overflow-x:auto;overflow-y:hidden;padding:8px 0}
.md--sum ul{list-style:disc;padding-left:1.3em;margin:0 0 .9em}.md--sum ul ul{list-style:circle}.md--sum ul ul ul{list-style:square}.md--sum ol{list-style:decimal;padding-left:1.6em;margin:0 0 .9em}
.md--sum li{margin:.15em 0}.md--sum>ul>li,.md--sum>ol>li{margin:0 0 .8em}.md--sum li>ul,.md--sum li>ol{margin:.25em 0 0}.md--sum li>p{margin:0 0 .25em}
.md--sum>ul>li::marker,.md--sum>ol>li::marker{color:var(--series-1)}.md--sum li li::marker{color:var(--text-muted)}
.md--sum>ul>li>strong:first-child,.md--sum>ul>li>p:first-child>strong:first-child,.md--sum>ol>li>strong:first-child,.md--sum>ol>li>p:first-child>strong:first-child{color:var(--text-primary);letter-spacing:.01em}
.idea h3{font-size:14px;margin:1em 0 .2em;color:var(--text-secondary)}.idea p{margin:0 0 .5em}.kw a{display:inline-block;margin:0 6px 6px 0;padding:2px 10px;border:1px solid var(--border);border-radius:999px;font-size:13px;text-decoration:none;overflow-wrap:anywhere}
@media(max-width:640px){.glance,.proscons{grid-template-columns:minmax(0,1fr)}}`;
  function pcHtml(kind, title, items) {
    const body = items.length ? `<ul>${items.map((t) => `<li>${escapeHtml(t)}</li>`).join('')}</ul>` : '<p class="muted">추출된 항목이 없습니다.</p>';
    return `<section class="pc-col" data-kind="${kind}"><h4>${title} (${items.length})</h4>${body}</section>`;
  }
  function buildHtml(job) {
    const meta = (job.outline && job.outline.meta) || {};
    const title = meta.title_ko || meta.title_en || '논문';
    const view = job.summary ? toView(job.summary) : null;
    const authors = (meta.authors || []).join(', ');
    const venue = [meta.venue, meta.year].filter(Boolean).join(' · ');
    const out = [];
    out.push(`<header class="head"><h1>${escapeHtml(title)}</h1>${meta.title_en ? `<p class="en">${escapeHtml(meta.title_en)}</p>` : ''}${authors ? `<p class="sub">${escapeHtml(authors)}</p>` : ''}${venue ? `<p class="sub">${escapeHtml(venue)}</p>` : ''}<p class="sub">${escapeHtml(job.model)} · ${escapeHtml(fmtDate(job.createdAt))}</p></header>`);
    out.push('<section><h1>요약</h1>');
    if (!view) {
      out.push('<p class="muted">요약이 생성되지 않았습니다.</p>');
    } else {
      out.push(`<p class="tldr"><strong>한 줄 요약</strong> ${escapeHtml(view.tldr)}</p>`);
      out.push(`<ol class="glance"><li><b>문제</b>${escapeHtml(view.glance.problem)}</li><li><b>방법</b>${escapeHtml(view.glance.method)}</li><li><b>결과</b>${escapeHtml(view.glance.result)}</li></ol>`);
      out.push(`<h2>문제정의</h2><div class="md md--sum">${renderMarkdown(view.sections.problem_definition)}</div>`);
      out.push(`<h2>해결방법(제안 기법)</h2><div class="md md--sum">${renderMarkdown(view.sections.proposed_method)}</div>`);
      if (view.pipeline.length) out.push(`<h3>제안 기법 처리 흐름</h3><ol class="steps">${view.pipeline.map((p, i) => `<li><span class="n">${i + 1}</span><div><strong>${escapeHtml(p.name)}</strong> ${escapeHtml(p.desc)}</div></li>`).join('')}</ol>`);
      out.push(`<h2>결과 및 장점</h2><div class="md md--sum">${renderMarkdown(view.sections.results_and_strengths)}</div>`);
      if (view.metrics.length) {
        const tbody = el('tbody', {}, view.metrics.map(metricRow));
        out.push(`<h3>주요 성능 지표</h3><p class="legend"><span><i class="s1"></i>제안 기법</span><span><i class="s0"></i>비교 기준</span></p><div class="table-wrap"><table class="metrics-table"><thead><tr><th>지표</th><th class="num">비교 기준</th><th class="num">제안 기법</th><th>비교 바</th><th>변화</th><th>출처</th></tr></thead>${tbody.outerHTML}</table></div>`);
      }
      if (view.hasScores) out.push(`<h3>논문 평가 점수 (1~5, GPT 추정)</h3><table class="score-table"><thead><tr><th>항목</th><th class="num">점수</th><th>근거</th></tr></thead><tbody>${RADAR_AXES.map(([k, label]) => `<tr><td>${label}</td><td class="num">${view.scores[k].score == null ? '—' : `${view.scores[k].score} / 5`}</td><td>${escapeHtml(view.scores[k].rationale)}</td></tr>`).join('')}</tbody></table>`);
      out.push(`<h2>단점 및 한계점</h2><div class="md md--sum">${renderMarkdown(view.sections.weaknesses_and_limitations)}</div>`);
      if (view.strengths.length || view.limitations.length) out.push(`<div class="proscons">${pcHtml('pro', '장점', view.strengths)}${pcHtml('con', '한계점', view.limitations)}</div>`);
      const techLang = isEnglish(view.sections.core_technology) ? ' lang="en"' : '';
      out.push(`<h2>핵심기술</h2><div class="md md--sum"${techLang}>${renderMarkdown(view.sections.core_technology)}</div>`);
      if (view.coreTech.length) out.push(`<ul class="tech">${view.coreTech.map((t) => `<li><strong${isEnglish(t.name) ? ' lang="en"' : ''}>${escapeHtml(t.name)}</strong> <span class="muted">(${TECH_CATS[t.category]})</span> <span${isEnglish(t.role + t.desc) ? ' lang="en"' : ''}>${escapeHtml([t.role, t.desc].filter(Boolean).join(' '))}</span></li>`).join('')}</ul>`);
    }
    out.push('</section><section><h1>전문 번역</h1>');
    for (const s of exportSections(job)) {
      const heading = /^#/.test(s.text.trimStart()) ? '' : `<h2>${escapeHtml(s.title)}</h2>`;
      out.push(`<article class="sec">${heading}${s.text ? `<div class="md">${renderMarkdown(s.text)}</div>` : `<p class="muted">(번역 없음${s.status === 'failed' ? ' · 실패' : ''})</p>`}</article>`);
    }
    out.push('</section><section><h1>주제 제안</h1>', ideasHtml(job), '</section>');
    const katexOpts = JSON.stringify(KATEX_OPTS).replace(/</g, '\\u003c');
    return `<!doctype html>\n<html lang="ko">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>${escapeHtml(title)}</title>\n<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/KaTeX/0.19.0/katex.min.css">\n<style>${EXPORT_CSS}</style>\n</head>\n<body>\n<main>${out.join('\n')}</main>\n<script src="https://cdnjs.cloudflare.com/ajax/libs/KaTeX/0.19.0/katex.min.js"><\/script>\n<script src="https://cdnjs.cloudflare.com/ajax/libs/KaTeX/0.19.0/contrib/auto-render.min.js"><\/script>\n<script>if (typeof renderMathInElement === 'function') renderMathInElement(document.body, ${katexOpts});<\/script>\n</body>\n</html>\n`;
  }
  async function doExport(kind) {
    const job = currentJob();
    if (!job) return;
    const meta = (job.outline && job.outline.meta) || {};
    const base = sanitizeFilename(meta.title_ko || meta.title_en || '논문');
    try {
      if (kind === 'md') downloadBlob(`${base}.md`, buildMarkdown(job, {}), 'text/markdown;charset=utf-8');
      else if (kind === 'html') downloadBlob(`${base}.html`, buildHtml(job), 'text/html;charset=utf-8');
      else { await copyText(buildMarkdown(job, { summaryOnly: kind === 'copy-summary' })); toast('클립보드에 복사했습니다'); }
    } catch { toast('내보내기에 실패했습니다.', 'error'); }
  }

  const TABS = ['summary', 'translation', 'ideas', 'source'];
  const ROUTE_RE = /^#(home|result\/([A-Za-z0-9_-]+)(?:\/(summary|translation|ideas|source))?|settings)$/;
  function navigate(hash) {
    if (location.hash === hash) onHashChange(); else location.hash = hash;
  }
  function onHashChange() {
    if (!location.hash) history.replaceState(null, '', '#home');
    const m = ROUTE_RE.exec(location.hash || '#home');
    if (!m) return;
    closeExportMenu();
    if (m[1] === 'settings') { history.replaceState(null, '', state.lastHash); openSettings(); return; }
    if (m[1] === 'home') { state.lastHash = '#home'; showView('home'); return; }
    state.lastHash = location.hash;
    openResult(m[2], m[3] || 'summary');
  }
  function showView(name) {
    $('view-home').hidden = name !== 'home';
    $('view-result').hidden = name !== 'result';
    if (name === 'home') { state.currentJobId = null; destroyRadar(); renderHistory(); }
  }
  async function openResult(id, tab) {
    let job = state.jobs[id];
    if (!job) {
      const loaded = await store.loadJob(id);
      if (!loaded) { toast('기록을 찾을 수 없습니다.', 'error'); navigate('#home'); return; }
      job = reviveJob(loaded);
      state.jobs[id] = job;
    }
    showView('result');
    const changed = state.currentJobId !== id;
    state.currentJobId = id;
    if (changed) renderJob(job);
    selectTab(tab, true);
  }
  function selectTab(tab, fromRoute) {
    state.currentTab = tab;
    for (const t of TABS) {
      $(`tab-${t}`).setAttribute('aria-selected', String(t === tab));
      $(`panel-${t}`).hidden = t !== tab;
    }
    const job = currentJob();
    if (job && !fromRoute) { state.lastHash = `#result/${job.id}/${tab}`; history.replaceState(null, '', state.lastHash); }
    if (tab === 'translation') { flushDirtyRenders(); if (job) renderPdfPane(job); scheduleSpy(); }
    if (tab === 'source' && job) renderSourcePanel(job);
  }

  function openGate(message) {
    const err = $('gate-error');
    err.hidden = !message;
    err.textContent = message || '';
    $('api-key').value = '';
    $('api-key').disabled = false;
    $('btn-login').disabled = true;
    const loopback = isLoopbackHttp();
    setChatGPTBusy(false);
    $('chatgpt-hint').hidden = loopback;
    const cancellable = anySession();
    const dlg = $('gate');
    dlg.dataset.cancellable = cancellable ? '1' : '0';
    $('btn-gate-close').hidden = !cancellable;
    if (!dlg.open) dlg.showModal();
  }
  function closeGate() { const d = $('gate'); if (d.open) d.close(); }
  function showGateError(msg) { const e = $('gate-error'); e.textContent = msg; e.hidden = false; }
  function setGateBusy(busy) {
    const btn = $('btn-login');
    clear(btn);
    if (busy) btn.append(el('span', { class: 'spinner', 'aria-hidden': 'true' }), ' 키 확인 중…'); else btn.textContent = '로그인';
    btn.disabled = busy || !$('api-key').value.trim();
    $('api-key').disabled = busy;
  }
  async function login(key) {
    setGateBusy(true);
    try {
      const res = await fetch(`${API_BASE}/v1/models`, { headers: { Authorization: `Bearer ${key}` } });
      if (res.status === 401) return showGateError(MSG.key401);
      if (res.status === 403) return showGateError(MSG.key403);
      if (res.status === 429) return showGateError(MSG.key429);
      if (!res.ok) return showGateError(`확인 중 문제가 발생했습니다 (HTTP ${res.status}). 다시 시도해 주세요.`);
      let ids = [];
      try { ids = filterModels((await res.json()).data); } catch { ids = []; }
      if (state.run && (isPlan() || key !== state.apiKey)) cancelJob(state.jobs[state.run.jobId]);
      if (hasPlanSession() && !(await logoutChatGPT())) toast(MSG.cgRevokeFail, 'error');
      state.apiKey = key;
      ls.setRaw(LS.apiKey, key);
      ls.setRaw(LS.authMode, 'key');
      state.settings.modelsCache = { at: Date.now(), ids };
      saveSettings();
      updateAuthUI();
      closeGate();
      toast('로그인되었습니다');
    } catch {
      showGateError(MSG.network);
    } finally {
      setGateBusy(false);
    }
  }
  async function refreshModels() {
    if (isPlan()) return refreshModelsPlan(false);
    const c = state.settings.modelsCache;
    if (c && c.at && Date.now() - c.at < 86400000) return;
    try {
      const data = await (await apiFetch('/v1/models')).json();
      state.settings.modelsCache = { at: Date.now(), ids: filterModels(data.data) };
      saveSettings();
      populateModelSelects();
    } catch (e) {
      if (e && e.status === 401) handleAuthFailure();
    }
  }
  async function refreshModelsPlan(force) {
    const c = state.settings.modelsCachePlan;
    if (!force && c && c.at && Date.now() - c.at < 86400000 && Array.isArray(c.list) && c.list.length) { populateModelSelects(); return; }
    let data;
    try {
      data = await (await apiFetch('/v1/models')).json();
    } catch (e) {
      if (e && e.status === 401) { handleAuthFailure(); return; }
      state.planModelsError = describeModelsError(e);
      populateModelSelects();
      toast(`${MSG.cgModelsEmpty}: ${state.planModelsError}`, 'error');
      return;
    }
    const list = filterPlanModels(data);
    state.planModelsError = list.length ? '' : `응답에 사용할 수 있는 모델이 없습니다 (${describeCatalog(data)})`;
    state.settings.modelsCachePlan = { at: Date.now(), list };
    saveSettings();
    populateModelSelects();
    if (!list.length) toast(`${MSG.cgModelsEmpty}: ${state.planModelsError}`, 'error');
  }
  async function retryPlanModels() {
    const buttons = ['btn-models-retry', 'btn-models-refresh'].map($);
    for (const b of buttons) b.disabled = true;
    try { await refreshModelsPlan(true); }
    finally { for (const b of buttons) b.disabled = false; }
  }
  function updateAuthUI() {
    const plan = isPlan();
    const st = planStatus();
    const accountText = $('account-text');
    if (accountText) accountText.textContent = plan && st.connected ? `ChatGPT · ${st.email || ''}`.trim() : 'OpenAI API 키';
    const usageLink = $('account-usage-link');
    if (usageLink) usageLink.hidden = !(plan && st.connected);
    populateModelSelects();
  }
  async function logout() {
    if (isPlan()) {
      const ok = await confirmDialog({ title: '로그아웃', body: 'ChatGPT 연결을 해제할까요? 분석 기록과 설정은 유지됩니다.', ok: '연결 해제' });
      if (!ok) return;
      if (state.run) cancelJob(state.jobs[state.run.jobId]);
      const revokeOk = await logoutChatGPT();
      if (!revokeOk) toast(MSG.cgRevokeFail, 'error');
      toast('로그아웃되었습니다');
      updateAuthUI();
      openGate();
      return;
    }
    const ok = await confirmDialog({ title: '로그아웃', body: '저장된 API 키를 이 브라우저에서 삭제할까요? 분석 기록과 설정은 유지됩니다.', ok: '키 삭제' });
    if (!ok) return;
    if (state.run) cancelJob(state.jobs[state.run.jobId]);
    if (hasPlanSession() && !(await logoutChatGPT())) toast(MSG.cgRevokeFail, 'error');
    state.apiKey = '';
    ls.remove(LS.apiKey);
    toast('로그아웃되었습니다');
    updateAuthUI();
    openGate();
  }
  function onChatGPTClick() {
    if (!isLoopbackHttp()) return;
    if (location.hostname !== '127.0.0.1') {
      const u = new URL(location.href);
      u.hostname = '127.0.0.1';
      u.searchParams.set('chatgpt', 'start');
      location.assign(u.href);
      return;
    }
    startChatGPT({});
  }
  function bindGate() {
    const dlg = $('gate');
    const input = $('api-key');
    dlg.addEventListener('cancel', (e) => { if (dlg.dataset.cancellable !== '1') e.preventDefault(); });
    dlg.addEventListener('keydown', (e) => { if (e.key === 'Escape' && dlg.dataset.cancellable !== '1') e.preventDefault(); });
    input.addEventListener('input', () => { $('btn-login').disabled = !input.value.trim(); $('gate-error').hidden = true; });
    $('btn-key-toggle').addEventListener('click', () => {
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      $('btn-key-toggle').setAttribute('aria-pressed', String(show));
    });
    $('gate-form').addEventListener('submit', (e) => { e.preventDefault(); const key = input.value.trim(); if (key) login(key); });
    $('btn-chatgpt').addEventListener('click', onChatGPTClick);
    $('btn-gate-close').addEventListener('click', () => { if (dlg.dataset.cancellable === '1') closeGate(); });
  }

  function populateModelSelects() {
    const list = availableModels();
    const cur = currentModel();
    for (const id of ['model-select', 'set-model']) {
      const sel = clear($(id));
      for (const m of list) sel.append(el('option', { value: m.id, text: m.label }));
      sel.value = cur;
    }
    $('model-badge').textContent = cur ? modelLabel(cur) : '-';
    updateModelHelp(list.length);
    updateStartState();
  }
  function modelsEmptyText() { return state.planModelsError ? `${MSG.cgModelsEmpty}: ${state.planModelsError}` : `${MSG.cgModelsEmpty}.`; }
  function updateModelHelp(count) {
    const plan = isPlan();
    const empty = plan && !count;
    $('set-model-help').textContent = plan ? (count ? 'ChatGPT 플랜에서 사용할 수 있는 모델 목록입니다.' : modelsEmptyText()) : '요약·번역 모두 이 모델을 사용합니다.';
    $('btn-models-refresh').hidden = !plan;
    $('model-help').hidden = !empty;
    $('model-help-text').textContent = empty ? modelsEmptyText() : '';
  }
  function openSettings() {
    const s = state.settings;
    updateAuthUI();
    for (const r of document.querySelectorAll('#set-effort input')) r.checked = r.value === s.effort;
    $('set-concurrency').value = String(s.concurrency);
    $('set-concurrency-value').textContent = String(s.concurrency);
    for (const r of document.querySelectorAll('#set-theme input')) r.checked = r.value === s.theme;
    for (const r of document.querySelectorAll('#set-fontscale input')) r.checked = r.value === s.fontScale;
    const dlg = $('settings');
    if (!dlg.open) dlg.showModal();
  }
  function bindSettings() {
    $('btn-settings').addEventListener('click', openSettings);
    $('model-badge').addEventListener('click', openSettings);
    $('btn-logout').addEventListener('click', logout);
    $('btn-switch-auth').addEventListener('click', () => { const dlg = $('settings'); if (dlg.open) dlg.close(); openGate(); });
    $('btn-models-refresh').addEventListener('click', retryPlanModels);
    $('btn-models-retry').addEventListener('click', retryPlanModels);
    $('set-model').addEventListener('change', () => {
      const v = $('set-model').value;
      if (isPlan()) state.settings.modelPlan = v; else state.settings.model = v;
      saveSettings();
      populateModelSelects();
    });
    $('set-effort').addEventListener('change', (e) => { if (e.target.name === 'effort') { state.settings.effort = e.target.value; saveSettings(); } });
    $('set-concurrency').addEventListener('input', () => {
      state.settings.concurrency = clamp(parseInt($('set-concurrency').value, 10) || 3, 1, 5);
      $('set-concurrency-value').textContent = String(state.settings.concurrency);
      saveSettings();
    });
    $('set-theme').addEventListener('change', (e) => { if (e.target.name === 'theme') { state.settings.theme = e.target.value; saveSettings(); applyTheme(); } });
    $('set-fontscale').addEventListener('change', (e) => { if (e.target.name === 'fontscale') { state.settings.fontScale = e.target.value; saveSettings(); applyFontScale(); } });
    $('btn-settings-reset').addEventListener('click', () => {
      state.settings = { ...DEFAULT_SETTINGS, modelsCache: state.settings.modelsCache, modelsCachePlan: state.settings.modelsCachePlan };
      saveSettings();
      applyTheme();
      applyFontScale();
      openSettings();
      toast('기본값으로 되돌렸습니다');
    });
  }

  function validateFile(f) {
    if (!(f.type === 'application/pdf' || /\.pdf$/i.test(f.name))) return MSG.pdfOnly;
    if (f.size > MAX_FILE_BYTES) return MSG.fileTooBig;
    return '';
  }
  function showUrlError(msg) { const e = $('url-error'); e.textContent = msg; e.hidden = false; }
  function setPendingFile(f) {
    if (f) { const err = validateFile(f); if (err) { showUrlError(err); return; } }
    state.pendingFile = f || null;
    $('dz-idle').hidden = !!f;
    $('dz-file').hidden = !f;
    if (f) $('dz-file-name').textContent = `📄 ${f.name} · ${fmtBytes(f.size)}`;
    $('url-input').disabled = !!f;
    $('url-error').hidden = true;
    updateStartState();
  }
  function updateStartState() {
    const hasUrl = !!$('url-input').value.trim();
    const dz = $('dropzone');
    if (hasUrl && !state.pendingFile) dz.setAttribute('aria-disabled', 'true'); else dz.removeAttribute('aria-disabled');
    $('btn-start').disabled = !(hasUrl || state.pendingFile) || !!state.starting || !currentModel();
  }
  function setStarting(on) {
    state.starting = on;
    $('btn-start').textContent = on ? '확인 중…' : '분석 시작';
    updateStartState();
  }
  async function onStart() {
    if (!hasActiveAuth()) { openGate(); return; }
    if (state.starting) return;
    if (state.run) {
      const ok = await confirmDialog({ title: '새 분석 시작', body: '진행 중인 분석을 중단하고 새로 시작할까요?', ok: '중단하고 시작' });
      if (!ok) return;
      cancelJob(state.jobs[state.run.jobId]);
    }
    const file = state.pendingFile;
    let source;
    if (file) {
      source = { type: 'file', fileName: file.name, fileSize: file.size };
    } else {
      const raw = $('url-input').value.trim();
      if (!raw) { showUrlError(MSG.urlScheme); return; }
      setStarting(true);
      try {
        const n = await resolveSource(raw);
        if (n.kind !== 'pdf') { showUrlError(n.reason || MSG.unsupported); return; }
        source = { type: 'url', inputUrl: raw, pdfUrl: n.pdfUrl, landingUrl: n.landingUrl || n.pdfUrl, iframeOk: !!n.iframeOk, site: n.site || '', arxivId: n.arxivId || '' };
      } catch (e) {
        showUrlError((e && e.message) || MSG.unsupported);
        return;
      } finally {
        setStarting(false);
      }
    }
    setPendingFile(null);
    $('url-input').value = '';
    updateStartState();
    startJob(source, file);
  }
  function bindHome() {
    const url = $('url-input');
    const dz = $('dropzone');
    const fileInput = $('file-input');
    if (navigator.clipboard && navigator.clipboard.readText) {
      $('btn-paste').hidden = false;
      $('btn-paste').addEventListener('click', async () => {
        try { url.value = (await navigator.clipboard.readText()).trim(); url.dispatchEvent(new Event('input')); }
        catch { toast('클립보드를 읽을 수 없습니다.', 'error'); }
      });
    }
    url.addEventListener('input', () => { $('url-error').hidden = true; updateStartState(); });
    const pick = () => { if (!dz.getAttribute('aria-disabled')) fileInput.click(); };
    dz.addEventListener('click', pick);
    dz.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
    const dzLabel = $('dz-idle').querySelector('strong');
    const dzIdleText = dzLabel.textContent;
    const dzDisabled = () => dz.getAttribute('aria-disabled') === 'true';
    for (const ev of ['dragenter', 'dragover']) dz.addEventListener(ev, (e) => {
      e.preventDefault();
      if (dzDisabled()) { if (e.dataTransfer) e.dataTransfer.dropEffect = 'none'; return; }
      dz.dataset.over = '1';
      dzLabel.textContent = '여기에 놓으세요';
    });
    for (const ev of ['dragleave', 'drop']) dz.addEventListener(ev, (e) => { e.preventDefault(); dz.dataset.over = '0'; dzLabel.textContent = dzIdleText; });
    dz.addEventListener('drop', (e) => { if (dzDisabled()) return; const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]; if (f) setPendingFile(f); });
    fileInput.addEventListener('change', () => { const f = fileInput.files && fileInput.files[0]; if (f) setPendingFile(f); fileInput.value = ''; });
    $('btn-file-remove').addEventListener('click', (e) => { e.stopPropagation(); setPendingFile(null); });
    $('model-select').addEventListener('change', () => {
      const v = $('model-select').value;
      if (isPlan()) state.settings.modelPlan = v; else state.settings.model = v;
      saveSettings();
      populateModelSelects();
    });
    $('analyze-form').addEventListener('submit', (e) => { e.preventDefault(); onStart(); });
    $('btn-history-clear').addEventListener('click', async () => {
      const ok = await confirmDialog({ title: '기록 전체 삭제', body: '모든 분석 기록을 삭제할까요? 되돌릴 수 없습니다.', ok: '삭제' });
      if (!ok) return;
      store.saveHistory([]);
      await store.clearJobs();
      for (const id of Object.keys(state.jobs)) releaseJob(id);
      renderHistory();
      toast('모든 기록을 삭제했습니다');
    });
  }

  function stepFont(dir) {
    const i = clamp(FONT_ORDER.indexOf(state.settings.fontScale) + dir, 0, FONT_ORDER.length - 1);
    state.settings.fontScale = FONT_ORDER[i];
    saveSettings();
    applyFontScale();
  }
  function setSbs(on) {
    state.sbs = on;
    try { sessionStorage.setItem('rpt.sbs', on ? '1' : '0'); } catch {}
    $('side-by-side').checked = on;
    $('tr-layout').dataset.sbs = on ? '1' : '0';
    const job = currentJob();
    if (job) renderPdfPane(job); else $('pdf-pane').hidden = !on;
  }
  function toggleExportMenu() {
    const list = $('export-list');
    const open = list.hidden;
    list.hidden = !open;
    $('btn-export').setAttribute('aria-expanded', String(open));
  }
  function closeExportMenu() {
    $('export-list').hidden = true;
    $('btn-export').setAttribute('aria-expanded', 'false');
  }
  function stepSection(job, dir) {
    const cards = [...document.querySelectorAll('#tr-main .section-card')];
    if (!cards.length) return;
    const line = readingLine();
    let current = -1;
    cards.forEach((c, i) => { if (c.getBoundingClientRect().top <= line) current = i; });
    scrollToNode(cards[clamp(current + dir, 0, cards.length - 1)]);
  }
  function bindResult() {
    for (const t of TABS) $(`tab-${t}`).addEventListener('click', () => selectTab(t));
    $('limit-switch-key').addEventListener('click', () => { const job = currentJob(); if (job) { job.limitHit = false; renderProgress(job); } openGate(); });
    $('btn-cancel').addEventListener('click', () => { const job = currentJob(); if (job) cancelJob(job); });
    $('btn-retry-all').addEventListener('click', () => { const job = currentJob(); if (job) retryFailed(job); });
    $('btn-retry-failed').addEventListener('click', () => { const job = currentJob(); if (job) retryFailed(job); });
    $('btn-summary-retry').addEventListener('click', () => { const job = currentJob(); if (job) regenerateSummary(job); });
    $('pros-anchor').addEventListener('click', (e) => { e.preventDefault(); $('viz-proscons').scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' }); });
    $('btn-progress-toggle').addEventListener('click', () => {
      const strip = $('progress-strip');
      const expand = strip.dataset.collapsed === '1';
      strip.dataset.userExpanded = expand ? '1' : '0';
      strip.dataset.collapsed = expand ? '0' : '1';
      $('btn-progress-toggle').textContent = expand ? '접기' : '자세히';
    });
    $('btn-export').addEventListener('click', (e) => { e.stopPropagation(); toggleExportMenu(); });
    $('export-list').addEventListener('click', (e) => { const b = e.target.closest('button[data-export]'); if (!b) return; closeExportMenu(); doExport(b.dataset.export); });
    document.addEventListener('click', (e) => { if (!$('export-menu').contains(e.target)) closeExportMenu(); });
    $('side-by-side').addEventListener('change', () => setSbs($('side-by-side').checked));
    $('raw-math').addEventListener('change', () => {
      state.rawMath = $('raw-math').checked;
      const job = currentJob();
      if (job) { renderTranslation(job); renderSummary(job); renderIdeas(job); }
    });
    $('btn-font-dec').addEventListener('click', () => stepFont(-1));
    $('btn-font-inc').addEventListener('click', () => stepFont(1));
    $('btn-toc-top').addEventListener('click', () => window.scrollTo({ top: 0, behavior: reducedMotion() ? 'auto' : 'smooth' }));
    $('toc-list').addEventListener('click', onTocClick);
    window.addEventListener('scroll', scheduleSpy, { passive: true });
    window.addEventListener('resize', scheduleSpy);
    $('panel-ideas').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-ideas-action]');
      const job = currentJob();
      if (b && job) regenerateIdeas(job);
    });
    $('btn-source-reselect').addEventListener('click', () => $('source-file-input').click());
    $('source-file-input').addEventListener('change', () => {
      const input = $('source-file-input');
      const f = input.files && input.files[0];
      input.value = '';
      const job = currentJob();
      if (!f || !job) return;
      const err = validateFile(f);
      if (err) { toast(err, 'error'); return; }
      if (job.source.blobUrl) URL.revokeObjectURL(job.source.blobUrl);
      job.source.blobUrl = URL.createObjectURL(f);
      fileCache.set(job.id, f);
      renderSourcePanel(job);
      renderPdfPane(job);
      renderHeader(job);
    });
  }
  function bindKeyboard() {
    document.addEventListener('keydown', (e) => {
      const t = e.target;
      const inField = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
      const mod = e.metaKey || e.ctrlKey;
      const modalOpen = !!document.querySelector('dialog[open]');
      if (mod && e.key === 'Enter') { if (!modalOpen && !$('view-home').hidden && !$('btn-start').disabled) { e.preventDefault(); onStart(); } return; }
      if (mod && e.shiftKey && e.key.toLowerCase() === 'c') { if (!modalOpen && currentJob()) { e.preventDefault(); doExport('copy-all'); } return; }
      if (e.key === 'Escape') { closeExportMenu(); return; }
      if (inField || mod || e.altKey || modalOpen) return;
      const job = currentJob();
      switch (e.key) {
        case '/': if (!$('view-home').hidden) { e.preventDefault(); $('url-input').focus(); } break;
        case ',': e.preventDefault(); openSettings(); break;
        case '1': if (job) selectTab('summary'); break;
        case '2': if (job) selectTab('translation'); break;
        case '3': if (job) selectTab('ideas'); break;
        case '4': if (job) selectTab('source'); break;
        case '[': case ']': if (job && state.currentTab === 'translation') { e.preventDefault(); stepSection(job, e.key === ']' ? 1 : -1); } break;
        case 't': if (job && state.currentTab === 'translation') { const a = document.querySelector('#toc-list a'); if (a) a.focus(); } break;
        case 's': if (job && state.currentTab === 'translation' && !narrowScreen()) setSbs(!state.sbs); break;
        default: break;
      }
    });
  }
  function bindLifecycle() {
    window.addEventListener('beforeunload', (e) => { if (state.run) { e.preventDefault(); e.returnValue = '분석이 진행 중입니다. 나가면 중단됩니다.'; } });
    const flush = () => { if (state.run) { const job = state.jobs[state.run.jobId]; if (job) persist(job); } };
    document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); else flushDirtyRenders(); });
    window.addEventListener('pagehide', flush);
    if (window.matchMedia) {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      const onTheme = () => { if (state.settings.theme === 'auto' && state.radarChart) rebuildRadar(); };
      if (mq.addEventListener) mq.addEventListener('change', onTheme);
    }
  }

  async function startAuthFlow() {
    const params = new URLSearchParams(location.search);
    if (params.get('state') && (params.get('code') || params.get('error'))) {
      await handleAuthCallback();
      onHashChange();
      return;
    }
    if (params.get('chatgpt') === 'start') {
      const u = new URL(location.href);
      u.searchParams.delete('chatgpt');
      try { history.replaceState(null, '', u.pathname + u.search + u.hash); } catch {}
      onHashChange();
      openGate();
      if (isLoopbackHttp()) startChatGPT({});
      return;
    }
    if (isPlan() ? hasPlanSession() : hasApiKeySession()) { updateAuthUI(); refreshModels(); }
    else openGate();
    onHashChange();
  }

  function init() {
    state.browserId = ensureBrowserId();
    applyTheme();
    applyFontScale();
    try { state.sbs = sessionStorage.getItem('rpt.sbs') === '1'; } catch { state.sbs = false; }
    bindGate();
    bindHome();
    bindSettings();
    bindResult();
    bindKeyboard();
    bindLifecycle();
    const key = ls.getRaw(LS.apiKey);
    if (key) state.apiKey = key;
    populateModelSelects();
    renderHistory();
    updateStartState();
    $('side-by-side').checked = state.sbs;
    $('tr-layout').dataset.sbs = state.sbs ? '1' : '0';
    window.addEventListener('hashchange', onHashChange);
    startAuthFlow();
  }

  window.RPT = Object.freeze({ version: VERSION, normalizeUrl, buildChunks, renderMarkdown, store, state, auth: { status: planStatus } });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
