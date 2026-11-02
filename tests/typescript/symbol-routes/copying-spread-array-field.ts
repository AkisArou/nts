/*---
description: Spread from a declared array field copies indices and enumerable symbol keys but skips length and hidden symbols.
features: [ts-symbol-route-copying, ts-symbols, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-record, ts-unknown, ts-computed-keys, ts-spread, ts-interfaces]
---*/
// A typed array field carries sparse arrays and symbol properties; node copies present indices and enumerable symbols to a plain independent result.
type Value = number | string | undefined;
type Table = Record<PropertyKey, Value>;
const first: unique symbol = Symbol("same"), second: unique symbol = Symbol("same"), hidden: unique symbol = Symbol("hidden");
function blank(): Table { return {}; }
function put(table: object, key: PropertyKey, value: Value, show: boolean = true): void { Object.defineProperty(table, key, { value, writable: true, enumerable: show, configurable: true }); }
function ownKeys(table: object): PropertyKey[] { return Reflect.ownKeys(table); }
function tokens(table: object): symbol[] { return Object.getOwnPropertySymbols(table); }
function read(table: object, key: PropertyKey): unknown { return Reflect.get(table, key); }
function write(table: object, key: PropertyKey, value: Value): void { assert.sameValue(Reflect.set(table, key, value), true); }
interface Tagged extends Array<number> { [first]?: Value; [second]?: Value; }
interface Holder { items: Tagged; }
function items(size: number, value: Value): Tagged { const result: Tagged = []; result.length = size; if (size > 0) result[size - 1] = 8; put(result, first, value); put(result, second, 13, false); return result; }
function copy(holder: Holder): object { return { ...holder.items }; }
for (const initial of [-0, NaN, undefined, 7]) for (const size of [0, 1, 3]) {
  const holder: Holder = { items: items(size, initial) }, result = copy(holder), names = size === 0 ? [] : [String(size - 1)];
  assert.sameValue(result === holder.items, false); assert.compareArray(ownKeys(result), [...names, first]); assert.compareArray(tokens(result), [first]);
  assert.compareArray(ownKeys(holder.items), [...names, "length", first, second]); assert.compareArray(tokens(holder.items), [first, second]);
  assert.sameValue(read(result, "length"), undefined); assert.sameValue(read(holder.items, "length"), size); assert.sameValue(read(result, first), initial); assert.sameValue(read(result, second), undefined);
  if (size > 0) assert.sameValue(read(result, String(size - 1)), 8); if (size > 1) assert.sameValue(read(result, "0"), undefined);
  write(result, first, 21); assert.sameValue(read(holder.items, first), initial); write(holder.items, first, 34); assert.sameValue(read(result, first), 21); assert.sameValue(read(holder.items, first), 34);
}
