'use strict';

// Pinned Node test/parallel/test-process-exit-from-before-exit.js, placed
// behind a parent so the immediate terminating behavior is observable.
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
  process.on('beforeExit', common.mustCall(() => {
    setTimeout(common.mustNotCall(), 5);
    exit(0);
    assert.fail('process.exit() returned');
  }));
}
