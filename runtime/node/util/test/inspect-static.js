'use strict';

// Supported behavior retained from pinned Node v24.20.0
// parallel/test-util-inspect.js. The upstream file also depends on V8 private
// bindings, realms, prototypes, descriptors/getters, runtime Symbol hooks,
// function metadata/source, and arbitrary mutable property bags.
const assert = require('assert');
const { inspect } = require('util');

assert.strictEqual(inspect(undefined), 'undefined');
assert.strictEqual(inspect(null), 'null');
assert.strictEqual(inspect(-0), '-0');
assert.strictEqual(inspect(NaN), 'NaN');
assert.strictEqual(inspect(42n), '42n');
assert.strictEqual(inspect(Symbol('value')), 'Symbol(value)');
assert.strictEqual(inspect("both ' and \""), '`both \' and "`');

assert.strictEqual(
  inspect({ alpha: 1, beta: 'two' }),
  "{ alpha: 1, beta: 'two' }",
);
assert.strictEqual(inspect([1, 'two', true]), "[ 1, 'two', true ]");
assert.strictEqual(
  inspect({ outer: { inner: { value: 1 } } }, { depth: 1 }),
  '{ outer: { inner: [Object] } }',
);
assert.strictEqual(inspect({ z: 1, a: 2 }, { sorted: true }), '{ a: 2, z: 1 }');

class Cycle {
  constructor() {
    this.name = 'cycle';
    this.self = this;
  }
}
assert.strictEqual(
  inspect(new Cycle()),
  "<ref *1> { name: 'cycle', self: [Circular *1] }",
);

assert.strictEqual(inspect(new Set([2, 1])), 'Set(2) { 2, 1 }');
assert.strictEqual(inspect(new Map([['key', 3]])), "Map(1) { 'key' => 3 }");
assert.strictEqual(inspect(new Date(0)), '1970-01-01T00:00:00.000Z');
assert.strictEqual(inspect(/native/gi), '/native/gi');
assert.strictEqual(inspect(new Uint8Array([1, 2, 3])), 'Uint8Array(3) [ 1, 2, 3 ]');
assert.strictEqual(inspect(new WeakMap()), 'WeakMap { <items unknown> }');
assert.strictEqual(inspect(new WeakSet()), 'WeakSet { <items unknown> }');

assert.strictEqual(inspect('abcdef', { maxStringLength: 5 }), "'abcde'... 1 more character");
assert.strictEqual(inspect(42, { colors: true }), '\u001b[33m42\u001b[39m');
assert.strictEqual(inspect(() => 1), '[Function]');

