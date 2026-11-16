// Proof for the remaining finding #9 items:
//   A. frontend camera.encodingDeviceInfo typo
//   B. getIntegralSingleCameraData() ignoring its protocol argument
//   C. request 'error' listener registered after the POST body was read
//   D. unbounded PTZ preset/patrol concurrency in getIntegralCameraData()
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const net = require('node:net');
const {EventEmitter} = require('node:events');

const ROOT = 'E:/inapa_hikvision_api_proxy';
const HIK_SRC = fs.readFileSync(path.join(ROOT, 'hikcentral.js'), 'utf8');
const hikLines = HIK_SRC.split('\n');
const scriptSrc = fs.readFileSync(path.join(ROOT, 'public', 'js', 'script.js'), 'utf8');

const rows = [];
const check = (label, actual, expected, ok = JSON.stringify(actual) === JSON.stringify(expected)) => {
  rows.push({label, actual: JSON.stringify(actual), expected: JSON.stringify(expected), ok});
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Extract a real function from hikcentral.js by line boundaries.
const extractRange = (startNeedle, endNeedle) => {
  const start = hikLines.findIndex((l) => l.includes(startNeedle));
  const end = hikLines.findIndex((l, i) => i > start && l.includes(endNeedle));

  if (start < 0 || end < 0) { throw new Error(`could not extract ${startNeedle}`); }

  return hikLines.slice(start, end).join('\n');
};

// ---------- A. frontend typo ----------
const testFrontendTypo = () => {
  const line = scriptSrc.split('\n').find((l) => l.includes('const cameraFullName'));

  if (! line) { throw new Error('cameraFullName line not found'); }

  const expression = line.trim().replace(/^const cameraFullName = /, '').replace(/;$/, '');
  const build = new Function('camera', `return ${expression};`);

  const camera = {cameraName: 'GARITA', area: {name: 'Arroyo'}, encodeDeviceInfo: {encodeDevName: 'DVR-01'}};
  const name = build(camera);

  check('A1 cameraFullName uses encodeDeviceInfo', name, 'GARITA - Arroyo - DVR-01');
  check('A2 old typo gone from script.js', scriptSrc.includes('encodingDeviceInfo'), false);
  check('A3 the real camera field is named encodeDeviceInfo', HIK_SRC.includes('c.encodeDeviceInfo ='), true);

  // The old expression, reproduced, to show the difference on the same data.
  const old = new Function('camera', 'return [camera.cameraName, camera?.area?.name, camera?.encodingDeviceInfo?.encodeDevName].filter(f => f).join(" - ");');
  check('A4 old expression drops the device name', old(camera), 'GARITA - Arroyo');
};

// ---------- B. protocol argument ----------
const testSingleCameraProtocol = async () => {
  const code = extractRange('const getIntegralSingleCameraData = async', 'const testSomeEndpoints');
  const build = new Function(
    'getCamera', 'getEncodeDevice', 'getArea', 'getCameraPreviewURL', 'getCameraCapture',
    `${code}\nreturn getIntegralSingleCameraData;`
  );

  const requestedProtocols = [];
  const fn = build(
    async () => ({data: {cameraIndexCode: 'CAM1', encodeDevIndexCode: 'ED1', regionIndexCode: 'R1'}}),
    async () => ({data: {encodeDevName: 'DVR'}}),
    async () => ({data: {name: 'Area'}}),
    async (indexCode, protocol) => {
      requestedProtocols.push(protocol);
      return {data: {mainStream: `${protocol}-main`, subStream: `${protocol}-sub`}};
    },
    async () => ({data: {data: 'data:image/jpeg;base64,AAAA'}})
  );

  const hls = await fn('CAM1', 'hls');
  check('B1 explicit protocol reaches getCameraPreviewURL', requestedProtocols[0], 'hls');
  check('B2 returned main stream matches protocol', hls.data.mainStream, 'hls-main');
  check('B3 returned sub stream matches protocol', hls.data.subStream, 'hls-sub');

  await fn('CAM1');
  check('B4 default protocol is websocket', requestedProtocols[1], 'websocket');

  const before = requestedProtocols.length;
  const bad = await fn('CAM1', 'quic');
  check('B5 invalid protocol rejected before any call', bad, {status: 'fail', data: 'Invalid protocol'});
  check('B6 invalid protocol made no upstream call', requestedProtocols.length, before);
};

// ---------- C. aborted POST body ----------
const testAbortedBody = async () => {
  process.env.REDIRECT_HTTP_TO_HTTPS = 'false';
  const HttpServer = require(path.join(ROOT, 'http-server.js'));
  const PORT = 3497;

  const srv = new HttpServer({protocol: 'http', ip: '127.0.0.1', port: PORT, public: 'public'});
  let handlerCalls = 0;
  let lastBody = null;

  srv.get('/health', (req, res) => {
    res.writeHead(200, {'Content-Type': 'text/plain'});
    res.end('ok');
  });

  srv.post('/echo', (req, res) => {
    handlerCalls += 1;
    lastBody = req._dataBody;
    res.writeHead(200, {'Content-Type': 'application/json'});
    res.end(JSON.stringify({received: true}));
  });

  // Isolated getPostBody: abort during read must resolve, not hang.
  {
    const fakeReq = new EventEmitter();
    fakeReq._isMultipart = false;
    fakeReq._contentType = 'application/json';

    const pending = srv.getPostBody(fakeReq);
    fakeReq.emit('aborted');
    const outcome = await Promise.race([
      pending.then((v) => ({resolved: true, value: v})),
      sleep(1000).then(() => ({resolved: false, value: 'HUNG'})),
    ]);

    check('C1 aborted body resolves instead of hanging', outcome, {resolved: true, value: null});

    const errReq = new EventEmitter();
    errReq._isMultipart = false;
    errReq._contentType = 'application/json';

    const pending2 = srv.getPostBody(errReq);
    errReq.emit('error', new Error('ECONNRESET'));
    const outcome2 = await Promise.race([
      pending2.then((v) => ({resolved: true, value: v})),
      sleep(1000).then(() => ({resolved: false, value: 'HUNG'})),
    ]);

    check('C2 request error resolves instead of hanging', outcome2, {resolved: true, value: null});
  }

  srv.run();
  await sleep(250);

  // Normal POST still works.
  {
    const result = await new Promise((resolve) => {
      const req = http.request({host: '127.0.0.1', port: PORT, path: '/echo', method: 'POST', headers: {'Content-Type': 'application/json'}}, (res) => {
        let body = '';
        res.on('data', (c) => { body += c; });
        res.on('end', () => resolve({status: res.statusCode, body}));
      });
      req.on('error', (e) => resolve({status: 0, body: e.message}));
      req.end(JSON.stringify({hello: 'world'}));
    });

    check('C3 normal POST still parsed', [result.status, result.body], [200, '{"received":true}']);
    check('C4 router received the parsed body', lastBody, {hello: 'world'});
  }

  // Aborted upload: headers announce 100 bytes, only 5 are sent, then socket dies.
  handlerCalls = 0;
  await new Promise((resolve) => {
    const socket = net.connect(PORT, '127.0.0.1', () => {
      socket.write('POST /echo HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nContent-Length: 100\r\n\r\n');
      socket.write('{"a":');

      setTimeout(() => {
        socket.destroy();
        resolve();
      }, 120);
    });
    socket.on('error', () => resolve());
  });

  await sleep(700);
  check('C5 aborted upload never reaches the route', handlerCalls, 0);

  // Server is still healthy after the abort.
  {
    const status = await new Promise((resolve) => {
      http.get({host: '127.0.0.1', port: PORT, path: '/health'}, (res) => {
        res.resume();
        resolve(res.statusCode);
      }).on('error', () => resolve(0));
    });

    check('C6 server still answers after the abort', status, 200);
  }

  // Oversized body still rejected (413), and the client actually receives it.
  srv.maxPostSize = 10;
  {
    const result = await new Promise((resolve) => {
      const req = http.request({host: '127.0.0.1', port: PORT, path: '/echo', method: 'POST', headers: {'Content-Type': 'application/json', 'Content-Length': '50'}}, (res) => {
        res.resume();
        resolve(res.statusCode);
      });
      req.on('error', (e) => resolve(`error:${e.code || e.message}`));
      req.end(JSON.stringify({a: 'x'.repeat(60)}));
    });

    check('C7 oversized POST answered with 413', result, 413);
  }

  // quit() calls process.exit(0); close the listener directly so the suite can finish.
  await new Promise((resolve) => {
    try {
      srv.server.closeAllConnections?.();
      srv.server.close(() => resolve());
    } catch { resolve(); }
  });
  await sleep(200);
};

// ---------- D. PTZ concurrency ----------
const testPtzConcurrency = async () => {
  const code = extractRange('const getIntegralCameraData = async', 'const getIntegralSingleCameraData');
  const build = new Function(
    'getCameras', 'getEncodeDevices', 'getAreas', 'getPTZPresets', 'getPTZPatrols', 'getCamerasPreviewURLs',
    `${code}\nreturn getIntegralCameraData;`
  );

  const run = async (ptzCount, nonPtzCount, envLimit) => {
    const cameras = [];

    for (let i = 0; i < ptzCount; i++) {
      cameras.push({cameraIndexCode: `P${i}`, cameraName: `PTZ ${i}`, capabilitySet: 'ptz', encodeDevIndexCode: 'ED1', regionIndexCode: 'R1'});
    }

    for (let i = 0; i < nonPtzCount; i++) {
      cameras.push({cameraIndexCode: `N${i}`, cameraName: `Fixed ${i}`, capabilitySet: 'event_pdc', encodeDevIndexCode: 'ED1', regionIndexCode: 'R1'});
    }

    let inFlight = 0;
    let maxInFlight = 0;
    const presetCalls = {};
    const patrolCalls = {};
    const previewRequests = [];

    const ptzCall = (registry) => async (indexCode) => {
      registry[indexCode] = (registry[indexCode] || 0) + 1;
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await sleep(25);
      inFlight -= 1;

      return {data: {list: [{id: `preset-${indexCode}`}]}};
    };

    if (undefined === envLimit) { delete process.env.PTZ_MAX_CONCURRENCY; }
    else { process.env.PTZ_MAX_CONCURRENCY = String(envLimit); }

    const fn = build(
      async () => ({data: {list: cameras.map((c) => ({...c}))}}),
      async () => ({data: {list: [{encodeDevIndexCode: 'ED1', encodeDevName: 'DVR'}]}}),
      async () => ({data: {list: [{indexCode: 'R1', name: 'Area'}]}}),
      ptzCall(presetCalls),
      ptzCall(patrolCalls),
      async (codes) => {
        previewRequests.push(codes);
        return {data: {list: {}}};
      }
    );

    const started = Date.now();
    const result = await fn('rtsp');
    const elapsed = Date.now() - started;
    const list = result?.data?.list || [];
    const ptz = list.filter((c) => c.capabilitySet.includes('ptz'));
    const fixed = list.filter((c) => ! c.capabilitySet.includes('ptz'));

    return {
      maxInFlight,
      elapsed,
      ptzCount: ptz.length,
      ptzWithPresets: ptz.filter((c) => Array.isArray(c.presets) && c.presets.length).length,
      ptzWithPatrols: ptz.filter((c) => Array.isArray(c.patrols) && c.patrols.length).length,
      fixedWithoutPresets: fixed.filter((c) => undefined === c.presets && undefined === c.patrols).length,
      duplicateCalls: [...new Set([
        ...Object.entries(presetCalls).filter(([, n]) => n > 1).map(([c]) => c),
        ...Object.entries(patrolCalls).filter(([, n]) => n > 1).map(([c]) => c),
      ])].length,
      cameraCalls: Object.keys(presetCalls).length,
      previewRequestCount: previewRequests.length,
      previewOrder: previewRequests[0] ? previewRequests[0].split(',') : [],
      totalCalls: ptzCount * 2,
    };
  };

  const def = await run(20, 5);
  check('D1 default limit: at most 4 cameras x 2 calls in flight', def.maxInFlight <= 8, true);
  check('D2 default actually uses the limit', def.maxInFlight, 8);
  check('D3 all 20 PTZ cameras received presets', def.ptzWithPresets, 20);
  check('D4 all 20 PTZ cameras received patrols', def.ptzWithPatrols, 20);
  check('D5 non-PTZ cameras were not queried', def.fixedWithoutPresets, 5);
  check('D6 no camera queried twice', def.duplicateCalls, 0);
  check('D7 exactly 2 calls per PTZ camera', [def.cameraCalls, def.totalCalls], [20, 40]);
  check('D8 preview URLs requested once', def.previewRequestCount, 1);
  check('D9 preview request keeps camera order', def.previewOrder, ['P0','P1','P2','P3','P4','P5','P6','P7','P8','P9','P10','P11','P12','P13','P14','P15','P16','P17','P18','P19','N0','N1','N2','N3','N4']);

  const env2 = await run(20, 0, 2);
  check('D10 PTZ_MAX_CONCURRENCY=2 honoured', env2.maxInFlight <= 4, true);
  check('D11 limit 2 also completes all cameras', [env2.ptzWithPresets, env2.ptzWithPatrols], [20, 20]);

  delete process.env.PTZ_MAX_CONCURRENCY;

  // 1 PTZ camera: worker count cannot exceed the camera count.
  const one = await run(1, 0);
  check('D12 single PTZ camera still processed', [one.ptzWithPresets, one.maxInFlight], [1, 2]);

  // Contrast: the old map-all pattern on the same data reaches 40 in flight.
  {
    let inFlight = 0;
    let max = 0;
    const call = async () => {
      inFlight += 1;
      max = Math.max(max, inFlight);
      await sleep(10);
      inFlight -= 1;
    };
    await Promise.all(Array.from({length: 20}, () => Promise.all([call(), call()])));
    check('D13 old pattern reached 40 concurrent calls', max, 40);
  }
};

(async () => {
  testFrontendTypo();
  await testSingleCameraProtocol();
  await testAbortedBody();
  await testPtzConcurrency();

  console.table(rows.map((r) => ({check: r.label, result: r.ok ? 'PASS' : 'FAIL', actual: r.actual, expected: r.expected})));
  const failures = rows.filter((r) => ! r.ok).length;
  console.log(failures ? `\nFAILURES: ${failures}` : '\nALL CHECKS PASSED');
  process.exitCode = failures ? 1 : 0;
  setTimeout(() => process.exit(process.exitCode || 0), 300);
})().catch((err) => {
  console.error('test error:', err?.stack || err);
  setTimeout(() => process.exit(1), 300);
});
