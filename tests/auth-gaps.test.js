// End-to-end proof of finding #4 (auth/authz gaps).
// Starts a mock LDAP + a throwaway app instance (HTTP, port 3445, mock LDAP on 1390).
// No real credentials or .env values are used/printed.
const path = require('node:path');
const { spawn } = require('node:child_process');
const http = require('node:http');

const ROOT = 'E:/inapa_hikvision_api_proxy';
const ldap = require(path.join(ROOT, 'node_modules/ldapjs'));
const bcrypt = require(path.join(ROOT, 'node_modules/bcryptjs'));

const APP_PORT = 3445;
const LDAP_PORT = 1390;
const LOCAL_USER = 'localadmin';
const LOCAL_PASS = 'LocalPass1!';
const LDAP_PASS = 'GoodPass1!';
const SCREEN_KEY = 'test-screen-key-0123456789abcdef';
const JWT_SECRET = 'test-jwt-secret-for-auth-gaps';

const USERS = {
  alice: {
    memberOf: ['CN=CCTV,OU=Grupos,DC=test,DC=local'],
    mail: 'alice@test.local',
    displayName: 'Alice Test',
    objectSid: 'S-1-5-21-1111111111-2222222222-3333333333-1001',
  },
};

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
  const username = match ? match[1] : '';
  const user = USERS[username];

  if (user) {
    res.attributes = ['*'];//ldapjs filtra case-sensitive al enviar (memberOf)
    res.send({
      dn: `CN=${username},CN=Users,DC=test,DC=local`,
      attributes: {
        sAMAccountName: username,
        ...user,
      },
    }, true);
  }

  res.end();
  return next();
});

function request(method, urlPath, { headers = {}, body = null, timeout = 10000 } = {}) {
  return new Promise((resolve) => {
    const payload = body == null ? null : (typeof body === 'string' ? body : JSON.stringify(body));
    const req = http.request({
      host: '127.0.0.1',
      port: APP_PORT,
      path: urlPath,
      method,
      timeout,
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
        resolve({ status: res.statusCode, headers: res.headers, raw: data, json });
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', (e) => resolve({ status: 0, error: e.code || e.message, raw: '', json: null }));
    if (payload) { req.write(payload); }
    req.end();
  });
}

function openSse(urlPath, headers = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) { return; }
      settled = true;
      try { req.destroy(); } catch {}
      resolve(result);
    };
    const req = http.get({ host: '127.0.0.1', port: APP_PORT, path: urlPath, headers }, (res) => {
      let data = '';
      res.on('data', (c) => {
        data += c;
        if (data.includes('\n\n')) {
          finish({ status: res.statusCode, headers: res.headers, raw: data });
        }
      });
      res.on('end', () => finish({ status: res.statusCode, headers: res.headers, raw: data }));
      const timer = setTimeout(() => finish({ status: res.statusCode, headers: res.headers, raw: data }), 1500);
      timer.unref?.();
    });
    req.setTimeout(3000, () => finish({ status: 0, error: 'client-timeout', raw: '' }));
    req.on('error', (e) => finish({ status: 0, error: e.code || e.message, raw: '' }));
  });
}

function waitForHealth(timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;

  return new Promise((resolve, reject) => {
    const attempt = () => {
      const req = http.get({ host: '127.0.0.1', port: APP_PORT, path: '/health', timeout: 2000 }, (res) => {
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

(async () => {
  let child = null;
  let childErr = '';
  const rows = [];

  const check = (name, ok, details = '') => {
    rows.push({ name, result: ok ? 'PASS' : 'FAIL', details });
    if (! ok) { process.exitCode = 1; }
  };

  try {
    await new Promise((resolve, reject) => {
      ldapServer.listen(LDAP_PORT, '127.0.0.1', resolve);
      ldapServer.on('error', reject);
    });
    console.log(`mock LDAP listening on ldap://127.0.0.1:${LDAP_PORT}`);

    const env = {
      ...process.env,
      NODE_ENV: 'test',
      PROTOCOL: 'http',
      PORT: String(APP_PORT),
      SERVER_IP: '127.0.0.1',
      LDAP_URLS: JSON.stringify([`ldap://127.0.0.1:${LDAP_PORT}`]),
      LDAP_BASEDN: 'DC=test,DC=local',
      LDAP_DOMAIN: 'CN=TEST',
      LDAP_ALLOWED_CN: 'CCTV',
      SCREEN_ACCESS_KEY: SCREEN_KEY,
      ADMIN_USERNAME: LOCAL_USER,
      ADMIN_PASSWORD_HASH: bcrypt.hashSync(LOCAL_PASS, 10),
      ADDITIONAL_USERS: '[]',
      JWT_SECRET,
      JWT_EXPIRES_IN: '1h',
      LOGIN_RATE_LIMIT_POINTS: '3',
      LOGIN_RATE_LIMIT_DURATION: '30',
      LOGIN_RATE_LIMIT_BLOCK_DURATION: '30',
      IP_LOGIN_RATE_LIMIT_POINTS: '1000',
      IP_LOGIN_RATE_LIMIT_DURATION: '30',
      IP_LOGIN_RATE_LIMIT_BLOCK_DURATION: '30',
    };

    child = spawn(process.execPath, ['server.js'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', () => {});
    child.stderr.on('data', (c) => { childErr += c; });

    await waitForHealth();
    console.log(`app instance healthy on http://127.0.0.1:${APP_PORT}\n`);

    const health = await request('GET', '/health');
    check('health is public', 200 === health.status, `status=${health.status}`);

    // 1) /generatehash must not be public
    const hashNoToken = await request('GET', '/generatehash');
    check('/generatehash without JWT -> 401', 401 === hashNoToken.status, `status=${hashNoToken.status}`);

    const badHashToken = await request('GET', '/generatehash', { headers: {authorization: 'Bearer not-a-jwt'} });
    check('/generatehash with forged JWT -> 401', 401 === badHashToken.status, `status=${badHashToken.status}`);

    // Local login
    const login = await request('POST', '/auth/login', { body: {username: LOCAL_USER, password: LOCAL_PASS, jwt: true} });
    const token = login.json?.data?.token || '';
    check('local login returns JWT', 200 === login.status && token.length > 20, `status=${login.status}`);

    // 2) /generatehash: authenticated, no plaintext echo when password supplied
    const provided = 'Sup3rSecret!';
    const hashProvided = await request('GET', `/generatehash?password=${encodeURIComponent(provided)}`, {
      headers: {authorization: `Bearer ${token}`},
    });
    const hashProvidedOk = 200 === hashProvided.status
      && 'string' == typeof hashProvided.json?.message
      && hashProvided.json.message.startsWith('$2')
      && undefined === hashProvided.json?.password
      && ! hashProvided.raw.includes(provided);
    check('/generatehash with JWT: hash, no plaintext echo', hashProvidedOk, `status=${hashProvided.status}`);

    const hashGenerated = await request('GET', '/generatehash', { headers: {authorization: `Bearer ${token}`} });
    const generatedOk = 200 === hashGenerated.status
      && 'string' == typeof hashGenerated.json?.password
      && hashGenerated.json.password.length >= 8
      && bcrypt.compareSync(hashGenerated.json.password, hashGenerated.json.message);
    check('/generatehash with JWT: generated password matches hash', generatedOk, `status=${hashGenerated.status}`);

    // 3) /ldap/login must not return the AD record
    const ldapLogin = await request('POST', '/ldap/login', { body: {username: 'alice', password: LDAP_PASS} });
    const ldapKeys = ldapLogin.json ? Object.keys(ldapLogin.json).sort() : [];
    const ldapMinimal = 200 === ldapLogin.status
      && JSON.stringify(ldapKeys) === JSON.stringify(['code', 'status'])
      && ! ldapLogin.raw.includes('memberOf')
      && ! ldapLogin.raw.includes('alice@test.local')
      && ! ldapLogin.raw.includes('objectSid');
    check('/ldap/login returns only {code,status}', ldapMinimal, `status=${ldapLogin.status} keys=${ldapKeys.join(',')}`);

    // 4) /auth/login must not return the AD record either
    const authLogin = await request('POST', '/auth/login', { body: {username: 'alice', password: LDAP_PASS, jwt: true} });
    const authToken = authLogin.json?.data?.token || '';
    const authMinimal = 200 === authLogin.status
      && authToken.length > 20
      && ! authLogin.raw.includes('memberOf')
      && ! authLogin.raw.includes('alice@test.local')
      && ! authLogin.raw.includes('objectSid')
      && ! authLogin.raw.includes('"displayName"');
    check('/auth/login returns JWT without AD data', authMinimal, `status=${authLogin.status}`);

    // 4b) Malformed/empty usernames must not crash the process or reach LDAP
    const malformed = [
      {username: '', password: 'x', why: 'empty username'},
      {username: '*', password: 'x', why: 'filter injection *'},
      {username: 'alice*', password: 'x', why: 'filter injection alice*'},
      {username: 'alice', password: '', why: 'empty password'},
    ];
    for (const m of malformed) {
      const r = await request('POST', '/ldap/login', { body: {username: m.username, password: m.password} });
      check(`/ldap/login ${m.why} -> 401 (no crash)`, 401 === r.status, `status=${r.status}`);
    }
    const healthAfterMalformed = await request('GET', '/health');
    check('server still alive after malformed LDAP logins', 200 === healthAfterMalformed.status, `status=${healthAfterMalformed.status}`);

    // The UPN form (user@domain) still authenticates normally
    const upnLogin = await request('POST', '/ldap/login', { body: {username: 'alice@test.local', password: LDAP_PASS} });
    check('/ldap/login accepts user@domain', 200 === upnLogin.status, `status=${upnLogin.status}`);

    // 5) Operator SSE requires a JWT (header or query)
    const sseNoToken = await openSse('/sse_events?clientId=op-no-token');
    check('operator SSE without JWT -> 401', 401 === sseNoToken.status, `status=${sseNoToken.status}`);

    const sseWithToken = await openSse(`/sse_events?clientId=op-token&token=${encodeURIComponent(token)}`);
    const sseWithTokenOk = 200 === sseWithToken.status
      && String(sseWithToken.headers?.['content-type'] || '').includes('text/event-stream')
      && sseWithToken.raw.includes('"event":"connect"');
    check('operator SSE with JWT in query -> 200 stream', sseWithTokenOk, `status=${sseWithToken.status}`);

    // 6) Screen SSE requires the screen key
    const sseScreenNoKey = await openSse('/sse_events?isScreen=true');
    check('screen SSE without key -> 401', 401 === sseScreenNoKey.status, `status=${sseScreenNoKey.status}`);

    const sseScreenWithKey = await openSse(`/sse_events?isScreen=true&key=${encodeURIComponent(SCREEN_KEY)}`);
    const sseScreenWithKeyOk = 200 === sseScreenWithKey.status
      && String(sseScreenWithKey.headers?.['content-type'] || '').includes('text/event-stream')
      && sseScreenWithKey.raw.includes('"event":"connect"');
    check('screen SSE with key -> 200 stream', sseScreenWithKeyOk, `status=${sseScreenWithKey.status}`);

    const sseOperatorWithScreenKey = await openSse(`/sse_events?clientId=op-key&key=${encodeURIComponent(SCREEN_KEY)}`);
    check('operator SSE with only screen key -> 401', 401 === sseOperatorWithScreenKey.status, `status=${sseOperatorWithScreenKey.status}`);

    // 7) Screen/client endpoints
    const clientsNoKey = await request('GET', '/get_clients');
    check('/get_clients without key -> 401', 401 === clientsNoKey.status, `status=${clientsNoKey.status}`);

    const clientsWithKey = await request('GET', `/get_clients?key=${encodeURIComponent(SCREEN_KEY)}`);
    check('/get_clients with key -> 200 array', 200 === clientsWithKey.status && Array.isArray(clientsWithKey.json), `status=${clientsWithKey.status}`);

    const connectNoKey = await request('POST', '/connect_client', { body: {clientId: '99999', screenId: 'none'} });
    check('/connect_client without key -> 401', 401 === connectNoKey.status, `status=${connectNoKey.status}`);

    const connectWithKey = await request('POST', `/connect_client?key=${encodeURIComponent(SCREEN_KEY)}`, {
      body: {clientId: '99999', screenId: 'none'},
    });
    check('/connect_client with key reaches handler -> 404', 404 === connectWithKey.status, `status=${connectWithKey.status}`);

    // 8) Operator-only state changes
    const shareNoToken = await request('POST', '/share_camera', { body: {clientId: 'x', screenId: 'y', streamUrl: 'http://evil'} });
    check('/share_camera without JWT -> 401', 401 === shareNoToken.status, `status=${shareNoToken.status}`);

    const shareWithScreenKey = await request('POST', `/share_camera?key=${encodeURIComponent(SCREEN_KEY)}`, {
      body: {clientId: 'x', screenId: 'y', streamUrl: 'http://evil'},
    });
    check('/share_camera with only screen key -> 401', 401 === shareWithScreenKey.status, `status=${shareWithScreenKey.status}`);

    const shareWithToken = await request('POST', '/share_camera', {
      headers: {authorization: `Bearer ${token}`},
      body: {clientId: 'x', screenId: 'y', streamUrl: 'http://evil'},
    });
    check('/share_camera with JWT -> 200', 200 === shareWithToken.status && 'success' === shareWithToken.json?.status, `status=${shareWithToken.status}`);

    const shareAltNoToken = await request('POST', '/share_camera_alt', { body: {clientId: '1', streamUrl: 'http://evil'} });
    check('/share_camera_alt without JWT -> 401', 401 === shareAltNoToken.status, `status=${shareAltNoToken.status}`);

    const shareAltWithToken = await request('POST', '/share_camera_alt', {
      headers: {authorization: `Bearer ${token}`},
      body: {clientId: '1', streamUrl: 'http://evil'},
    });
    check('/share_camera_alt with JWT reaches handler -> 404', 404 === shareAltWithToken.status, `status=${shareAltWithToken.status}`);

    // 9) Pantalla 1-4 are open by operational decision; /screen keeps the key
    for (const page of ['/pantalla1', '/pantalla2', '/pantalla3', '/pantalla4', '/pantalla.html']) {
      const noKey = await request('GET', page);
      const ok = 200 === noKey.status && noKey.raw.toLowerCase().includes('<!doctype html>');
      check(`${page} without key -> 200 HTML (open)`, ok, `status=${noKey.status}`);
    }

    const altNoKey = await openSse('/connect_client_alt?clientId=open-probe');
    const altOk = 200 === altNoKey.status
      && String(altNoKey.headers?.['content-type'] || '').includes('text/event-stream')
      && altNoKey.raw.includes('"event":"connect"');
    check('/connect_client_alt without key -> 200 stream (open)', altOk, `status=${altNoKey.status}`);

    for (const page of ['/screen', '/screen.html']) {
      const noKey = await request('GET', page);
      check(`${page} without key -> 401`, 401 === noKey.status, `status=${noKey.status}`);

      const withKey = await request('GET', `${page}?key=${encodeURIComponent(SCREEN_KEY)}`);
      const ok = 200 === withKey.status && withKey.raw.toLowerCase().includes('<!doctype html>');
      check(`${page} with key -> 200 HTML`, ok, `status=${withKey.status}`);
    }

    // 10) /auth/login rate limiting (3 points in this instance)
    let lastAuth = null;
    for (let i = 0; i < 3; i++) {
      lastAuth = await request('POST', '/auth/login', { body: {username: 'ratelimit-auth', password: `Wrong${i}!`} });
    }
    const authBlocked = await request('POST', '/auth/login', { body: {username: 'ratelimit-auth', password: 'WrongAgain!'} });
    const authRateOk = 401 === lastAuth?.status && 429 === authBlocked.status && Boolean(authBlocked.headers?.['retry-after']);
    check('/auth/login rate limited after 3 failures -> 429', authRateOk, `3rd=${lastAuth?.status} 4th=${authBlocked.status} retry-after=${authBlocked.headers?.['retry-after']}`);

    // 11) /ldap/login inherits the same rate limiting
    let lastLdap = null;
    for (let i = 0; i < 3; i++) {
      lastLdap = await request('POST', '/ldap/login', { body: {username: 'ratelimit-ldap', password: `Wrong${i}!`} });
    }
    const ldapBlocked = await request('POST', '/ldap/login', { body: {username: 'ratelimit-ldap', password: 'WrongAgain!'} });
    const ldapRateOk = 401 === lastLdap?.status && 429 === ldapBlocked.status && Boolean(ldapBlocked.headers?.['retry-after']);
    check('/ldap/login rate limited after 3 failures -> 429', ldapRateOk, `3rd=${lastLdap?.status} 4th=${ldapBlocked.status} retry-after=${ldapBlocked.headers?.['retry-after']}`);

    // Check the denial reason for the rate limiter is logged (not credentials)
    await new Promise((r) => setTimeout(r, 300));

    console.table(rows);
    const failures = rows.filter((r) => 'FAIL' === r.result).length;
    console.log(`\n${failures ? 'FAILURES: ' + failures : 'ALL CHECKS PASSED'}`);
    process.exitCode = failures ? 1 : 0;
  } catch (e) {
    console.error('test error:', e.message);
    process.exitCode = 1;
  } finally {
    if (child) { try { child.kill(); } catch {} }
    try { ldapServer.close(); } catch {}
    setTimeout(() => process.exit(process.exitCode || 0), 300);
  }
})();
