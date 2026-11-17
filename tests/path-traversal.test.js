// Proof for finding #1: static-file path traversal, including encoded payloads.
// Starts a real HttpServer with a canary file OUTSIDE public/ and sends raw HTTP
// requests, so the client cannot "help" by normalising the request target.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');

const ROOT = path.resolve(__dirname, '..');
const HttpServer = require(path.join(ROOT, 'http-server.js'));

const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'path-traversal-'));
const PUBLIC = path.join(WORK, 'public');
fs.mkdirSync(PUBLIC, {recursive: true});

const CANARY = 'CANARY_TRAVERSAL_9F3A';
const ALLOWED = 'ALLOWED_STATIC_FILE';
fs.writeFileSync(path.join(WORK, 'secret-canary.txt'), CANARY);
fs.writeFileSync(path.join(PUBLIC, 'allowed.txt'), ALLOWED);

const rows = [];
const check = (label, actual, expected, ok = JSON.stringify(actual) === JSON.stringify(expected)) => {
  rows.push({label, actual: JSON.stringify(actual), expected: JSON.stringify(expected), ok});
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Fixed high port: options.port || 8080 turns 0 into 8080, where another local
// process already listens. 3501 is reserved for this suite.
const TEST_PORT = 3501;
const srv = new HttpServer({protocol: 'http', ip: '127.0.0.1', port: TEST_PORT, public: PUBLIC});
srv.run();

function waitForListen() {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + 5000;
    const tick = () => {
      const addr = srv.listener?.address();
      if (addr && typeof addr === 'object') { return resolve(addr.port); }
      if (Date.now() > deadline) { return reject(new Error('listener did not start')); }
      setTimeout(tick, 50);
    };
    tick();
  });
}

function rawGet(port, target) {
  return new Promise((resolve) => {
    const sock = net.connect(port, '127.0.0.1', () => {
      sock.write(`GET ${target} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nConnection: close\r\n\r\n`);
    });

    let buf = '';
    let settled = false;
    const settle = () => {
      if (settled) { return; }
      settled = true;
      const status = Number((buf.match(/^HTTP\/1\.[01] (\d{3})/) || [])[1] || 0);
      const body = buf.split('\r\n\r\n')[1] || '';

      resolve({status, body, leaked: body.includes(CANARY)});
    };

    sock.setTimeout(5000, () => sock.destroy());
    sock.on('data', (d) => { buf += d.toString('latin1'); });
    sock.on('end', settle);
    sock.on('close', settle);
    sock.on('error', (e) => {
      if (! settled) { settled = true; resolve({status: 0, body: '', leaked: false, err: e.code}); }
    });
  });
}

(async () => {
  const port = await waitForListen();

  const baseline = await rawGet(port, '/allowed.txt');
  check('A1 legitimate static file returns 200', baseline.status, 200);
  // The response uses chunked encoding, so compare presence rather than raw bytes.
  check('A2 legitimate static file body contains the canary-free file', baseline.body.includes(ALLOWED), true);

  // Each payload would read the canary if the server decoded it or if the
  // containment check were removed. A raw "../" is the control case.
  const payloads = [
    '/../secret-canary.txt',
    '/%2e%2e/secret-canary.txt',
    '/%2e%2e%2fsecret-canary.txt',
    '/..%2fsecret-canary.txt',
    '/%2e%2e/%2e%2e/secret-canary.txt',
    '/%252e%252e%252fsecret-canary.txt',
    '/..%5csecret-canary.txt',
    '/%2e%2e%5csecret-canary.txt',
    '/js/../../../secret-canary.txt',
    '/..\\secret-canary.txt',
    '/....//secret-canary.txt',
  ];

  const results = [];
  for (const target of payloads) {
    const r = await rawGet(port, target);
    results.push({target, status: r.status, leaked: r.leaked});
    check(`B ${target} -> 404`, r.status, 404);
    check(`C ${target} does not leak canary`, r.leaked, false);
  }

  console.table(results);
  console.table(rows);

  const failures = rows.filter((r) => !r.ok);
  if (failures.length) {
    console.log(`FAILURES: ${failures.length}`);
    process.exitCode = 1;
  } else {
    console.log('ALL CHECKS PASSED');
  }

  srv.listener.close();
  fs.rmSync(WORK, {recursive: true, force: true});
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
  srv.listener?.close();
  fs.rmSync(WORK, {recursive: true, force: true});
});
