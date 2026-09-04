// Retained from pinned upstream `parallel/test-console.js`.
// The upstream file invokes Symbol-based util.inspect.custom and observes the
// hook function's metadata. This keeps its ordinary console behavior.
'use strict';

const common = require('../common');

const assert = require('assert');
const { Console } = require('console');

let stdout = '';
let stderr = '';
const out = {
  write(data) { stdout += data; },
  removeListener() {},
};
const err = {
  write(data) { stderr += data; },
  removeListener() {},
};
const instance = new Console(out, err, false);

instance.log('foo', 'bar');
instance.info('%s %d', 'value', 2);
instance.debug({ answer: 42 });
instance.dir({ foo: 1 });
instance.dirxml('xml', 3);
assert.strictEqual(
  stdout,
  "foo bar\nvalue 2\n{ answer: 42 }\n{ foo: 1 }\nxml 3\n",
);

instance.warn('warn', 1);
instance.error('%s', 'error');
instance.assert(true, 'not printed');
instance.assert(false);
instance.assert(false, '%s failed', 'check');
assert.strictEqual(
  stderr,
  'warn 1\nerror\nAssertion failed\nAssertion failed: check failed\n',
);

stderr = '';
instance.trace('at %s', 'call');
assert.match(stderr, /^Trace: at call\n/);

stdout = '';
instance.time('elapsed');
instance.timeLog('elapsed', 'data');
instance.timeEnd('elapsed');
const lines = stdout.trim().split('\n');
assert.match(lines[0], /^elapsed: \d+(\.\d{1,3})?(ms|s) data$/);
assert.match(lines[1], /^elapsed: \d+(\.\d{1,3})?(ms|s)$/);
assert.strictEqual(instance._times.has('elapsed'), false);

// `parallel/test-console.js` checks these alongside its Symbol-based custom
// inspection cases. Keep the ordinary warning contract even though that file
// cannot run as a whole in the static profile.
common.expectWarning('Warning', [
  ["Count for 'missing' does not exist", undefined],
  ["No such label 'missing' for console.timeLog()", undefined],
  ["No such label 'missing' for console.timeEnd()", undefined],
  ["Label 'duplicate' already exists for console.time()", undefined],
]);
instance.countReset('missing');
instance.timeLog('missing');
instance.timeEnd('missing');
instance.time('duplicate');
instance.time('duplicate');
instance.timeEnd('duplicate');
