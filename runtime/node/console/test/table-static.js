// Retained from pinned upstream `parallel/test-console-table.js`.
// The upstream file also observes anonymous-function metadata and
// Object.prototype itself, plus Map/Set iterator brands; those are §13
// non-goals. These cases retain the table paths using statically representable
// arrays, maps, sets, records, and typed arrays.
'use strict';

require('../common');

const assert = require('assert');
const { Console } = require('console');

let output = '';
const stream = {
  write(value) {
    output = value;
  },
  removeListener() {},
};
const instance = new Console(stream, process.stderr, false);

function test(data, properties, expected) {
  if (expected === undefined) {
    expected = properties;
    properties = undefined;
  }
  instance.table(data, properties);
  assert.strictEqual(output, expected.trimStart());
}

assert.throws(() => instance.table([], false), {
  code: 'ERR_INVALID_ARG_TYPE',
});

test(Symbol(), undefined, 'Symbol()\n');

test([1, 2, 3], undefined, `
┌─────────┬────────┐
│ (index) │ Values │
├─────────┼────────┤
│ 0       │ 1      │
│ 1       │ 2      │
│ 2       │ 3      │
└─────────┴────────┘
`);

test([Symbol(), 5, [10]], undefined, `
┌─────────┬────┬──────────┐
│ (index) │ 0  │ Values   │
├─────────┼────┼──────────┤
│ 0       │    │ Symbol() │
│ 1       │    │ 5        │
│ 2       │ 10 │          │
└─────────┴────┴──────────┘
`);

test(new Map([['a', 1], [Symbol(), [2]]]), undefined, `
┌───────────────────┬──────────┬────────┐
│ (iteration index) │ Key      │ Values │
├───────────────────┼──────────┼────────┤
│ 0                 │ 'a'      │ 1      │
│ 1                 │ Symbol() │ [ 2 ]  │
└───────────────────┴──────────┴────────┘
`);

test(new Set([1, 2, 3]), undefined, `
┌───────────────────┬────────┐
│ (iteration index) │ Values │
├───────────────────┼────────┤
│ 0                 │ 1      │
│ 1                 │ 2      │
│ 2                 │ 3      │
└───────────────────┴────────┘
`);

test({ a: { a: 1, b: 2, c: 3 } }, undefined, `
┌─────────┬───┬───┬───┐
│ (index) │ a │ b │ c │
├─────────┼───┼───┼───┤
│ a       │ 1 │ 2 │ 3 │
└─────────┴───┴───┴───┘
`);

test(new Uint8Array([1, 2, 3]), undefined, `
┌─────────┬────────┐
│ (index) │ Values │
├─────────┼────────┤
│ 0       │ 1      │
│ 1       │ 2      │
│ 2       │ 3      │
└─────────┴────────┘
`);

test([], undefined, `
┌─────────┐
│ (index) │
├─────────┤
└─────────┘
`);

test([{ foo: 10 }, { foo: 20 }], ['__proto__'], `
┌─────────┬───────────┐
│ (index) │ __proto__ │
├─────────┼───────────┤
│ 0       │           │
│ 1       │           │
└─────────┴───────────┘
`);
