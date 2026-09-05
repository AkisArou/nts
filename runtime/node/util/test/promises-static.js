'use strict';

// Supported behavior retained from pinned Node v24.20.0
// parallel/test-util-promisify.js and parallel/test-util-callbackify.js. The
// upstream files also observe custom Symbol properties, copied descriptors,
// function name/length, prototype identity, vm realms, and child-process V8
// stacks, all outside NTS's static function representation.
const common = require('../common');
const assert = require('assert');
const { callbackify, promisify } = require('util');

function callbackOperation(receiver, value, callback) {
  assert.strictEqual(this, receiver);
  callback(null, value);
}

const receiver = { name: 'receiver' };
promisify(callbackOperation).call(receiver, receiver, 42).then(common.mustCall((value) => {
  assert.strictEqual(value, 42);
}));

const expectedError = new Error('expected');
promisify((callback) => callback(expectedError))().then(
  common.mustNotCall(),
  common.mustCall((error) => assert.strictEqual(error, expectedError)),
);

promisify((callback) => callback(null, 'first', 'ignored'))().then(common.mustCall((value) => {
  assert.strictEqual(value, 'first');
}));

const callbackified = callbackify(function promiseOperation(value) {
  assert.strictEqual(this, receiver);
  return Promise.resolve(value * 2);
});
callbackified.call(receiver, 21, common.mustCall(function(error, value) {
  assert.strictEqual(this, receiver);
  assert.strictEqual(error, null);
  assert.strictEqual(value, 42);
}));

callbackify(() => Promise.reject(expectedError))(common.mustCall((error, value) => {
  assert.strictEqual(error, expectedError);
  assert.strictEqual(value, undefined);
}));

callbackify(() => Promise.reject(null))(common.mustCall((error, value) => {
  assert.strictEqual(error.code, 'ERR_FALSY_VALUE_REJECTION');
  assert.strictEqual(error.reason, null);
  assert.strictEqual(value, undefined);
}));

const thenable = {
  then(resolve) {
    resolve('thenable');
  },
};
callbackify(() => thenable)(common.mustCall((error, value) => {
  assert.strictEqual(error, null);
  assert.strictEqual(value, 'thenable');
}));

for (const invalid of [undefined, null, true, 0, 'text', {}, []]) {
  assert.throws(() => promisify(invalid), { code: 'ERR_INVALID_ARG_TYPE' });
  assert.throws(() => callbackify(invalid), { code: 'ERR_INVALID_ARG_TYPE' });
}

const needsCallback = callbackify(() => Promise.resolve(1));
assert.throws(() => needsCallback('not a callback'), {
  code: 'ERR_INVALID_ARG_TYPE',
});
