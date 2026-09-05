'use strict';

// Supported behavior retained from pinned Node v24.20.0
// parallel/test-util-format.js. The upstream file also invokes runtime
// conversion hooks and observes prototypes, descriptors, constructors,
// function source/name metadata, and mutable global properties.
const assert = require('assert');
const { format, formatWithOptions } = require('util');

assert.strictEqual(format(), '');
assert.strictEqual(format(''), '');
assert.strictEqual(format('plain', 'text', 42), 'plain text 42');
assert.strictEqual(format({ value: 42 }), '{ value: 42 }');
assert.strictEqual(format([1, 'two']), "[ 1, 'two' ]");

assert.strictEqual(format('%d %i %f', '42.5', '42.5', '42.5'), '42.5 42 42.5');
assert.strictEqual(format('%s', 42n), '42n');
assert.strictEqual(format('%s', Symbol('value')), 'Symbol(value)');
assert.strictEqual(format('%j', { value: [1, 2] }), '{"value":[1,2]}');
assert.strictEqual(format('%o', { value: 1 }), '{ value: 1 }');
assert.strictEqual(format('%O', { value: 1 }), '{ value: 1 }');
assert.strictEqual(format('100%% %s', 'complete'), '100% complete');
assert.strictEqual(format('%s %s', 1), '1 %s');

class Cycle {
  constructor() {
    this.self = this;
  }
}
assert.strictEqual(format('%j', new Cycle()), '[Circular]');

assert.strictEqual(
  formatWithOptions({ numericSeparator: true }, '%d %s', 1234567, 1234567n),
  '1_234_567 1_234_567n',
);
