'use strict';

// Applicable constructor behavior retained from pinned upstream
// test-whatwg-url-custom-searchparams-constructor.js. Two cases in that file
// require enumeration of arbitrary own Symbol keys, a section-13 property-map
// operation that a statically laid-out object cannot perform.
const assert = require('assert');
const { URLSearchParams } = require('url');

function iterable(values) {
  return Object.assign(() => {}, {
    [Symbol.iterator]() {
      return values[Symbol.iterator]();
    },
  });
}

assert.strictEqual(new URLSearchParams(undefined).toString(), '');
assert.strictEqual(new URLSearchParams(null).toString(), 'null=');
assert.strictEqual(new URLSearchParams(false).toString(), 'false=');
assert.strictEqual(new URLSearchParams(0).toString(), '0=');
assert.strictEqual(
  new URLSearchParams(iterable([['key', 'value'], ['second', 'two']])).toString(),
  'key=value&second=two',
);
assert.strictEqual(
  new URLSearchParams(iterable([['key', 'value']].map(iterable))).toString(),
  'key=value',
);
assert.strictEqual(
  new URLSearchParams({ hasOwnProperty: 1 }).toString(),
  'hasOwnProperty=1',
);

const tupleError = {
  code: 'ERR_INVALID_TUPLE',
  name: 'TypeError',
  message: 'Each query pair must be an iterable [name, value] tuple',
};
const iterableError = {
  code: 'ERR_ARG_NOT_ITERABLE',
  name: 'TypeError',
  message: 'Query pairs must be iterable',
};

assert.throws(() => new URLSearchParams([[1]]), tupleError);
assert.throws(() => new URLSearchParams([[1, 2, 3]]), tupleError);
assert.throws(() => new URLSearchParams({ [Symbol.iterator]: 42 }), iterableError);
assert.throws(() => new URLSearchParams([{}]), tupleError);
assert.throws(() => new URLSearchParams(['a']), tupleError);
assert.throws(() => new URLSearchParams([null]), tupleError);
assert.throws(() => new URLSearchParams([{ [Symbol.iterator]: 42 }]), tupleError);
assert.throws(
  () => new URLSearchParams(iterable([['key', 'value', 'extra']])),
  tupleError,
);

const uncoercible = {
  toString() { throw new Error('toString'); },
  valueOf() { throw new Error('valueOf'); },
};
assert.throws(() => new URLSearchParams({ key: uncoercible }), /^Error: toString$/);
assert.throws(() => new URLSearchParams([['key', uncoercible]]), /^Error: toString$/);

const symbol = Symbol();
const symbolError = /^TypeError: Cannot convert a Symbol value to a string$/;
assert.throws(() => new URLSearchParams(symbol), symbolError);
assert.throws(() => new URLSearchParams({ key: symbol }), symbolError);
assert.throws(() => new URLSearchParams([[symbol, 'value']]), symbolError);
assert.throws(() => new URLSearchParams([['key', symbol]]), symbolError);
