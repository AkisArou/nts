/*---
description: Assigning multiple typed records updates shared symbol keys without moving their positions.
features: [ts-symbol-route-copying, ts-symbols, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-record, ts-unknown, ts-computed-keys, ts-spread]
---*/
// A Record source array crosses a parameter; node applies sources left to right, preserves each symbol identity and ignores a later hidden replacement.
type Value = number | string | undefined;
type Table = Record<PropertyKey, Value>;
const first: unique symbol = Symbol("same"), second: unique symbol = Symbol("same"), hidden: unique symbol = Symbol("hidden");
function blank(): Table { return {}; }
function put(table: object, key: PropertyKey, value: Value, show: boolean = true): void { Object.defineProperty(table, key, { value, writable: true, enumerable: show, configurable: true }); }
function ownKeys(table: object): PropertyKey[] { return Reflect.ownKeys(table); }
function tokens(table: object): symbol[] { return Object.getOwnPropertySymbols(table); }
function read(table: object, key: PropertyKey): unknown { return Reflect.get(table, key); }
function write(table: object, key: PropertyKey, value: Value): void { assert.sameValue(Reflect.set(table, key, value), true); }
function copy(sources: Table[]): Table { return Object.assign({}, ...sources); }
for (const initial of [-0, NaN, undefined, 7]) for (const count of [0, 1, 2]) {
  const left: Table = blank(), right: Table = blank();
  put(left, first, initial); put(left, "tail", 8); put(left, second, 13); put(left, "10", 10);
  put(right, second, 21); put(right, "2", 2); put(right, first, 34, false); put(right, hidden, 55);
  const sources: Table[] = count === 0 ? [] : count === 1 ? [left] : [left, right], result = copy(sources);
  assert.compareArray(ownKeys(result), count === 0 ? [] : count === 1 ? ["10", "tail", first, second] : ["2", "10", "tail", first, second, hidden]);
  assert.compareArray(tokens(result), count === 0 ? [] : count === 1 ? [first, second] : [first, second, hidden]);
  assert.compareArray([read(result, first), read(result, second), read(result, hidden)], count === 0 ? [undefined, undefined, undefined] : [initial, count === 1 ? 13 : 21, count === 1 ? undefined : 55]);
  if (count > 0) { assert.sameValue(read(result, "10"), 10); assert.sameValue(read(result, "tail"), 8); write(result, first, 89); assert.sameValue(read(left, first), initial); write(left, second, 144); assert.sameValue(read(left, second), 144); assert.sameValue(read(result, second), count === 1 ? 13 : 21); assert.sameValue(read(result, first), 89); }
  if (count === 2) { assert.sameValue(read(result, "2"), 2); write(right, hidden, 233); assert.sameValue(read(right, hidden), 233); assert.sameValue(read(result, hidden), 55); }
  assert.compareArray(ownKeys(left), ["10", "tail", first, second]); assert.compareArray(ownKeys(right), ["2", second, first, hidden]);
}
