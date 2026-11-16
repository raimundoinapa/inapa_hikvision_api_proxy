// Proof for finding #8: cached captures must survive the DB refresh.
// The helper under test is extracted from the real public/js/script.js (not a copy).

const fs = require('node:fs');
const path = require('node:path');

const ROOT = 'E:/inapa_hikvision_api_proxy';
const SOURCE = path.join(ROOT, 'public', 'js', 'script.js');
const source = fs.readFileSync(SOURCE, 'utf8');

const extractFunction = (name) => {
  const start = source.indexOf(`const ${name} = `);
  if (-1 === start) { throw new Error(`${name} not found in script.js`); }

  let i = source.indexOf('{', start);
  let depth = 0;

  for (let j = i; j < source.length; j++) {
    if ('{' === source[j]) { depth++; }
    if ('}' === source[j]) {
      depth--;
      if (0 === depth) { return source.slice(start, j + 1); }
    }
  }

  throw new Error('unbalanced braces');
};

const rows = [];
const check = (label, actual, expected, ok = JSON.stringify(actual) === JSON.stringify(expected)) => {
  rows.push({label, actual: JSON.stringify(actual), expected: JSON.stringify(expected), ok});
};

const mergeCachedCaptures = new Function(`${extractFunction('mergeCachedCaptures')}; return mergeCachedCaptures;`)();

const cam = (code, extra = {}) => ({cameraIndexCode: code, cameraName: `Camera ${code}`, ...extra});
const captureOf = (code) => ({capture: `data:image/jpeg;base64,${code}`, captureTimestamp: 1700000000000});

(async () => {
  // 1) Normal case: every camera already has a cached snapshot.
  {
    const remote = [cam('A'), cam('B'), cam('C')];
    const local = [
      {cameraIndexCode: 'A', ...captureOf('A')},
      {cameraIndexCode: 'B', ...captureOf('B')},
      {cameraIndexCode: 'C', ...captureOf('C')},
    ];
    const merged = mergeCachedCaptures(remote, local);

    check('1. cached captures preserved', merged.map((c) => c.capture || null),
      ['data:image/jpeg;base64,A', 'data:image/jpeg;base64,B', 'data:image/jpeg;base64,C']);
    check('2. timestamps preserved', merged.map((c) => c.captureTimestamp || null),
      [1700000000000, 1700000000000, 1700000000000]);
    check('3. same array mutated in place', merged === remote, true);
  }

  // 2) A camera added in HikCentral that has no local record must not break the refresh.
  {
    const remote = [cam('A'), cam('NEW'), cam('B')];
    const local = [{cameraIndexCode: 'A', ...captureOf('A')}, {cameraIndexCode: 'B', ...captureOf('B')}];
    let threw = 'no';

    try { mergeCachedCaptures(remote, local); } catch (e) { threw = e.message; }

    check('4. new camera does not throw', threw, 'no');
    check('5. new camera left uncaptured', remote[1].capture || null, null);
    check('6. neighbours still merged', [remote[0].capture || null, remote[2].capture || null],
      ['data:image/jpeg;base64,A', 'data:image/jpeg;base64,B']);
  }

  // 3) Reordered remote list: match by code, not by position.
  {
    const remote = [cam('B'), cam('A')];
    const local = [{cameraIndexCode: 'A', ...captureOf('A')}, {cameraIndexCode: 'B', ...captureOf('B')}];
    mergeCachedCaptures(remote, local);

    check('7. reordered list keeps the right photo per camera',
      remote.map((c) => `${c.cameraIndexCode}=${c.capture.slice(-1)}`), ['B=B', 'A=A']);
  }

  // 4) Incomplete cache entries are ignored (capture without timestamp, or vice versa).
  {
    const remote = [cam('A'), cam('B'), cam('C')];
    const local = [
      {cameraIndexCode: 'A', capture: 'data:image/jpeg;base64,A'},                       // no timestamp
      {cameraIndexCode: 'B', captureTimestamp: 1700000000000},                          // no capture
      {cameraIndexCode: 'C', capture: 'data:image/jpeg;base64,C', captureTimestamp: 1},  // complete
    ];
    mergeCachedCaptures(remote, local);

    check('8. only complete cache entries are copied', remote.map((c) => c.capture || null), [null, null, 'data:image/jpeg;base64,C']);
  }

  // 5) Empty / undefined inputs.
  {
    const remote = [cam('A')];
    mergeCachedCaptures(remote, []);
    check('9. empty local store = no change', remote[0].capture || null, null);
    check('10. undefined local store = no throw', (() => {
      try { mergeCachedCaptures([cam('A')], undefined); return 'ok'; } catch (e) { return e.message; }
    })(), 'ok');
  }

  // ---------- source-level checks ----------
  const refreshStart = source.indexOf('if (dataObj.local?.length) {', source.indexOf('const runSetup'));
  const refreshEnd = source.indexOf('}', source.indexOf("await dbRequest._clear('cameras')", refreshStart));
  const refreshBlock = source.slice(refreshStart, refreshEnd);

  check('11. promise array removed from script.js', source.includes('localDbCaptures'), false);
  check('12. per-camera _get removed from refresh block', refreshBlock.includes("dbRequest._get('cameras'"), false);
  check('13. merge runs before the store is cleared',
    refreshBlock.indexOf('mergeCachedCaptures(') < refreshBlock.indexOf("dbRequest._clear('cameras')") ? 'before' : 'after', 'before');
  check('14. store is still cleared', refreshBlock.includes("await dbRequest._clear('cameras')"), true);

  const indexHtml = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
  check('15. index.html loads the patched script.js', /js\/script\.js/.test(indexHtml) && ! /js\/script\.min\.js/.test(indexHtml), true);

  // Contrast: reproduce the old pattern on the same data.
  {
    const remote = [cam('A')];
    const local = [{cameraIndexCode: 'A', ...captureOf('A')}];
    const promises = [Promise.resolve(local[0])];

    await Promise.all(promises);
    promises.forEach((c, i) => { if (c.capture && c.captureTimestamp) { remote[i].capture = c.capture; } });

    check('16. old promise-array pattern loses the capture', remote[0].capture || null, null);
    check('17. new helper keeps it', mergeCachedCaptures([cam('A')], local)[0].capture,
      'data:image/jpeg;base64,A');
  }

  console.table(rows.map((r) => ({check: r.label, result: r.ok ? 'PASS' : 'FAIL', actual: r.actual, expected: r.expected})));
  const failures = rows.filter((r) => ! r.ok).length;
  console.log(failures ? `\nFAILURES: ${failures}` : '\nALL CHECKS PASSED');
  process.exitCode = failures ? 1 : 0;
})();
