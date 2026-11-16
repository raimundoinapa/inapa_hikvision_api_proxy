// Proof for finding #6 (rate limiting) after the fix.
// Throwaway app + mock LDAP; each section starts a fresh instance so counters are isolated.
const path = require('node:path');
const { spawn } = require('node:child_process');
const http = require('node:http');

const ROOT = 'E:/inapa_hikvision_api_proxy';
const ldap = require(path.join(ROOT, 'node_modules/ldapjs'));
const bcrypt = require(path.join(ROOT, 'node_modules/bcryptjs'));

const APP_PORT = 3446;
const LDAP_PORT = 1391;
const LOCAL_USER = 'localadmin';
const LOCAL_PASS = 'LocalPass1!';
const LDAP_PASS = 'GoodPass1!';

const ldapServer = ldap.createServer();

ldapServer.bind('', (req, res, next) => {
  if (LDAP_PASS !== req.credentials) {
    return next(new ldap.InvalidCredentialsError());
  }

  res.end();
  return next();
});

ldapServer.search('DC=test,DC=local', (req, res, next) => {
  const match = /sAMAccountName=([^)]+)/i.exec(req.filter.toString());
  const username = (match ? match[1] : '').toLowerCase();

  if ('alice' === username) {
    res.attributes = ['*'];
    res.send({
      dn: 'CN=alice,CN=Users,DC=test,DC=local',
      attributes: {
        sAMAccountName: 'alice',
        memberOf: ['CN=CCTV,OU=Grupos,DC=test,DC=local'],
      },
    }, true);
  }

  res.end();
  return next();
});

function request(method, urlPath, { headers = {}, body = null } = {}) {
  return new Promise((resolve) => {
    const payload = body == null ? null : (typeof body === 'string' ? body : JSON.stringify(body));
    const req = http.request({
      host: '127.0.0.1',
      port: APP_PORT,
      path: urlPath,
      method,
      timeout: 10000,
      headers: {
        ...(payload ? {'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload)} : {}),
        ...headers,
      },
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch {}
        resolve({status: res.statusCode, headers: res.headers, json});
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', (e) => resolve({status: 0, error: e.code || e.message}));
    if (payload) { req.write(payload); }
    req.end();
  });
}

const login = (username, password, headers = {}) => request('POST', '/auth/login', {
  headers,
  body: {username, password},
});

const ldapLogin = (username, password, headers = {}) => request('POST', '/ldap/login', {
  headers,
  body: {username, password},
});

function waitForHealth(timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;

  return new Promise((resolve, reject) => {
    const attempt = () => {
      const req = http.get({host: '127.0.0.1', port: APP_PORT, path: '/health', timeout: 2000}, (res) => {
        res.resume();
        res.on('end', () => (200 === res.statusCode ? resolve() : retry()));
      });
      req.on('timeout', () => { req.destroy(); retry(); });
      req.on('error', retry);
    };
    const retry = () => (Date.now() > deadline ? reject(new Error('health timeout')) : setTimeout(attempt, 400));
    attempt();
  });
}

let child = null;

async function stopApp() {
  if (! child) { return; }

  const current = child;
  child = null;

  await new Promise((resolve) => {
    const timer = setTimeout(resolve, 3000);
    current.once('exit', () => { clearTimeout(timer); resolve(); });
    try { current.kill(); } catch { clearTimeout(timer); resolve(); }
  });
  await new Promise((r) => setTimeout(r, 300));
}

async function startApp(overrides = {}) {
  await stopApp();

  child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      PROTOCOL: 'http',
      PORT: String(APP_PORT),
      SERVER_IP: '127.0.0.1',
      TRUST_PROXY: '',
      LDAP_URLS: JSON.stringify([`ldap://127.0.0.1:${LDAP_PORT}`]),
      LDAP_BASEDN: 'DC=test,DC=local',
      LDAP_DOMAIN: 'CN=TEST',
      LDAP_ALLOWED_CN: 'CCTV',
      ADMIN_USERNAME: LOCAL_USER,
      ADMIN_PASSWORD_HASH: bcrypt.hashSync(LOCAL_PASS, 10),
      ADDITIONAL_USERS: '[]',
      JWT_SECRET: 'test-jwt-secret-rate-limit',
      LOGIN_RATE_LIMIT_DURATION: '60',
      LOGIN_RATE_LIMIT_BLOCK_DURATION: '60',
      IP_LOGIN_RATE_LIMIT_DURATION: '60',
      IP_LOGIN_RATE_LIMIT_BLOCK_DURATION: '60',
      ...overrides,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', () => {});
  child.stderr.on('data', () => {});

  await waitForHealth();
}

const statuses = (rows) => rows.map((r) => r.status).join(',');
const same = (label, actual, expected) => ({label, actual, expected, ok: actual === expected});
const rows = [];

(async () => {
  try {
    await new Promise((resolve, reject) => {
      ldapServer.listen(LDAP_PORT, '127.0.0.1', resolve);
      ldapServer.on('error', reject);
    });

    // 1) X-Forwarded-For / X-Real-IP from a direct client must be ignored.
    await startApp({LOGIN_RATE_LIMIT_POINTS: '2', IP_LOGIN_RATE_LIMIT_POINTS: '10'});
    const s1a = [];
    for (let i = 0; i < 3; i++) {
      s1a.push(await login(LOCAL_USER, 'wrong', {'X-Forwarded-For': '10.1.1.1'}));
    }
    const s1b = await login(LOCAL_USER, 'wrong', {'X-Forwarded-For': '10.1.1.2'});
    const s1c = await login(LOCAL_USER, 'wrong', {'X-Real-IP': '10.1.1.3'});
    rows.push(same('untrusted XFF: 3 attempts same header', statuses(s1a), '401,401,429'));
    rows.push(same('untrusted XFF: rotated header          ', String(s1b.status), '429'));
    rows.push(same('untrusted X-Real-IP                    ', String(s1c.status), '429'));

    // 2) A successful login must NOT reset the shared per-IP counter.
    await startApp({LOGIN_RATE_LIMIT_POINTS: '10', IP_LOGIN_RATE_LIMIT_POINTS: '4'});
    const s2before = [];
    for (let i = 1; i <= 3; i++) {
      s2before.push(await login(`nobody${i}`, 'wrong'));
    }
    const s2ok = await login(LOCAL_USER, LOCAL_PASS);
    const s2after = await login('nobody4', 'wrong');
    const s2blocked1 = await login('nobody5', 'wrong');
    const s2blocked2 = await login('nobody6', 'wrong');
    rows.push(same('per-IP 4: 3 failures then valid login', `${statuses(s2before)}|${s2ok.status}|${s2after.status}`, '401,401,401|200|401'));
    rows.push(same('per-IP cap still applies after login ', `${s2blocked1.status},${s2blocked2.status}`, '429,429'));

    // 3) Successful /ldap/login checks must not consume attempts.
    await startApp({LOGIN_RATE_LIMIT_POINTS: '2', IP_LOGIN_RATE_LIMIT_POINTS: '10'});
    const s3ok = [];
    for (let i = 0; i < 4; i++) {
      s3ok.push(await ldapLogin('alice', LDAP_PASS));
    }
    const s3fail = [];
    for (let i = 0; i < 3; i++) {
      s3fail.push(await ldapLogin('alice', 'wrong'));
    }
    rows.push(same('/ldap/login 4 correct attempts      ', statuses(s3ok), '200,200,200,200'));
    rows.push(same('/ldap/login then 3 wrong attempts    ', statuses(s3fail), '401,401,429'));

    // 4) Case / UPN variants share one counter.
    await startApp({LOGIN_RATE_LIMIT_POINTS: '2', IP_LOGIN_RATE_LIMIT_POINTS: '10'});
    const s4 = [];
    s4.push(await ldapLogin('alice', 'wrong'));
    s4.push(await ldapLogin('alice', 'wrong'));
    s4.push(await ldapLogin('ALICE', 'wrong'));
    s4.push(await ldapLogin('alice@test.local', 'wrong'));
    rows.push(same('alice x2, ALICE, alice@test.local    ', statuses(s4), '401,401,429,429'));

    // 5) Per-IP cap itself, with distinct usernames.
    await startApp({LOGIN_RATE_LIMIT_POINTS: '10', IP_LOGIN_RATE_LIMIT_POINTS: '4'});
    const s5 = [];
    for (let i = 1; i <= 5; i++) {
      s5.push(await login(`spray${i}`, 'wrong'));
    }
    rows.push(same('per-IP cap: 5 different usernames     ', statuses(s5), '401,401,401,401,429'));

    // 6) Non-POST requests to /ldap/login must not consume attempts.
    await startApp({LOGIN_RATE_LIMIT_POINTS: '1', IP_LOGIN_RATE_LIMIT_POINTS: '10'});
    const s6get = [];
    for (let i = 0; i < 6; i++) {
      s6get.push(await request('GET', '/ldap/login?username=getuser'));
    }
    const s6first = await ldapLogin('getuser', 'wrong');
    const s6second = await ldapLogin('getuser', 'wrong');
    rows.push(same('6x GET /ldap/login (no consumption)   ', statuses(s6get), '404,404,404,404,404,404'));
    rows.push(same('POST after GETs: 1st / 2nd attempt    ', `${s6first.status},${s6second.status}`, '401,429'));

    console.table(rows.map((r) => ({check: r.label, result: r.ok ? 'PASS' : 'FAIL', actual: r.actual, expected: r.expected})));
    const failures = rows.filter((r) => ! r.ok).length;
    console.log(failures ? `\nFAILURES: ${failures}` : '\nALL CHECKS PASSED');
    process.exitCode = failures ? 1 : 0;
  } catch (e) {
    console.error('test error:', e.message);
    process.exitCode = 1;
  } finally {
    await stopApp();
    try { ldapServer.close(); } catch {}
    setTimeout(() => process.exit(process.exitCode || 0), 300);
  }
})();
