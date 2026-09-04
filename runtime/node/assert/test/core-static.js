'use strict';

// Supported behavior retained from the broad test-assert.js. That upstream
// file also mixes realms, arbitrary property bags, source-text recovery,
// prototype constructors, custom inspection symbols, and function metadata.
const assert = require('assert');

assert(true);
assert.ok(1);
assert.equal(2, '2');
assert.notEqual(2, 3);
assert.strictEqual(NaN, NaN);
assert.notStrictEqual(0, -0);
assert.deepEqual({ value: 2 }, { value: 2 });
assert.deepStrictEqual([1, { value: 2 }], [1, { value: 2 }]);
assert.notDeepStrictEqual({ value: 2 }, { value: 3 });
assert.partialDeepStrictEqual(
  { user: { name: 'Ada', active: true }, extra: 1 },
  { user: { name: 'Ada' } },
);
assert.match('native typescript', /type/);
assert.doesNotMatch('native typescript', /java/);

assert.throws(() => assert.strictEqual(1, 2), {
  name: 'AssertionError',
  code: 'ERR_ASSERTION',
  operator: 'strictEqual',
  actual: 1,
  expected: 2,
  generatedMessage: true,
});
assert.throws(() => { throw new TypeError('bad input'); }, TypeError);
assert.throws(
  () => { throw { code: 'E_STATIC', message: 'bad input', cause: { id: 7 } }; },
  { code: 'E_STATIC', message: /bad input/, cause: { id: 7 } },
);
assert.throws(
  () => assert.throws(() => { throw { code: 'E_STATIC' }; }, { arbitrary: 1 }),
  { code: 'ERR_INVALID_ARG_VALUE' },
);
assert.throws(() => { throw 7; }, (value) => value === 7);

assert.doesNotThrow(() => 1 + 1);
assert.throws(
  () => assert.doesNotThrow(() => { throw new TypeError('bad input'); }, TypeError),
  { code: 'ERR_ASSERTION', operator: 'doesNotThrow' },
);
const range = new RangeError('range');
assert.throws(
  () => assert.doesNotThrow(() => { throw range; }, TypeError),
  (error) => error === range,
);

assert.throws(() => assert.deepStrictEqual(undefined), {
  code: 'ERR_MISSING_ARGS',
});
assert.throws(() => assert.fail('explicit failure'), {
  code: 'ERR_ASSERTION',
  message: 'explicit failure',
  operator: 'fail',
});

assert.strict.equal(1, 1);
assert.throws(() => assert.strict.equal(1, '1'), {
  code: 'ERR_ASSERTION',
  operator: 'strictEqual',
});

