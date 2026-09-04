'use strict';

// Derived from Node v24.20.0
// `test/parallel/test-async-hooks-fatal-error.js`. The upstream file spawns
// `process.execPath` with itself, which loads Node's built-in async_hooks in
// the child. This launches the same cases through the conformance runner so
// the child receives the module under test (and the compiled addon when this
// test is running in the compiled lane).
const assert = require('assert');
const childProcess = require('child_process');
const os = require('os');
const path = require('path');

const root = path.resolve(__dirname, '../../../..');
const runner = path.join(root, 'tooling/conformance/run-one.mjs');
const fixture = path.join(__dirname, 'fixtures/fatal-hook.js');
// `run-one.mjs <module> <file> <addon>` is the process executing this test.
const addon = process.argv[4] || '-';

for (const hook of ['init', 'before', 'after', 'destroy', 'promiseResolve']) {
  for (const [value, expected] of [
    ['null', 'Error: null'],
    ['symbol', 'Error: Symbol(foo)'],
  ]) {
    const child = childProcess.spawnSync(
      process.execPath,
      [runner, 'async_hooks', fixture, addon],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          NTS_FATAL_HOOK: hook,
          NTS_FATAL_VALUE: value,
        },
      },
    );

    assert.strictEqual(child.status, 1, hook);
    assert.strictEqual(child.stderr.trim().split(os.EOL)[0], expected, hook);
  }
}
