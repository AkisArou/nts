'use strict';

// Statically representable formatting and native-sink behavior from pinned
// Node test/parallel/test-process-raw-debug.js. That file also replaces
// process.nextTick and stderr.write at runtime, which are Section 13 concerns.
const common = require('../../../../third_party/node/test/common');
const assert = require('assert');
const os = require('os');

if (process.argv[2] === undefined) {
  const { spawn } = require('child_process');
  const child = spawn(process.execPath, [__filename, 'child']);
  let output = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    output += chunk;
  });
  child.on('close', common.mustCall((code, signal) => {
    assert.strictEqual(code, 0);
    assert.strictEqual(signal, null);
    assert.strictEqual(output, `I can still debug!${os.EOL}`);
  }));
} else {
  process._rawDebug('I can still %s!', 'debug');
}
