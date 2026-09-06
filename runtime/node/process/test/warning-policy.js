// Flags: --no-warnings
'use strict';

// The statically representable policy from pinned Node
// test/parallel/test-process-warning.js. Runtime replacement of stderr.write
// and Error.toString is deliberately omitted; a child with captured stderr
// retains the supported non-Error suppression without replacing either.
const common = require('../../../../third_party/node/test/common');
const assert = require('assert');
const { spawn } = require('child_process');

if (process.argv[2] === 'non-error') {
  process.emit('warning', 'test');
} else {
  const child = spawn(process.execPath, [__filename, 'non-error']);
  let warningOutput = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    warningOutput += chunk;
  });
  child.on('close', common.mustCall((code, signal) => {
    assert.strictEqual(code, 0);
    assert.strictEqual(signal, null);
    assert.strictEqual(warningOutput, '');
  }));

  const suppressed = common.mustNotCall('suppressed deprecation was emitted');
  process.noDeprecation = true;
  process.on('warning', suppressed);
  process.emitWarning('suppressed', 'DeprecationWarning');

  process.nextTick(common.mustCall(() => {
    process.noDeprecation = false;
    process.removeListener('warning', suppressed);

    process.once('warning', common.mustCall((warning) => {
      assert.strictEqual(warning.name, 'Warning');

      process.once('warning', common.mustCall((detailed) => {
        assert.strictEqual(detailed.detail, 'foo');

        process.throwDeprecation = true;
        process.once('uncaughtException', common.mustCall((error) => {
          assert.match(error.toString(), /^DeprecationWarning: test$/);
          process.throwDeprecation = false;
        }));
        process.emitWarning('test', 'DeprecationWarning');
      }));
      process.emitWarning('test', { detail: 'foo' });
    }));
    process.emitWarning('test', {});
  }));
}
