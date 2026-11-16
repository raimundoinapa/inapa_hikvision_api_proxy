// Proof for finding #7: capture refresh scheduler.
// Runs a throwaway copy of the app against a mock HikCentral.
// Production public/img/captures (590 files) is never touched.

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');

const ROOT = 'E:/inapa_hikvision_api_proxy';
const WORK = path.join(process.env.TEMP, 'opencode', 'finding-7');
const APP_DIR = path.join(WORK, 'app');
const APP_PORT = 3498;
const MOCK_PORT = 19090;
const APP_URL = `http://127.0.0.1:${APP_PORT}`;

const bcrypt = require(path.join(ROOT, 'node_modules/bcryptjs'));
const jwt = require(path.join(ROOT, 'node_modules/jsonwebtoken'));

const JWT_SECRET = 'finding-7-test-secret';
const TTL_MS = 60000;

const CAMERAS = ['101', '102', '103', '104'];
const captureCalls = Object.fromEntries(CAMERAS.map((id) => [id, 0]));

// ---------- mock HikCentral ----------
const mock = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    let body = {};
    try { body = raw ? JSON.parse(raw) : {}; } catch {}

    const send = (obj, status = 200) => {
      res.writeHead(status, {'Content-Type': 'application/json'});
      res.end(JSON.stringify(obj));
    };

    if (req.url.includes('/camera/advance/cameraList')) {
      return send({
        code: '0',
        msg: 'Success',
        total: CAMERAS.length,
        pageNo: 1,
        pageSize: 500,
        list: CAMERAS.map((id) => ({
          cameraIndexCode: id,
          cameraName: `Camera ${id}`,
          capabilitySet: 'event_pdc',
          encodeDevIndexCode: '1',
          regionIndexCode: '1',
          status: 1,
        })),
      });
    }

    if (req.url.includes('/encodeDevice/encodeDeviceList')) {
      return send({code: '0', msg: 'Success', total: 0, pageNo: 1, pageSize: 500, list: []});
    }

    if (req.url.includes('/resource/v1/regions')) {
      return send({code: '0', msg: 'Success', total: 1, pageNo: 1, pageSize: 500, list: [{indexCode: '1', parentIndexCode: '-1', name: 'Test'}]});
    }

    if (req.url.includes('/cameras/previewURLs')) {
      const ids = String(body.cameraIndexCodes || '').split(',').filter(Boolean);
      return send({code: '0', msg: 'Success', total: ids.length, list: ids.map((id) => ({url: `ws://mock/${id}`}))});
    }

    if (req.url.includes('/camera/capture')) {
      const id = String(body.cameraIndexCode || '');
      captureCalls[id] = (captureCalls[id] || 0) + 1;

      if ('103' === id) {
        return send({code: '1', msg: 'Capture failed', data: null});
      }

      return send({code: '0', msg: 'Success', data: `data:image/jpeg;base64,${Buffer.from(`capture-${id}`).toString('base64')}`});
    }

    return send({code: '1', msg: `Unhandled mock path: ${req.url}`, data: null}, 404);
  });
});

// ---------- helpers ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function prepareAppCopy() {
  fs.rmSync(APP_DIR, {recursive: true, force: true});
  fs.mkdirSync(path.join(APP_DIR, 'public', 'img', 'captures'), {recursive: true});

  for (const file of ['server.js', 'http-server.js', 'hikcentral.js', 'ldap-config.js', 'rate-limit.js']) {
    fs.copyFileSync(path.join(ROOT, file), path.join(APP_DIR, file));
  }

  fs.writeFileSync(path.join(APP_DIR, 'public', 'index.html'), '<h1>test</h1>');
}

let child = null;
let appLog = '';

function startApp(overrides = {}) {
  child = spawn(process.execPath, ['server.js'], {
    cwd: APP_DIR,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      PROTOCOL: 'http',
      PORT: String(APP_PORT),
      SERVER_IP: '127.0.0.1',
      HIKVISION_API_URL: `http://127.0.0.1:${MOCK_PORT}`,
      HIKVISION_PARTNER_KEY: 'mock-key',
      HIKVISION_PARTNER_SECRET: 'mock-secret',
      JWT_SECRET,
      JWT_EXPIRES_IN: '1h',
      ADMIN_USERNAME: 'admin',
      ADMIN_PASSWORD_HASH: bcrypt.hashSync('test-pass', 4),
      ADDITIONAL_USERS: '[]',
      LDAP_URLS: '[]',
      LDAP_BASEDN: 'DC=test,DC=local',
      LDAP_DOMAIN: 'TEST',
      LDAP_ALLOWED_CN: 'CCTV',
      SCREEN_ACCESS_KEY: 'test-screen-key',
      MIN_TIME_BETWEEN_CAPTURE_UPDATES: String(TTL_MS),
      // Node resolves the app's dependencies through NODE_PATH (no node_modules copy)
      NODE_PATH: path.join(ROOT, 'node_modules'),
      ...overrides,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  appLog = '';
  child.stdout.on('data', (d) => { appLog += d; });
  child.stderr.on('data', (d) => { appLog += d; });
}

async function stopApp() {
  if (! child) { return; }

  const current = child;
  child = null;

  await new Promise((resolve) => {
    const timer = setTimeout(resolve, 3000);
    current.once('exit', () => { clearTimeout(timer); resolve(); });
    try { current.kill(); } catch { clearTimeout(timer); resolve(); }
  });
  await sleep(250);
}

async function waitForHealth(timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${APP_URL}/health`, {signal: AbortSignal.timeout(1500)});
      if (200 === res.status) { return; }
    } catch {}

    await sleep(250);
  }

  throw new Error('app did not become healthy');
}

async function postJson(urlPath, body, headers = {}) {
  const res = await fetch(APP_URL + urlPath, {
    method: 'POST',
    headers: {'Content-Type': 'application/json', ...headers},
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  const text = await res.text();

  return {status: res.status, text};
}

function fileState(filePath) {
  try {
    const stats = fs.statSync(filePath);
    return {exists: true, mtime: stats.mtimeMs, size: stats.size, content: fs.readFileSync(filePath, 'utf8')};
  } catch {
    return {exists: false, mtime: 0, size: 0, content: ''};
  }
}

const capturePath = (id) => path.join(APP_DIR, 'public', 'img', 'captures', `${id}.jpeg`);
const rows = [];
const check = (label, actual, expected, ok = String(actual) === String(expected)) => {
  rows.push({label, actual: String(actual), expected: String(expected), ok});
};

(async () => {
  try {
    prepareAppCopy();
    await new Promise((resolve) => mock.listen(MOCK_PORT, '127.0.0.1', resolve));

    // ---------- Phase A: scheduler honours the TTL ----------
    const cam1Start = Date.now() - 15000;        // 15 seconds old -> fresh (TTL 60s)
    const cam2Start = Date.now() - 2 * 3600000;  // 2 hours old  -> stale
    fs.writeFileSync(capturePath('101'), 'cached-101');
    fs.utimesSync(capturePath('101'), new Date(cam1Start), new Date(cam1Start));
    fs.writeFileSync(capturePath('102'), 'cached-102');
    fs.utimesSync(capturePath('102'), new Date(cam2Start), new Date(cam2Start));
    fs.writeFileSync(capturePath('104'), 'cached-104');
    fs.utimesSync(capturePath('104'), new Date(cam1Start), new Date(cam1Start));

    const before = {101: fileState(capturePath('101')), 102: fileState(capturePath('102')), 104: fileState(capturePath('104'))};

    startApp({CAPTURE_REFRESH_INTERVAL: '2000'});
    await waitForHealth();
    await sleep(9000);

    const afterA = {101: fileState(capturePath('101')), 102: fileState(capturePath('102')), 104: fileState(capturePath('104'))};

    check('A1 fresh 101 capture calls', captureCalls['101'], 0);
    check('A2 stale 102 capture calls', captureCalls['102'], 1);
    check('A3 fresh 104 capture calls', captureCalls['104'], 0);
    check('A4 missing 103 retried every tick', captureCalls['103'] >= 2 ? 'yes' : 'no', 'yes');
    check('A5 fresh 101 untouched on disk', afterA['101'].content === 'cached-101' && afterA['101'].mtime === before['101'].mtime ? 'unchanged' : 'rewritten', 'unchanged');
    check('A6 stale 102 rewritten on disk', afterA['102'].content, 'capture-102');
    check('A7 fresh 104 still untouched', afterA['104'].content === 'cached-104' && afterA['104'].mtime === before['104'].mtime ? 'unchanged' : 'rewritten', 'unchanged');

    const tickLines = appLog.split(/\r?\n/).filter((l) => l.startsWith('Capturas:'));
    check('A8 per-tick summary lines', tickLines.length >= 2 ? 'yes' : 'no', 'yes');
    check('A9 first tick summary', (tickLines[0] || '').trim(), 'Capturas: 1 actualizadas, 2 vigentes, 1 fallidas de 4 cámaras (TTL 1 min)');
    check('A10 later tick skips refreshed 102', /^Capturas: 0 actualizadas, 3 vigentes, 1 fallidas/.test((tickLines[1] || '').trim()) ? 'yes' : (tickLines[1] || '').trim(), 'yes');
    check('A11 no base64 dumped to the log', appLog.includes('data:image') ? 'leaked' : 'absent', 'absent');
    check('A12 longest log line (chars)', Math.max(...appLog.split(/\r?\n/).map((l) => l.length)), '<300', Math.max(...appLog.split(/\r?\n/).map((l) => l.length)) < 300);
    check('A13 process survived failed captures', (await fetch(`${APP_URL}/health`, {signal: AbortSignal.timeout(1500)})).status, 200);

    await stopApp();

    // ---------- Phase B: endpoint cache uses mtime ----------
    fs.writeFileSync(capturePath('101'), 'cached-101');
    fs.utimesSync(capturePath('101'), new Date(), new Date());
    captureCalls['101'] = 0;

    // Scheduler pushed 1h away so any upstream call can only come from the endpoint
    startApp({CAPTURE_REFRESH_INTERVAL: '3600000'});
    await waitForHealth();

    const token = jwt.sign({username: 'admin'}, JWT_SECRET, {expiresIn: '1h'});
    const auth = {Authorization: `Bearer ${token}`};

    const r1 = await postJson('/api/camera/capture', {id: '101'}, auth);
    check('B1 fresh file served from cache (upstream calls)', captureCalls['101'], 0);
    check('B2 fresh file response', r1.text === `data:image/jpeg;base64,${Buffer.from('cached-101').toString('base64')}` ? 'cached content' : r1.text.slice(0, 40), 'cached content');

    const stale = new Date(Date.now() - 2 * 3600000);
    fs.utimesSync(capturePath('101'), stale, stale);
    const r2 = await postJson('/api/camera/capture', {id: '101'}, auth);
    check('B3 stale file triggers one capture', captureCalls['101'], 1);
    check('B4 stale file response', r2.text, `data:image/jpeg;base64,${Buffer.from('capture-101').toString('base64')}`);
    check('B5 file mtime refreshed', fileState(capturePath('101')).mtime > stale.getTime() ? 'yes' : 'no', 'yes');

    const r3 = await postJson('/api/camera/capture', {id: '101'}, auth);
    check('B6 next request uses the new cache', captureCalls['101'], 1);
    check('B7 next request content', r3.text === r2.text ? 'same capture' : 'different', 'same capture');

    const defaultLine = appLog.split(/\r?\n/).find((l) => l.startsWith('Refresco de capturas'));
    check('B8 explicit override wins over the TTL', (defaultLine || '').trim(), 'Refresco de capturas cada 60 min (TTL 1 min)');

    await stopApp();

    // ---------- Phase C: the default interval is the 4-hour floor at any TTL ----------
    const derivation = [];

    for (const ttl of [3600000, 7200000, 600000, 14400000]) {
      startApp({MIN_TIME_BETWEEN_CAPTURE_UPDATES: String(ttl), CAPTURE_REFRESH_INTERVAL: ''});
      await waitForHealth();
      await sleep(400);
      const line = appLog.split(/\r?\n/).find((l) => l.startsWith('Refresco de capturas'));
      const expected = `Refresco de capturas cada 240 min (TTL ${Math.round(ttl / 60000)} min)`;
      derivation.push({ttl, expected, actual: (line || '').trim()});
      await stopApp();
    }

    check('C1 TTL 60 min -> default 240 min', derivation[0].actual, derivation[0].expected);
    check('C2 TTL 120 min -> default 240 min', derivation[1].actual, derivation[1].expected);
    check('C3 TTL 10 min -> default 240 min', derivation[2].actual, derivation[2].expected);
    check('C4 TTL 240 min -> default 240 min', derivation[3].actual, derivation[3].expected);

    console.table(rows.map((r) => ({check: r.label, result: r.ok ? 'PASS' : 'FAIL', actual: r.actual, expected: r.expected})));
    const failures = rows.filter((r) => ! r.ok).length;
    console.log(failures ? `\nFAILURES: ${failures}` : '\nALL CHECKS PASSED');
    process.exitCode = failures ? 1 : 0;
  } catch (e) {
    console.error('test error:', e.stack || e.message);
    process.exitCode = 1;
  } finally {
    await stopApp();
    try { mock.close(); } catch {}
    setTimeout(() => process.exit(process.exitCode || 0), 250);
  }
})();
