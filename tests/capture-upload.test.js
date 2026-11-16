// Proof for the capture-upload hardening.
// Runs a throwaway copy of the app against a mock HikCentral.
// Production public/img/captures is never touched.

const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');

const ROOT = 'E:/inapa_hikvision_api_proxy';
const WORK = path.join(process.env.TEMP, 'opencode', 'capture-upload');
const APP_DIR = path.join(WORK, 'app');
const APP_PORT = 3499;
const MOCK_PORT = 19091;
const APP_URL = `http://127.0.0.1:${APP_PORT}`;

const bcrypt = require(path.join(ROOT, 'node_modules/bcryptjs'));
const jwt = require(path.join(ROOT, 'node_modules/jsonwebtoken'));

const JWT_SECRET = 'capture-upload-test-secret';
const CAMERAS = ['201', '202', '203', '204'];
const DATA_URI = 'data:image/jpeg;base64,';

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

    return send({code: '1', msg: `Unhandled mock path: ${req.url}`, data: null}, 404);
  });
});

// ---------- helpers ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Minimal JPEG-like payload: real signature FF D8 FF, then arbitrary bytes.
function jpeg(size = 12) {
  const buf = Buffer.alloc(Math.max(size, 3), 0x21);
  buf[0] = 0xFF;
  buf[1] = 0xD8;
  buf[2] = 0xFF;
  buf[buf.length - 1] = 0xD9;

  return buf;
}

const dataUri = (buf) => DATA_URI + buf.toString('base64');

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
      MIN_TIME_BETWEEN_CAPTURE_UPDATES: '60000',
      // Scheduler out of the way: every upstream call in this suite comes from the endpoint.
      CAPTURE_REFRESH_INTERVAL: '3600000',
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
      if (200 === res.status) {
        // The catalog loads right after the listener starts.
        await sleep(800);

        return;
      }
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

const upload = (id, data, token) => postJson('/api/camera/capture-upload', {id, data}, token ? {Authorization: `Bearer ${token}`} : {});

const replyData = (text) => {
  try { return JSON.parse(text)?.data || ''; } catch { return text; }
};

function fileState(filePath) {
  try {
    const stats = fs.statSync(filePath);
    return {exists: true, mtime: stats.mtimeMs, size: stats.size, content: fs.readFileSync(filePath)};
  } catch {
    return {exists: false, mtime: 0, size: 0, content: Buffer.alloc(0)};
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

    const token = jwt.sign({username: 'admin'}, JWT_SECRET, {expiresIn: '1h'});

    // ---------- Phase A: validation, with a 1 KB cap ----------
    startApp({CAPTURE_UPLOAD_MAX_BYTES: '1024'});
    await waitForHealth();

    const noToken = await upload('201', dataUri(jpeg(12)));
    check('A1 missing JWT status', noToken.status, 401);
    check('A2 missing JWT writes nothing', fileState(capturePath('201')).exists ? 'exists' : 'absent', 'absent');

    const badId = await upload('abc', dataUri(jpeg(12)), token);
    check('A3 non-numeric id rejected', replyData(badId.text), 'Invalid camera index code captured data');

    const unknown = await upload('999999999', dataUri(jpeg(12)), token);
    check('A4 unknown numeric id rejected', replyData(unknown.text), 'Unknown camera index code');
    check('A5 unknown id writes nothing', fileState(capturePath('999999999')).exists ? 'exists' : 'absent', 'absent');

    // Non-string `data`: before the fix, data.startsWith() threw and killed the process.
    const nonString = await upload('201', 12345, token);
    check('A6 non-string data rejected', replyData(nonString.text), 'Invalid camera index code captured data');
    check('A7 process survives non-string data', (await fetch(`${APP_URL}/health`, {signal: AbortSignal.timeout(1500)})).status, 200);

    const notJpeg = await upload('201', DATA_URI + Buffer.from('not-a-jpeg-at-all').toString('base64'), token);
    check('A8 non-JPEG payload rejected', replyData(notJpeg.text), 'Captured data is not a JPEG image');
    check('A9 non-JPEG writes nothing', fileState(capturePath('201')).exists ? 'exists' : 'absent', 'absent');

    const badEncoding = await upload('201', `${DATA_URI}@@@@`, token);
    check('A10 invalid base64 rejected', replyData(badEncoding.text), 'Invalid captured data encoding');

    const oversize = await upload('201', dataUri(jpeg(2048)), token);
    check('A11 oversize rejected (1 KB cap)', replyData(oversize.text), 'Captured data size is invalid');
    check('A12 oversize writes nothing', fileState(capturePath('201')).exists ? 'exists' : 'absent', 'absent');

    const valid = jpeg(24);
    const ok = await upload('202', dataUri(valid), token);
    const stored = fileState(capturePath('202'));
    check('A13 valid JPEG accepted', JSON.parse(ok.text).status, 'success');
    check('A14 valid JPEG written byte-for-byte', stored.content.equals(valid) ? 'identical' : 'different', 'identical');

    check('A15 no base64 leaked to the log', appLog.includes('data:image') ? 'leaked' : 'absent', 'absent');

    await stopApp();

    // ---------- Phase B: default cap + fresh file is not rewritten ----------
    const fresh = Date.now() - 5000;
    fs.writeFileSync(capturePath('203'), 'fresh-cached');
    fs.utimesSync(capturePath('203'), new Date(fresh), new Date(fresh));
    const before = fileState(capturePath('203'));

    startApp();
    await waitForHealth();

    const replacement = jpeg(40);
    const freshReply = await upload('203', dataUri(replacement), token);
    const afterFresh = fileState(capturePath('203'));
    check('B1 fresh file accepted without rewrite', JSON.parse(freshReply.text).status, 'success');
    check('B2 fresh file content unchanged', afterFresh.content.toString('utf8'), 'fresh-cached');
    check('B3 fresh file mtime unchanged', afterFresh.mtime === before.mtime ? 'unchanged' : 'changed', 'unchanged');

    const stale = new Date(Date.now() - 2 * 3600000);
    fs.utimesSync(capturePath('203'), stale, stale);
    const staleReply = await upload('203', dataUri(replacement), token);
    const afterStale = fileState(capturePath('203'));
    check('B4 stale file accepted', JSON.parse(staleReply.text).status, 'success');
    check('B5 stale file rewritten', afterStale.content.equals(replacement) ? 'rewritten' : 'unchanged', 'rewritten');

    const newFile = jpeg(16);
    const newReply = await upload('204', dataUri(newFile), token);
    check('B6 missing file accepted', JSON.parse(newReply.text).status, 'success');
    check('B7 missing file created', fileState(capturePath('204')).content.equals(newFile) ? 'created' : 'absent', 'created');

    // A file kept at the default 4 MB cap is large enough for these payloads.
    const bigEnough = await upload('201', dataUri(jpeg(1024 * 1024)), token);
    check('B8 1 MB JPEG under default cap accepted', JSON.parse(bigEnough.text).status, 'success');

    check('B9 no base64 leaked to the log', appLog.includes('data:image') ? 'leaked' : 'absent', 'absent');

    await stopApp();

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
