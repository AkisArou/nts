// A hook that throws a bigint, the value upstream's fatal-error test does not
// throw.
//
// Preserves node v24.20.0 test/parallel/test-async-hooks-fatal-error.js, whose
// structure this is, with a bigint in place of its `null` and symbol. The
// expected line is node's own, measured on v24.20.0: `Error: 12n`, the `n`
// included.

'use strict';
const common = require('../common');
const assert = require('assert');
const childProcess = require('child_process');
const os = require('os');

if (process.argv[2] === 'child') {
  const { createHook } = require('async_hooks');
  createHook({
    init() {
      throw 12n;
    },
  }).enable();
  new Promise((resolve) => resolve()).then(common.mustCall());
} else {
  const cp = childProcess.spawnSync(process.execPath, [__filename, 'child'], {
    encoding: 'utf8',
  });
  assert.strictEqual(cp.status, 1);
  assert.strictEqual(cp.stderr.trim().split(os.EOL)[0], 'Error: 12n');
}
