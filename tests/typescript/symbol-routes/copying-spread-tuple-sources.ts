/*---
description: Two typed tuple sources preserve symbol insertion order while a later spread replaces the same identity.
features: [ts-symbol-route-copying, ts-symbols, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-record, ts-unknown, ts-computed-keys, ts-spread, ts-tuples, ts-interfaces]
---*/
// A tuple field carries two symbol-bearing records; node spreads both, keeps the first insertion position and copies only enumerable later keys.
type Value = number | string | undefined;
type Table = Record<PropertyKey, Value>;
const first: unique symbol = Symbol("same"), second: unique symbol = Symbol("same"), hidden: unique symbol = Symbol("hidden");
function blank(): Table { return {}; }
function put(table: object, key: PropertyKey, value: Value, show: boolean = true): void { Object.defineProperty(table, key, { value, writable: true, enumerable: show, configurable: true }); }
function ownKeys(table: object): PropertyKey[] { return Reflect.ownKeys(table); }
function tokens(table: object): symbol[] { return Object.getOwnPropertySymbols(table); }
function read(table: object, key: PropertyKey): unknown { return Reflect.get(table, key); }
function write(table: object, key: PropertyKey, value: Value): void { assert.sameValue(Reflect.set(table, key, value), true); }
interface PairHolder { pair: [Table, Table]; }
function copy(holder: PairHolder): Table { return { ...holder.pair[0], ...holder.pair[1] }; }
for (const initial of [-0, NaN, undefined, 7]) for (const show of [false, true]) {
  const left = blank(), right = blank(); put(left, second, 5); put(left, first, initial); put(left, "tail", 8);
  put(right, first, 13, show); put(right, "2", 2); put(right, hidden, 21); put(right, second, 34);
  const holder: PairHolder = { pair: [left, right] }, result = copy(holder);
  assert.compareArray(ownKeys(result), ["2", "tail", second, first, hidden]); assert.compareArray(tokens(result), [second, first, hidden]);
  assert.compareArray([read(result, "2"), read(result, "tail"), read(result, second), read(result, first), read(result, hidden)], [2, 8, 34, show ? 13 : initial, 21]);
  assert.compareArray(ownKeys(left), ["tail", second, first]); assert.compareArray(ownKeys(right), ["2", first, hidden, second]);
  write(result, first, 55); assert.sameValue(read(left, first), initial); assert.sameValue(read(right, first), 13); write(right, second, 89); assert.sameValue(read(right, second), 89); assert.sameValue(read(result, second), 34); assert.sameValue(read(result, first), 55);
}
