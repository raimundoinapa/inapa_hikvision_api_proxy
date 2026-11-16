// Proof for finding #9 (previewURL positional mapping).
// The function under test is extracted from the real hikcentral.js at runtime;
// runFetch is replaced by a fake that simulates HikCentral responses.
const fs = require('node:fs');
const path = require('node:path');

const ROOT = 'E:/inapa_hikvision_api_proxy';
const source = fs.readFileSync(path.join(ROOT, 'hikcentral.js'), 'utf8');
const lines = source.split('\n');

const start = lines.findIndex((l) => l.includes('const getCamerasPreviewURLs = async'));
const end = lines.findIndex((l, i) => i > start && l.includes('const getCamera = async (indexCode'));

if (start < 0 || end < 0) { throw new Error('could not locate getCamerasPreviewURLs'); }

const code = lines.slice(start, end).join('\n');

const buildFunction = (runFetch, params, endpoints, apiServerUrl, maxSimultaneousStreams, getInvalidIndexCodeObject) => new Function(
  'runFetch', 'params', 'endpoints', 'apiServerUrl', 'maxSimultaneousStreams', 'getInvalidIndexCodeObject',
  `${code}\nreturn getCamerasPreviewURLs;`
)(runFetch, params, endpoints, apiServerUrl, maxSimultaneousStreams, getInvalidIndexCodeObject);

const rows = [];
const check = (label, actual, expected, ok = JSON.stringify(actual) === JSON.stringify(expected)) => {
  rows.push({label, actual: JSON.stringify(actual), expected: JSON.stringify(expected), ok});
};

const entry = (url) => ({url, authentication: 'authentication-value'});

const makeRunFetch = (main, sub) => {
  const calls = [];
  const fn = async (url, options) => {
    const body = JSON.parse(options.body);
    calls.push({streamType: body.streamType, codes: String(body.cameraIndexCodes).split(','), count: String(body.cameraIndexCodes).split(',').length});

    if (null === main) {
      return {status: 'success', ok: true, httpStatusCode: 200, data: {code: '2', msg: 'Incorrect request parameter. [cameraIndexCode parameter error]'}};
    }

    const entries = 0 === body.streamType ? main : sub;
    return {status: 'success', ok: true, httpStatusCode: 200, data: {code: '0', msg: 'Success', list: entries}};
  };
  fn.calls = calls;
  return fn;
};

const invoke = async ({codes, main, sub, protocol = 'rtsp', checkForMax = false}) => {
  const runFetch = makeRunFetch(main, sub);
  const params = {previewURLs: {method: 'POST', headers: {}, body: ''}};
  const fn = buildFunction(runFetch, params, {previewURLs: '/previewURLs'}, 'http://mock', 16, () => ({status: 'fail', data: 'Invalid index code'}));
  const result = await fn(codes, protocol, checkForMax);

  return {result, calls: runFetch.calls};
};

(async () => {
  // 1) Complete response: normal mapping.
  {
    const {result, calls} = await invoke({
      codes: 'A,B,C',
      main: [entry('main-A'), entry('main-B'), entry('main-C')],
      sub: [entry('sub-A'), entry('sub-B'), entry('sub-C')],
    });
    const map = result.data.list;

    check('1. complete response keeps success', result.status, 'success');
    check('2. all three cameras mapped', Object.keys(map), ['A', 'B', 'C']);
    check('3. main streams in request order', [map.A.mainStream, map.B.mainStream, map.C.mainStream], ['main-A', 'main-B', 'main-C']);
    check('4. sub streams in request order', [map.A.subStream, map.B.subStream, map.C.subStream], ['sub-A', 'sub-B', 'sub-C']);
    check('5. two requests (main + sub)', calls.map((c) => c.streamType), [0, 1]);
  }

  // 2) HikCentral omits one entry -> must fail, never shift.
  {
    const {result} = await invoke({
      codes: 'A,B,C',
      main: [entry('main-B'), entry('main-C')],
      sub: [entry('sub-B'), entry('sub-C')],
    });

    check('6. missing main entry -> fail', result.status, 'fail');
    check('7. missing main entry -> no map at all', null == result.data.list, true);
    check('8. msg reports returned vs requested', /2 .*3/.test(result.data.msg) ? 'yes' : result.data.msg, 'yes');
  }

  // 3) Sub-stream short, main complete -> main still usable, no sub streams shifted.
  {
    const {result} = await invoke({
      codes: 'A,B,C',
      main: [entry('main-A'), entry('main-B'), entry('main-C')],
      sub: [entry('sub-B'), entry('sub-C')],
    });
    const map = result.data.list;

    check('9. main complete + sub short -> success', result.status, 'success');
    check('10. main streams still mapped', [map.A.mainStream, map.B.mainStream, map.C.mainStream], ['main-A', 'main-B', 'main-C']);
    check('11. no sub stream assigned from shifted positions', [map.A.subStream, map.B.subStream, map.C.subStream], [undefined, undefined, undefined]);
  }

  // 4) HikCentral error response (unknown camera code) -> untouched error object.
  {
    const {result} = await invoke({codes: 'A,B', main: null, sub: null});

    check('12. upstream error code preserved', result.data.code, '2');
    check('13. upstream error has no map', null == result.data.list, true);
    check('14. upstream error message preserved', /cameraIndexCode parameter error/.test(result.data.msg) ? 'yes' : result.data.msg, 'yes');
  }

  // 5) Empty url for one camera stays empty (does not fail the batch).
  {
    const {result} = await invoke({
      codes: 'A,B,C',
      main: [entry('main-A'), entry(''), entry('main-C')],
      sub: [entry('sub-A'), entry('sub-B'), entry('sub-C')],
    });
    const map = result.data.list;

    check('15. empty url -> empty mainStream', map.B.mainStream, '');
    check('16. neighbours unaffected', [map.A.mainStream, map.C.mainStream], ['main-A', 'main-C']);
  }

  // 6) checkForMax still caps at 16 and the count check uses the capped list.
  {
    const codes = Array.from({length: 20}, (_, i) => `C${i}`).join(',');
    const {result, calls} = await invoke({
      codes,
      main: Array.from({length: 16}, (_, i) => entry(`main-C${i}`)),
      sub: Array.from({length: 16}, (_, i) => entry(`sub-C${i}`)),
      checkForMax: true,
    });

    check('17. capped request asks for 16 codes', [calls[0].count, calls[1].count], [16, 16]);
    check('18. capped response maps 16 cameras', Object.keys(result.data.list).length, 16);
  }

  // 7) A genuine reorder cannot be detected (documented limitation).
  {
    const {result} = await invoke({
      codes: 'A,B,C',
      main: [entry('main-C'), entry('main-A'), entry('main-B')],
      sub: [entry('sub-C'), entry('sub-A'), entry('sub-B')],
    });

    check('19. reordered response is still positional (no id field exists)', result.data.list.A.mainStream, 'main-C');
  }

  // 8) Input validation unchanged.
  {
    const badProtocol = await invoke({codes: 'A', main: [entry('main-A')], sub: [entry('sub-A')], protocol: 'quic'});
    check('20. invalid protocol rejected', badProtocol.result.status, 'fail');

    const badCodes = await invoke({codes: '', main: [entry('main-A')], sub: [entry('sub-A')]});
    check('21. empty index codes rejected', badCodes.result.status, 'fail');
  }

  // Source-level guards.
  check('22. mismatch guard present in source', source.includes('subStreamComplete') && source.includes('mainStreamComplete'), true);
  check('23. no mapping in a bare mainStreamUrls?.length block', /if \(mainStreamUrls\?\.length\) \{\s*mainStreamUrls\.forEach/.test(source), false);

  console.table(rows.map((r) => ({check: r.label, result: r.ok ? 'PASS' : 'FAIL', actual: r.actual, expected: r.expected})));
  const failures = rows.filter((r) => ! r.ok).length;
  console.log(failures ? `\nFAILURES: ${failures}` : '\nALL CHECKS PASSED');
  process.exitCode = failures ? 1 : 0;
})().catch((err) => {
  console.error('test error:', err?.stack || err);
  process.exitCode = 1;
});
