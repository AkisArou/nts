'use strict';
const { inspect } = require('util');

function* cases() {
  yield ['undefined', undefined];
  yield ['null', null];
  yield ['number', 42];
  yield ['negative zero', -0];
  yield ['NaN', NaN];
  yield ['bigint', 10n];
  yield ['string', 'hi'];
  yield ['symbol', Symbol('s')];
  yield ['registered symbol', Symbol.for('r')];
  yield ['well-known symbol', Symbol.iterator];
  yield ['boxed Number', new Number(1)];
  yield ['boxed String', new String('x')];
  yield ['boxed Boolean', new Boolean(true)];
  yield ['boxed BigInt', Object(10n)];
  yield ['boxed Symbol', Object(Symbol('s'))];
  yield ['plain object', { a: 1 }];
  yield ['null prototype', Object.create(null)];
  yield ['array', [1, 2]];
  yield ['sparse array', [1, , 3]];
  yield ['array with props', Object.assign([1], { z: 2 })];
  yield ['function', function named() {}];
  yield ['arrow', () => {}];
  yield ['async function', async function af() {}];
  yield ['generator function', function* gf() {}];
  yield ['async generator fn', async function* agf() {}];
  yield ['class', class Klass {}];
  yield ['class instance', new (class Point { constructor() { this.x = 1; } })()];
  yield ['Map', new Map([['a', 1]])];
  yield ['Set', new Set([1])];
  yield ['WeakMap', new WeakMap()];
  yield ['WeakSet', new WeakSet()];
  yield ['WeakRef', new WeakRef({})];
  yield ['FinalizationRegistry', new FinalizationRegistry(() => {})];
  yield ['Date', new Date(0)];
  yield ['invalid Date', new Date(NaN)];
  yield ['RegExp', /ab+c/gi];
  yield ['Error', new Error('boom')];
  yield ['TypeError', new TypeError('bad')];
  yield ['AggregateError', new AggregateError([new Error('a')], 'many')];
  yield ['error with cause', new Error('outer', { cause: new Error('inner') })];
  const pending = new Promise(() => {});
  const rejected = Promise.reject(new Error('nope')); rejected.catch(() => {});
  yield ['Promise pending', pending];
  yield ['Promise resolved', Promise.resolve(7)];
  yield ['Promise rejected', rejected];
  yield ['ArrayBuffer', new ArrayBuffer(4)];
  yield ['DataView', new DataView(new ArrayBuffer(4))];
  yield ['Uint8Array', new Uint8Array([1, 2])];
  yield ['Float64Array', new Float64Array([1.5])];
  yield ['BigInt64Array', new BigInt64Array([1n])];
  yield ['generator object', (function* () { yield 1; })()];
  yield ['async generator obj', (async function* () {})()];
  yield ['Map iterator', new Map([['a', 1]]).entries()];
  yield ['Set iterator', new Set([1]).values()];
  yield ['array iterator', [1][Symbol.iterator]()];
  yield ['string iterator', 'ab'[Symbol.iterator]()];
  yield ['toStringTag object', { [Symbol.toStringTag]: 'Tagged', a: 1 }];
  const circular = { name: 'c' }; circular.self = circular;
  yield ['circular', circular];
  yield ['getter object', Object.defineProperty({}, 'g', { get() { return 1; }, enumerable: true })];
  yield ['proxy', new Proxy({ a: 1 }, {})];
  yield ['deeply nested', { a: { b: { c: { d: { e: 1 } } } } }];
  yield ['Object.create(proto)', Object.create({ inherited: 1 })];
  yield ['args object', (function () { return arguments; })(1, 2)];
}

for (const [name, value] of cases()) {
  let text;
  try { text = inspect(value); } catch (e) { text = 'THREW ' + e.constructor.name + ': ' + e.message; }
  console.log('CENSUS\t' + name + '\t' + text.replace(/\n/g, '\\n'));
}
