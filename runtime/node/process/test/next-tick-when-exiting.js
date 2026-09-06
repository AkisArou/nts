'use strict';

// Pinned Node test/parallel/test-next-tick-when-exiting.js, placed behind a
// parent so process.exit() can terminate normally while preserving a verdict.
const common = require('../../../../third_party/node/test/common');
const assert = require('assert');

if (process.argv[2] === undefined) {
  const { spawn } = require('child_process');
  spawn(process.execPath, [__filename, 'child']).on(
    'exit',
    common.mustCall((code, signal) => {
      assert.strictEqual(code, 0);
      assert.strictEqual(signal, null);
    }),
  );
} else {
  const exit = process.exit;
  const nextTick = process.nextTick;
  process.on('exit', () => {
    assert.strictEqual(process._exiting, true);
    nextTick(common.mustNotCall('process is exiting, should not be called'));
  });
  exit();
}
