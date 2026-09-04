'use strict';

// Supported behavior retained from test-assert-if-error.js. The upstream file
// also checks exact V8 stack-frame surgery, which the compiled runtime cannot
// observe without function and structured-stack metadata.
const assert = require('assert');

assert.ifError(null);
assert.ifError(undefined);

const original = new Error('test error');
let failure;
try {
  assert.ifError(original);
} catch (error) {
  failure = error;
}
assert.strictEqual(failure instanceof assert.AssertionError, true);
assert.strictEqual(failure.message, 'ifError got unwanted exception: test error');
assert.strictEqual(failure.actual, original);
assert.strictEqual(failure.expected, null);
assert.strictEqual(failure.operator, 'ifError');

assert.throws(() => assert.ifError(new TypeError()), {
  message: 'ifError got unwanted exception: TypeError',
  code: 'ERR_ASSERTION',
});
assert.throws(() => assert.ifError({ stack: false }), {
  message: 'ifError got unwanted exception: { stack: false }',
});
assert.throws(() => assert.ifError(false), {
  message: 'ifError got unwanted exception: false',
});

