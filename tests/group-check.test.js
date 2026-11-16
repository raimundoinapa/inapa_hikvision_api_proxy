// End-to-end proof of the AD group check.
// Starts a mock LDAP server + a throwaway app instance (HTTP, port 3444, mock LDAP on 1389).
// Local users stay hardcoded; every LDAP user must be in the allowed group (CCTV).
const path = require('node:path');
const { spawn } = require('node:child_process');
const http = require('node:http');

const ROOT = 'E:/inapa_hikvision_api_proxy';
const ldap = require(path.join(ROOT, 'node_modules/ldapjs'));
const bcrypt = require(path.join(ROOT, 'node_modules/bcryptjs'));

const APP_PORT = 3444;
const LDAP_PORT = 1389;
const PASSWORD = 'GoodPass1!';
const LOCAL_USER = 'localadmin';
const LOCAL_PASS = 'LocalPass1!';

const USERS = {
  alice: { memberOf: ['CN=Otro Grupo,OU=Grupos,DC=test,DC=local', 'CN=CCTV,OU=Grupos,DC=test,DC=local'] },
  bob: { memberOf: ['CN=Otro Grupo,OU=Grupos,DC=test,DC=local', 'CN=WIFI,OU=Grupos,DC=test,DC=local'] },
  carol: { memberOf: 'CN=cctv,OU=Grupos,DC=test,DC=local' }, // un solo grupo, CN en minúsculas
  dave: { memberOf: 'CN=Otro Grupo,OU=Grupos,DC=test,DC=local' }, // un solo grupo ajeno
  erin: {}, // sin memberOf
};

let bindCount = 0;

const ldapServer = ldap.createServer();

ldapServer.bind('', (req, res, next) => {
  bindCount++;

  if (PASSWORD !== req.credentials) {
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
    res.attributes = ['*'];//evita el filtro case-sensitive de ldapjs al enviar
    res.send({
      dn: `CN=${username},CN=Users,DC=test,DC=local`,
      attributes: {
        sAMAccountName: username,
        displayName: username,
        ...(user.memberOf ? { memberOf: user.memberOf } : {}),
      },
    }, true);
  }

  res.end();
  return next();
});

function login(username, password) {
  return new Promise((resolve) => {
    const payload = JSON.stringify({ username, password, jwt: true });
    const req = http.request(
      {
        host: '127.0.0.1',
        port: APP_PORT,
        path: '/auth/login',
        method: 'POST',
        timeout: 15000,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
      },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          let parsed = null;
          try { parsed = JSON.parse(body); } catch {}
          resolve({ status: res.statusCode, body: parsed });
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', (e) => resolve({ status: 0, error: e.code || e.message }));
    req.write(payload);
    req.end();
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

  try {
    await new Promise((resolve, reject) => {
      ldapServer.listen(LDAP_PORT, '127.0.0.1', resolve);
      ldapServer.on('error', reject);
    });
    console.log(`mock LDAP listening on ldap://127.0.0.1:${LDAP_PORT}`);

    const env = {
      ...process.env,
      NODE_ENV: 'development',
      PROTOCOL: 'http',
      PORT: String(APP_PORT),
      SERVER_IP: '127.0.0.1',
      LDAP_URLS: JSON.stringify([`ldap://127.0.0.1:${LDAP_PORT}`]),
      LDAP_BASEDN: 'DC=test,DC=local',
      // El mock usa ldapjs, que exige un DN parseable; con 'TEST' el bind sería 'TEST\user'
      // (válido para AD, inválido para ldapjs). 'CN=TEST' solo aplica a esta prueba.
      LDAP_DOMAIN: 'CN=TEST',
      LDAP_ALLOWED_CN: 'CCTV',
      ADMIN_USERNAME: LOCAL_USER,
      ADMIN_PASSWORD_HASH: bcrypt.hashSync(LOCAL_PASS, 10),
      ADDITIONAL_USERS: '[]',
    };

    child = spawn(process.execPath, ['server.js'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', () => {});
    child.stderr.on('data', (c) => (childErr += c));

    await waitForHealth();
    console.log(`app instance healthy on http://127.0.0.1:${APP_PORT}\n`);

    const cases = [
      { user: 'alice', pass: PASSWORD, expect: 200, why: 'array con CCTV' },
      { user: 'carol', pass: PASSWORD, expect: 200, why: 'un solo grupo (string), cn=cctv' },
      { user: 'bob', pass: PASSWORD, expect: 401, why: 'array sin CCTV' },
      { user: 'dave', pass: PASSWORD, expect: 401, why: 'un solo grupo ajeno (string)' },
      { user: 'erin', pass: PASSWORD, expect: 401, why: 'sin memberOf' },
      { user: 'alice', pass: 'WrongPass!', expect: 401, why: 'password incorrecta' },
      { user: LOCAL_USER, pass: LOCAL_PASS, expect: 200, why: 'usuario local hardcoded', local: true },
    ];

    const rows = [];
    let failures = 0;

    for (const c of cases) {
      const before = bindCount;
      const r = await login(c.user, c.pass);
      const usedLdap = bindCount > before;
      const hasToken = 'string' == typeof r.body?.data?.token && r.body.data.token.length > 0;
      const ok = r.status === c.expect && (200 !== c.expect || hasToken) && (c.local ? !usedLdap : usedLdap);

      if (!ok) failures++;
      rows.push({
        user: c.user,
        scenario: c.why,
        status: r.status,
        token: hasToken,
        ldap: usedLdap,
        expected: c.expect,
        result: ok ? 'PASS' : 'FAIL',
      });
    }

    console.table(rows);

    // The denied users must be logged as permission failures, not credential failures.
    await new Promise((r) => setTimeout(r, 400));
    const denied = ['bob', 'dave', 'erin'].map((u) => ({
      user: u,
      permissionLog: childErr.includes(`LDAP user "${u}" is not a member of the allowed groups: CCTV`),
    }));
    const permissionLogged = denied.every((d) => d.permissionLog);
    console.log('permission denial logged:', denied);

    const localNoBind = rows.find((r) => r.user === LOCAL_USER)?.ldap === false;
    console.log('local user bypassed LDAP entirely:', localNoBind);

    if (!permissionLogged || !localNoBind) failures++;
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
