'use strict';

// The statically representable portion of pinned Node
// test/parallel/test-process-exit-code-validation.js. The upstream file also
// deletes process.exitCode to inspect descriptor non-configurability, a Section
// 13 metaobject concern; all value normalization and exit behavior remain here.
const common = require('../../../../third_party/node/test/common');
const assert = require('assert');
const { spawnSync } = require('node:child_process');

const invalids = [
  { code: '', expected: 1, pattern: "Received type string \\(''\\)$" },
  { code: '1 one', expected: 1, pattern: "Received type string \\('1 one'\\)$" },
  { code: 'two', expected: 1, pattern: "Received type string \\('two'\\)$" },
  { code: {}, expected: 1, pattern: 'Received an instance of Object$' },
  { code: [], expected: 1, pattern: 'Received an instance of Array$' },
  { code: true, expected: 1, pattern: 'Received type boolean \\(true\\)$' },
  { code: false, expected: 1, pattern: 'Received type boolean \\(false\\)$' },
  { code: 2n, expected: 1, pattern: 'Received type bigint \\(2n\\)$' },
  { code: 2.1, expected: 1, pattern: 'Received 2.1$' },
  { code: Infinity, expected: 1, pattern: 'Received Infinity$' },
  { code: NaN, expected: 1, pattern: 'Received NaN$' },
];
const valids = [
  { code: 1, expected: 1 },
  { code: '2', expected: 2 },
  { code: undefined, expected: 0 },
  { code: null, expected: 0 },
  { code: 0, expected: 0 },
  { code: '0', expected: 0 },
];
const cases = [...invalids, ...valids];

if (process.argv[2] === undefined) {
  for (const invalid of invalids) {
    assert.throws(() => {
      process.exitCode = invalid.code;
    }, new RegExp(invalid.pattern));
  }
  for (const valid of valids) process.exitCode = valid.code;
  for (const [value, normalized] of [
    [2_147_483_648, -2_147_483_648],
    [4_294_967_295, -1],
    [4_294_967_296, 0],
    [-2_147_483_649, 2_147_483_647],
  ]) {
    process.exitCode = value;
    assert.strictEqual(process.exitCode, normalized);
  }
  process.exitCode = 0;

  const test = common.mustCallAtLeast((index, assign) => {
    const { status } = spawnSync(process.execPath, [
      __filename,
      String(index),
      assign ? 'assign' : 'exit',
    ]);
    assert.strictEqual(status, cases[index].expected);
  });
  for (let index = 0; index < cases.length; index++) {
    test(index, false);
    test(index, true);
  }
} else {
  const index = Number.parseInt(process.argv[2], 10);
  assert(!Number.isNaN(index));
  const testCase = cases[index];
  assert(testCase !== undefined);
  if (process.argv[3] === 'assign') {
    process.exitCode = testCase.code;
  } else {
    process.exit(testCase.code);
  }
}
