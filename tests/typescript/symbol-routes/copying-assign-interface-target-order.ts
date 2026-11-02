/*---
description: Object.assign preserves existing symbol positions on a typed target while replacing values by identity.
features: [ts-symbol-route-copying, ts-symbols, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-record, ts-unknown, ts-computed-keys, ts-spread, ts-interfaces]
---*/
// An interface target already owns one symbol; node assigns a typed source, retaining target key positions and keeping a distinct same-description key.
type Value = number | string | undefined;
type Table = Record<PropertyKey, Value>;
const first: unique symbol = Symbol("same"), second: unique symbol = Symbol("same"), hidden: unique symbol = Symbol("hidden");
function blank(): Table { return {}; }
function put(table: object, key: PropertyKey, value: Value, show: boolean = true): void { Object.defineProperty(table, key, { value, writable: true, enumerable: show, configurable: true }); }
function ownKeys(table: object): PropertyKey[] { return Reflect.ownKeys(table); }
function tokens(table: object): symbol[] { return Object.getOwnPropertySymbols(table); }
function read(table: object, key: PropertyKey): unknown { return Reflect.get(table, key); }
function write(table: object, key: PropertyKey, value: Value): void { assert.sameValue(Reflect.set(table, key, value), true); }
interface Target extends Table { start: Value; [first]: Value; }
function targetOf(): Target { return { start: 1, [first]: 3 }; }
function copy(source: Table, target: Target): Target { return Object.assign(target, source); }
for (const initial of [-0, NaN, undefined, 7]) for (const show of [false, true]) {
  const source: Table = blank(), target: Target = targetOf();
  put(source, second, 5); put(source, first, initial); put(source, "tail", 8); put(source, "2", 2); put(source, hidden, 99, show);
  const result = copy(source, target), expected = show ? [first, second, hidden] : [first, second];
  assert.sameValue(result, target); assert.compareArray(tokens(result), expected); assert.compareArray(ownKeys(result), ["2", "start", "tail", ...expected]);
  assert.compareArray(tokens(source), [second, first, hidden]); assert.compareArray(ownKeys(source), ["2", "tail", second, first, hidden]);
  assert.compareArray([read(result, "2"), read(result, "start"), read(result, "tail"), read(result, first), read(result, second), read(result, hidden)], [2, 1, 8, initial, 5, show ? 99 : undefined]);
  write(result, first, 21); assert.sameValue(read(source, first), initial); write(source, second, 34); assert.sameValue(read(result, second), 5);
  assert.sameValue(read(result, first), 21); assert.sameValue(read(source, second), 34);
}
