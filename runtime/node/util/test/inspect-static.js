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
assert.strictEqual(inspect(-0, { numericSeparator: true }), '-0');
assert.strictEqual(inspect(Number.MIN_VALUE, { numericSeparator: true }), '5e-324');
assert.strictEqual(inspect(NaN), 'NaN');
assert.strictEqual(inspect(42n), '42n');
assert.strictEqual(inspect(Symbol('value')), 'Symbol(value)');
assert.strictEqual(inspect("both ' and \""), '`both \' and "`');
assert.strictEqual(inspect('\u0099\u000e\u000b'), "'\\x99\\x0E\\x0B'");
assert.strictEqual(inspect('\ud800\udc00\ud800'), "'𐀀\\ud800'");
assert.strictEqual(inspect("'\"${value}"), "'\\'\"${value}'");

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
const arrayBuffer = new Uint8Array([1, 2, 3, 4]).buffer;
assert.strictEqual(
  inspect(arrayBuffer, true),
  'ArrayBuffer { [Uint8Contents]: <01 02 03 04>, [byteLength]: 4 }',
);
assert.strictEqual(
  inspect(new Uint8Array([1, 2, 3]).buffer, {
    showHidden: true,
    maxArrayLength: 2,
    breakLength: 82,
  }),
  'ArrayBuffer { [Uint8Contents]: <01 02 ... 1 more byte>, [byteLength]: 3 }',
);
assert.strictEqual(
  inspect(new Uint8Array([0xbd, 0xf8, 0xf7, 0xea, 0x41, 0xac, 0x1b]).buffer),
  'ArrayBuffer {\n' +
    '  [Uint8Contents]: <bd f8 f7 ea 41 ac 1b>,\n' +
    '  [byteLength]: 7\n' +
    '}',
);
assert.strictEqual(
  inspect(new DataView(arrayBuffer, 1, 2)),
  'DataView {\n' +
    '  [byteLength]: 2,\n' +
    '  [byteOffset]: 1,\n' +
    '  [buffer]: ArrayBuffer { [Uint8Contents]: <01 02 03 04>, [byteLength]: 4 }\n' +
    '}',
);
assert.strictEqual(inspect(new WeakMap()), 'WeakMap { <items unknown> }');
assert.strictEqual(inspect(new WeakSet()), 'WeakSet { <items unknown> }');

assert.strictEqual(inspect('abcdef', { maxStringLength: 5 }), "'abcde'... 1 more character");
assert.strictEqual(inspect(42, { colors: true }), '\u001b[33m42\u001b[39m');
assert.strictEqual(inspect(new Number(3), { colors: true }), '\u001b[33m[Number: 3]\u001b[39m');
assert.strictEqual(
  inspect(new String('abc'), { colors: true }),
  "\u001b[32m[String: 'abc']\u001b[39m",
);
assert.strictEqual(
  inspect(new Boolean(false), { colors: true }),
  '\u001b[33m[Boolean: false]\u001b[39m',
);
assert.strictEqual(
  inspect([1, 2, 3, 4, 5, 6, 7], { colors: true }),
  '[\n' +
    '  \u001b[33m1\u001b[39m, \u001b[33m2\u001b[39m, \u001b[33m3\u001b[39m, \u001b[33m4\u001b[39m,\n' +
    '  \u001b[33m5\u001b[39m, \u001b[33m6\u001b[39m, \u001b[33m7\u001b[39m\n' +
    ']',
);
assert.strictEqual(
  inspect(new Uint8Array([1]).buffer, { colors: true }),
  'ArrayBuffer { \u001b[36m[Uint8Contents]\u001b[39m: <01>, ' +
    '\u001b[32m[byteLength]\u001b[39m: \u001b[33m1\u001b[39m }',
);
assert.strictEqual(inspect(() => 1), '[Function]');

// `util.inspect.defaultOptions`, which node documents and programs use to set a
// depth or turn on colours globally. Retained here because the upstream file that
// covers it is a §13 non-goal for other reasons, and this behaviour is not one:
// it is a property descriptor and an object merge.
//
// All four of these were wrong on 2026-09-10 and none of them was visible to any
// test. The property was a plain assignment, so it was enumerable where node's is
// not, and setting it replaced the property's value while `inspect` and `format`
// went on reading the module's live defaults object -- making the documented way
// to change the default depth a silent no-op.
{
  const descriptor = Object.getOwnPropertyDescriptor(inspect, 'defaultOptions');
  assert.strictEqual(typeof descriptor.get, 'function');
  assert.strictEqual(descriptor.enumerable, false);

  const deep = { a: { b: { c: { d: { e: 1 } } } } };
  const held = inspect.defaultOptions;
  const before = inspect(deep);
  const keysBefore = Object.keys(held).length;
  const depthBefore = held.depth;
  try {
    inspect.defaultOptions = { depth: 5 };
    // The same object, merged into -- not a replacement.
    assert.strictEqual(inspect.defaultOptions, held);
    assert.strictEqual(Object.keys(inspect.defaultOptions).length, keysBefore);
    assert.strictEqual(inspect.defaultOptions.depth, 5);
    // And the change reaches the implementation, which is the point of it.
    assert.notStrictEqual(inspect(deep), before);

    assert.throws(() => { inspect.defaultOptions = 5; },
                  { code: 'ERR_INVALID_ARG_TYPE' });
    assert.throws(() => { inspect.defaultOptions = null; },
                  { code: 'ERR_INVALID_ARG_TYPE' });
  } finally {
    inspect.defaultOptions = { depth: depthBefore };
  }
  assert.strictEqual(inspect(deep), before);
}
