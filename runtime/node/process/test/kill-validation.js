'use strict';

// Statically representable validation from pinned Node
// test/parallel/test-process-kill-pid.js. The upstream valid-case table replaces
// process._kill at runtime. Disposable child processes retain its supported
// default, named, and numeric signal normalization without replacing methods.
const common = require('../../../../third_party/node/test/common');
const assert = require('assert');
const { spawn } = require('child_process');

for (const value of ['SIGTERM', null, undefined, NaN, Infinity, -Infinity]) {
  assert.throws(() => process.kill(value), {
    code: 'ERR_INVALID_ARG_TYPE',
    name: 'TypeError',
    message: 'The "pid" argument must be of type number.' +
      common.invalidArgTypeHelper(value),
  });
}

assert.throws(() => process.kill(0, 'test'), {
  code: 'ERR_UNKNOWN_SIGNAL',
  name: 'TypeError',
  message: 'Unknown signal: test',
});
assert.throws(() => process.kill(0, 987), {
  code: 'EINVAL',
  name: 'Error',
  message: 'kill EINVAL',
});
assert.strictEqual(process.kill(process.pid, 0), true);

function testDelivery(signal, expectedSignal) {
  const child = spawn('cat');
  child.on('spawn', common.mustCall(() => {
    const delivered = signal === undefined ?
      process.kill(child.pid) :
      process.kill(child.pid, signal);
    assert.strictEqual(delivered, true);
  }));
  child.on('exit', common.mustCall((code, receivedSignal) => {
    assert.strictEqual(code, null);
    assert.strictEqual(receivedSignal, expectedSignal);
  }));
}

testDelivery(undefined, 'SIGTERM');
testDelivery('', 'SIGTERM');
testDelivery(NaN, 'SIGTERM');
testDelivery('SIGHUP', 'SIGHUP');
testDelivery(1, 'SIGHUP');
testDelivery(15, 'SIGTERM');
