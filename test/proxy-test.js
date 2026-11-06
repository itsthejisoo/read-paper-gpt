const http = require('http');
const net = require('net');
const path = require('path');
const zlib = require('zlib');
const { spawn } = require('child_process');

const SERVE_PY = process.env.SERVE_PY || path.resolve(__dirname, '..', 'serve.py');
const SERVE_CMD = process.env.SERVE_CMD || '';
const SERVE_ARGS = (process.env.SERVE_ARGS || '').split(' ').filter(Boolean);
const NATIVE = SERVE_CMD !== '';
const VERSION = process.env.SERVE_VERSION || '1.2.0';
const APP_DIR = process.env.APP_DIR || path.resolve(__dirname, '..');
const TOKEN = 'test-token-123';
const SSE = 'data: {"type":"a"}\n\ndata: {"type":"b"}\n\ndata: [DONE]\n\n';
const ERR_BODY = { error: { code: 'subscription_sharing_user_not_eligible', message: 'not eligible' } };
const HEALTH = { ok: true, proxy: true, version: VERSION };

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok });
  console.log(`== ${name}: ${ok ? 'ok' : 'FAIL ' + JSON.stringify(detail === undefined ? null : detail).slice(0, 400)}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const parseJson = (s) => { try { return JSON.parse(s); } catch { return null; } };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const readBody = (req) => new Promise((resolve) => { let raw = ''; req.on('data', (d) => { raw += d; }); req.on('end', () => resolve(raw)); });
const listen = (server) => new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', () => resolve(server.address().port)));

function sendJson(res, status, obj) {
  const data = JSON.stringify(obj);
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) });
  res.end(data);
}

const closed = { slow: 0, slowhead: 0 };
const upstream = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://upstream');
  const route = `${req.method} ${u.pathname}`;
  const watched = { 'POST /v1/slow': 'slow', 'POST /v1/slowhead': 'slowhead' }[route];
  if (watched) res.on('close', () => { closed[watched] = closed[watched] || Date.now(); });
  const raw = await readBody(req);
  if (route === 'GET /v1/models') {
    return sendJson(res, 200, {
      authorization: req.headers.authorization || null, host: req.headers.host || null, acceptEncoding: req.headers['accept-encoding'] || null,
      userAgent: req.headers['user-agent'] || null, query: u.search, xSecret: req.headers['x-secret'] || null,
      cookie: req.headers.cookie || null, origin: req.headers.origin || null, referer: req.headers.referer || null,
    });
  }
  if (route === 'GET /v1/headers') {
    const data = JSON.stringify({ ok: true });
    res.writeHead(200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data), 'set-cookie': 'sid=1; Path=/', 'access-control-allow-origin': '*', connection: 'keep-alive', 'alt-svc': 'h3=":443"' });
    return res.end(data);
  }
  if (route === 'GET /v1/gzip') {
    const gz = zlib.gzipSync(JSON.stringify({ gz: true }));
    res.writeHead(200, { 'content-type': 'application/json', 'content-encoding': 'gzip', 'content-length': gz.length });
    return res.end(gz);
  }
  if (route === 'POST /v1/responses') {
    const body = parseJson(raw);
    if (!(body && body.stream)) return sendJson(res, 200, { echo: body, contentType: req.headers['content-type'] || null });
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write('data: {"type":"a"}\n\n');
    setTimeout(() => {
      res.write('data: {"type":"b"}\n\n');
      setTimeout(() => { res.write('data: [DONE]\n\n'); res.end(); }, 200);
    }, 200);
    return;
  }
  if (route === 'GET /v1/err') return sendJson(res, 403, ERR_BODY);
  if (route === 'POST /v1/slow') {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write('data: {"type":"slow"}\n\n');
    return;
  }
  if (route === 'POST /v1/slowhead') {
    setTimeout(() => { if (!res.destroyed) { res.writeHead(200, { 'content-type': 'text/event-stream' }); res.end('data: {"type":"late"}\n\n'); } }, 5000).unref();
    return;
  }
  if (route === 'DELETE /v1/files/x') return sendJson(res, 200, { deleted: true });
  sendJson(res, 404, { error: { code: 'upstream_not_found', message: route } });
});

function request(port, method, p, opts = {}) {
  const headers = { ...(opts.headers || {}), ...(opts.body != null && !opts.chunked ? { 'Content-Length': Buffer.byteLength(opts.body) } : {}) };
  return new Promise((resolve, reject) => {
    let destroyed = false;
    const abort = () => { destroyed = true; req.destroy(); };
    const req = http.request({ host: '127.0.0.1', port, method, path: p, headers, agent: false }, (res) => {
      const chunks = [];
      res.on('data', (d) => {
        chunks.push({ t: Date.now(), data: d.toString(), raw: d });
        if (opts.abortAfterFirstChunk && chunks.length === 1) setTimeout(abort, opts.abortAfterFirstChunk);
      });
      const finish = () => resolve({ status: res.statusCode, headers: res.headers, body: chunks.map((c) => c.data).join(''), raw: Buffer.concat(chunks.map((c) => c.raw)), chunks, aborted: destroyed });
      res.on('end', finish);
      res.on('close', finish);
    });
    req.setTimeout(opts.timeoutMs || 10000, () => req.destroy(new Error(`timeout ${method} ${p}`)));
    if (opts.abortAfterMs) setTimeout(abort, opts.abortAfterMs);
    req.on('error', (e) => (destroyed ? resolve({ aborted: true, error: e.code }) : reject(e)));
    if (opts.body != null) req.write(opts.body);
    req.end();
  });
}

async function disconnectEarly(port, p, times) {
  for (let i = 0; i < times; i++) {
    await new Promise((resolve) => {
      const sock = net.connect(port, '127.0.0.1', () => { sock.write(`GET ${p} HTTP/1.0\r\nHost: 127.0.0.1:${port}\r\n\r\n`); sock.destroy(); });
      sock.on('error', () => {});
      sock.on('close', resolve);
    });
  }
}

const children = new Set();
function startServe(args, env, pythonArgs) {
  const [cmd, argv] = pythonArgs ? ['python3', [...pythonArgs, ...args]] : NATIVE ? [SERVE_CMD, [...SERVE_ARGS, ...args]] : ['python3', [SERVE_PY, ...args]];
  const child = spawn(cmd, argv, { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  children.add(child);
  child.on('exit', () => children.delete(child));
  const log = { out: '' };
  child.stdout.on('data', (d) => { log.out += d; });
  child.stderr.on('data', (d) => { log.out += d; });
  const exited = new Promise((resolve) => child.on('exit', (code, signal) => resolve({ code, signal })));
  return { child, log, exited };
}

async function waitForPort(s) {
  for (let i = 0; i < 100; i++) {
    const m = /http:\/\/127\.0\.0\.1:(\d+)/.exec(s.log.out);
    if (m) return Number(m[1]);
    if (s.child.exitCode !== null) throw new Error('serve.py exited early: ' + s.log.out.slice(0, 300));
    await sleep(100);
  }
  throw new Error('serve.py did not print its URL');
}

async function waitHealth(port) {
  for (let i = 0; i < 100; i++) {
    const r = await request(port, 'GET', '/__rpt/health').catch(() => null);
    if (r && r.status === 200) return r;
    await sleep(100);
  }
  throw new Error('health check never answered');
}

async function stopServe(s) {
  if (s.child.exitCode === null) s.child.kill('SIGINT');
  const r = await Promise.race([s.exited, sleep(3000).then(() => null)]);
  if (r) return r;
  s.child.kill('SIGKILL');
  return s.exited;
}

const streamPost = (port) => request(port, 'POST', '/__rpt/openai/v1/responses', {
  headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'm', input: 'hi', stream: true }),
});

setTimeout(() => { console.log('RESULT: timeout'); for (const c of children) c.kill('SIGKILL'); process.exit(1); }, 90000).unref();

(async () => {
  const upPort = await listen(upstream);
  const s = startServe(['--port', '0', '--dir', APP_DIR], { RPT_UPSTREAM: `http://127.0.0.1:${upPort}` });
  const bh = startServe(['--port', '0', '--dir', APP_DIR], { RPT_UPSTREAM: 'http://203.0.113.1:9' });
  const blackhole = (async () => {
    const bhPort = await waitForPort(bh);
    const t0 = Date.now();
    const r = await request(bhPort, 'GET', '/__rpt/openai/v1/models', { headers: { Authorization: `Bearer ${TOKEN}` }, timeoutMs: 25000 });
    return { status: r.status, code: (parseJson(r.body) || {}).error?.code, ms: Date.now() - t0 };
  })().catch((e) => ({ error: e.message }));
  const silentSockets = new Set();
  let silentAccepted = 0;
  const silent = net.createServer((sock) => {
    silentAccepted += 1;
    silentSockets.add(sock);
    sock.on('error', () => {});
    sock.on('close', () => silentSockets.delete(sock));
  });
  let sv = null;
  const silentRun = NATIVE ? (async () => {
    const silentPort = await listen(silent);
    sv = startServe(['--port', '0', '--dir', APP_DIR], { RPT_UPSTREAM: `http://127.0.0.1:${silentPort}` });
    const svPort = await waitForPort(sv);
    const t0 = Date.now();
    const r = await request(svPort, 'GET', '/__rpt/openai/v1/models', { headers: { Authorization: `Bearer ${TOKEN}` }, timeoutMs: 25000 });
    return { status: r.status, code: (parseJson(r.body) || {}).error?.code, ms: Date.now() - t0, accepted: silentAccepted };
  })().catch((e) => ({ error: e.message })) : null;
  let crashed = false;
  try {
    const port = await waitForPort(s);
    const health = await waitHealth(port);
    check('health', same(parseJson(health.body), HEALTH) && health.headers['cache-control'] === 'no-store', { status: health.status, body: health.body, headers: health.headers });

    const foreign = await request(port, 'GET', '/__rpt/health', { headers: { Host: 'evil.example:8000' } });
    const foreignStatic = await request(port, 'GET', '/index.html', { headers: { Host: 'evil.example:8000' } });
    check('rejects-foreign-host-421', foreign.status === 421 && (parseJson(foreign.body) || {}).error?.code === 'proxy_misdirected' && foreignStatic.status === 421 && !foreignStatic.body.includes('id="gate"'), { rpt: foreign.status, static: foreignStatic.status });
    const hostLocal = await request(port, 'GET', '/__rpt/health', { headers: { Host: `localhost:${port}` } });
    const hostV6 = await request(port, 'GET', '/__rpt/health', { headers: { Host: `[::1]:${port}` } });
    check('accepts-loopback-hosts', hostLocal.status === 200 && hostV6.status === 200, { localhost: hostLocal.status, v6: hostV6.status });

    const index = await request(port, 'GET', '/index.html');
    check('static-index', index.status === 200 && index.body.includes('id="gate"') && /text\/html/.test(index.headers['content-type'] || ''), { status: index.status, headers: index.headers });

    const missing = await request(port, 'GET', '/no-such-file.html?code=z');
    check('static-404', missing.status === 404 && /text\/html/.test(missing.headers['content-type'] || ''), { status: missing.status, headers: missing.headers });
    const postStatic = await request(port, 'POST', '/index.html', { body: '{}' });
    check('static-post-501', postStatic.status === 501, { status: postStatic.status });

    const cb = await request(port, 'GET', '/auth/callback?code=x&state=y');
    check('callback-redirect-keeps-query', cb.status === 301 && cb.headers.location === '/auth/callback/?code=x&state=y', { status: cb.status, location: cb.headers.location });

    const get = await request(port, 'GET', '/__rpt/openai/v1/models?a=1', { headers: { Authorization: `Bearer ${TOKEN}`, 'X-Secret': '1', Cookie: 'sid=1', Origin: 'http://127.0.0.1:1', Referer: 'http://127.0.0.1:1/' } });
    const echo = parseJson(get.body) || {};
    check('relay-get-authorization', get.status === 200 && echo.authorization === `Bearer ${TOKEN}`, { status: get.status, echo });
    check('relay-get-host', echo.host === `127.0.0.1:${upPort}`, echo.host);
    check('relay-get-accept-encoding-identity', echo.acceptEncoding === 'identity', echo.acceptEncoding);
    check('relay-get-user-agent', echo.userAgent === `rpt-serve/${VERSION}`, echo.userAgent);
    check('relay-get-query', echo.query === '?a=1', echo.query);
    check('relay-drops-x-secret', echo.xSecret === null, echo.xSecret);
    check('relay-drops-cookie-origin-referer', echo.cookie === null && echo.origin === null && echo.referer === null, { cookie: echo.cookie, origin: echo.origin, referer: echo.referer });
    check('relay-response-headers', get.headers['cache-control'] === 'no-store' && get.headers['x-accel-buffering'] === 'no' && /application\/json/.test(get.headers['content-type'] || ''), get.headers);
    const hdr = await request(port, 'GET', '/__rpt/openai/v1/headers', { headers: { Authorization: `Bearer ${TOKEN}` } });
    const ownConnection = NATIVE ? hdr.headers.connection === 'close' : hdr.headers.connection === undefined;
    check('relay-strips-upstream-headers', hdr.status === 200 && hdr.headers['set-cookie'] === undefined && hdr.headers['access-control-allow-origin'] === undefined && hdr.headers['alt-svc'] === undefined && ownConnection, hdr.headers);
    const gz = await request(port, 'GET', '/__rpt/openai/v1/gzip', { headers: { Authorization: `Bearer ${TOKEN}` } });
    let inflated = null;
    try { inflated = JSON.parse(zlib.gunzipSync(gz.raw).toString()); } catch { inflated = null; }
    const decoded = NATIVE && gz.headers['content-encoding'] === undefined ? parseJson(gz.body) : null;
    const consistent = (gz.headers['content-encoding'] === 'gzip' && same(inflated, { gz: true })) || same(decoded, { gz: true });
    check('relay-keeps-content-encoding', gz.status === 200 && consistent, { status: gz.status, headers: gz.headers, inflated, decoded });

    const payload = { model: 'm', input: [{ role: 'user', content: '안녕' }], store: false, stream: false };
    const post = await request(port, 'POST', '/__rpt/openai/v1/responses', { headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const postEcho = parseJson(post.body) || {};
    check('relay-post-body', post.status === 200 && same(postEcho.echo, payload), { status: post.status, body: post.body });
    check('relay-post-content-type', postEcho.contentType === 'application/json', postEcho.contentType);
    const chunked = await request(port, 'POST', '/__rpt/openai/v1/responses', { headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload), chunked: true });
    check('chunked-body-411', chunked.status === 411 && (parseJson(chunked.body) || {}).error?.code === 'proxy_length_required', { status: chunked.status, body: chunked.body });

    const streamStart = Date.now();
    const st = await streamPost(port);
    const firstLag = st.chunks.length ? st.chunks[0].t - streamStart : null;
    const gap = st.chunks.length >= 2 ? st.chunks[1].t - st.chunks[0].t : null;
    check('stream-status', st.status === 200 && /text\/event-stream/.test(st.headers['content-type'] || ''), { status: st.status, headers: st.headers });
    check('stream-no-content-length', st.headers['content-length'] === undefined, st.headers);
    check('stream-body', st.body === SSE, st.body);
    check('stream-chunks-arrive-progressively', gap !== null && gap >= 150, { gap, chunks: st.chunks.map((c) => c.data) });
    check('stream-first-event-not-buffered', firstLag !== null && firstLag < 150 && st.chunks[0].data === 'data: {"type":"a"}\n\n' && st.chunks.length === 3, { firstLag, chunks: st.chunks.map((c) => c.data) });

    const err = await request(port, 'GET', '/__rpt/openai/v1/err', { headers: { Authorization: `Bearer ${TOKEN}` } });
    check('error-passthrough-403', err.status === 403 && same(parseJson(err.body), ERR_BODY), { status: err.status, body: err.body });

    const started = Date.now();
    const aborted = await request(port, 'POST', '/__rpt/openai/v1/slow', { headers: { Authorization: `Bearer ${TOKEN}` }, body: '{}', abortAfterFirstChunk: 300 });
    for (let i = 0; i < 30 && !closed.slow; i++) await sleep(100);
    check('abort-cancels-upstream', aborted.aborted === true && closed.slow > 0 && closed.slow - started < 3300, { aborted, closedAfterMs: closed.slow ? closed.slow - started : null });
    const startedHead = Date.now();
    const abortedHead = await request(port, 'POST', '/__rpt/openai/v1/slowhead', { headers: { Authorization: `Bearer ${TOKEN}` }, body: '{}', abortAfterMs: 300 });
    for (let i = 0; i < 20 && !closed.slowhead; i++) await sleep(50);
    check('abort-before-headers-cancels-upstream', abortedHead.aborted === true && abortedHead.status === undefined && closed.slowhead > 0 && closed.slowhead - startedHead < 1300, { aborted: abortedHead, closedAfterMs: closed.slowhead ? closed.slowhead - startedHead : null });

    const del = await request(port, 'DELETE', '/__rpt/openai/v1/files/x', { headers: { Authorization: `Bearer ${TOKEN}` } });
    check('relay-delete', del.status === 200 && same(parseJson(del.body), { deleted: true }), { status: del.status, body: del.body });

    const many = await Promise.all([streamPost(port), streamPost(port), streamPost(port)]);
    check('concurrent-streams', many.every((r) => r.status === 200 && r.body === SSE), many.map((r) => ({ status: r.status, len: r.body.length })));

    const other = await request(port, 'GET', '/__rpt/openai/other');
    check('relay-other-404', other.status === 404 && (parseJson(other.body) || {}).error?.code === 'proxy_not_found', { status: other.status, body: other.body });
    const traversal = await request(port, 'GET', '/__rpt/openai/v1/../../index.html');
    check('relay-traversal-404', traversal.status === 404 && !traversal.body.includes('id="gate"'), { status: traversal.status, body: traversal.body.slice(0, 120) });
    const nope = await request(port, 'GET', '/__rpt/nope');
    check('rpt-unknown-404', nope.status === 404 && (parseJson(nope.body) || {}).error?.code === 'proxy_not_found', { status: nope.status, body: nope.body });

    if (NATIVE) {
      const big = await request(port, 'POST', '/__rpt/openai/v1/responses', { headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', 'Content-Length': String(129 * 1024 * 1024) } });
      check('native-body-cap-413', big.status === 413 && (parseJson(big.body) || {}).error?.code === 'proxy_too_large', { status: big.status, body: big.body });
      const padding = {};
      for (let i = 0; i < 70; i++) padding[`X-Pad-${i}`] = 'x'.repeat(1000);
      const wide = await request(port, 'GET', '/__rpt/health', { headers: padding });
      check('native-header-cap-431', wide.status === 431, { status: wide.status, body: (wide.body || '').slice(0, 120) });
      const put = await request(port, 'PUT', '/index.html', { body: '{}' });
      check('native-put-501', put.status === 501 && /text\/html/.test(put.headers['content-type'] || ''), { status: put.status, headers: put.headers });
      const listing = await request(port, 'GET', '/test/');
      check('native-no-listing-no-store', listing.status === 404 && index.headers['cache-control'] === 'no-store', { listing: listing.status, indexCacheControl: index.headers['cache-control'] });
    } else {
      console.log('-- native-only checks skipped (SERVE_CMD not set)');
    }

    await disconnectEarly(port, '/__rpt/health', 60);
    await disconnectEarly(port, '/index.html', 60);
    await sleep(500);
    const afterDisconnects = await request(port, 'GET', '/__rpt/health');
    check('early-disconnect-no-traceback', afterDisconnects.status === 200 && !/Traceback/.test(s.log.out), { status: afterDisconnects.status, tail: s.log.out.slice(-300) });

    const plain = startServe(['--bind', '127.0.0.1', '0', '--directory', APP_DIR], {}, ['-u', '-m', 'http.server']);
    try {
      const plainPort = await waitForPort(plain);
      const shape = {};
      for (const [m, p] of [['GET', '/__rpt/health'], ['GET', '/__rpt/openai/v1/models'], ['POST', '/__rpt/openai/v1/responses'], ['DELETE', '/__rpt/openai/v1/files/x']]) {
        const r = await request(plainPort, m, p, { headers: { 'Content-Type': 'application/json' }, body: m === 'POST' ? '{}' : null });
        shape[`${m} ${p}`] = `${r.status} ${(r.headers['content-type'] || '').split(';')[0]}`;
      }
      check('plain-http-server-shape', same(shape, {
        'GET /__rpt/health': '404 text/html', 'GET /__rpt/openai/v1/models': '404 text/html',
        'POST /__rpt/openai/v1/responses': '501 text/html', 'DELETE /__rpt/openai/v1/files/x': '501 text/html',
      }), shape);
    } finally {
      await stopServe(plain);
    }

    const bad = startServe(['--bind', '0.0.0.0', '--port', '0', '--dir', APP_DIR], {});
    const badExit = await bad.exited;
    check('refuses-non-loopback-bind', badExit.code === 2 && bad.log.out.trim().length > 0, { exit: badExit, out: bad.log.out });

    upstream.closeAllConnections();
    await new Promise((resolve) => upstream.close(resolve));
    const down = await request(port, 'GET', '/__rpt/openai/v1/models', { headers: { Authorization: `Bearer ${TOKEN}` } });
    check('upstream-down-502', down.status === 502 && (parseJson(down.body) || {}).error?.code === 'proxy_upstream', { status: down.status, body: down.body });

    const bhr = await blackhole;
    check('upstream-blackhole-502-before-connect-timeout', bhr.status === 502 && bhr.code === 'proxy_upstream' && bhr.ms < 20000, bhr);
    if (silentRun) {
      const svr = await silentRun;
      check('native-upstream-silent-502-watchdog', svr.status === 502 && svr.code === 'proxy_upstream' && svr.accepted >= 1 && svr.ms < 20000, svr);
    }
  } catch (e) {
    crashed = true;
    console.log('RUN FAILED: ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e));
  } finally {
    const exit = await stopServe(s);
    await stopServe(bh);
    if (silentRun) await silentRun;
    if (sv) await stopServe(sv);
    for (const sock of silentSockets) sock.destroy();
    silent.close();
    upstream.closeAllConnections();
    upstream.close();
    check('serve-exits-quietly-on-sigint', exit.code === 0 && !/Traceback/.test(s.log.out), { exit, tail: s.log.out.slice(-300) });
    check('serve-log-has-no-token', [s, bh, sv].every((x) => !x || !x.log.out.includes(TOKEN)));
    check('serve-log-has-no-query', !/code=x|code=z|a=1/.test(s.log.out), s.log.out.slice(-300));
  }
  for (const c of children) c.kill('SIGKILL');
  const fails = results.filter((r) => !r.ok).map((r) => r.name);
  console.log(`RESULT: ${results.length - fails.length} ok, ${fails.length} failed ${JSON.stringify(fails)}`);
  process.exit(fails.length || crashed ? 1 : 0);
})();
