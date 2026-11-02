/*---
description: Spread through a declared class field copies own symbol fields and excludes an inherited symbol.
features: [ts-symbol-route-copying, ts-symbols, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-record, ts-unknown, ts-computed-keys, ts-spread, ts-class, ts-class-fields]
---*/
// A holder field carries class instances with own and inherited symbol keys; node copies only own enumerable fields and later writes remain separate.
type Value = number | string | undefined;
type Table = Record<PropertyKey, Value>;
const first: unique symbol = Symbol("same"), second: unique symbol = Symbol("same"), hidden: unique symbol = Symbol("hidden");
function blank(): Table { return {}; }
function put(table: object, key: PropertyKey, value: Value, show: boolean = true): void { Object.defineProperty(table, key, { value, writable: true, enumerable: show, configurable: true }); }
function ownKeys(table: object): PropertyKey[] { return Reflect.ownKeys(table); }
function tokens(table: object): symbol[] { return Object.getOwnPropertySymbols(table); }
function read(table: object, key: PropertyKey): unknown { return Reflect.get(table, key); }
function write(table: object, key: PropertyKey, value: Value): void { assert.sameValue(Reflect.set(table, key, value), true); }
class Packet { label: Value; [first]: Value; [second]: Value; constructor(value: Value) { this.label = 8; this[first] = value; this[second] = 13; } }
Object.defineProperty(Packet.prototype, hidden, { value: 99, enumerable: true, configurable: true });
class Holder { source: Packet; constructor(source: Packet) { this.source = source; } }
function copy(holder: Holder): Table { return { ...holder.source }; }
function packet(value: Value): Packet { return new Packet(value); }
for (const initial of [-0, NaN, undefined, 7]) {
  const holder: Holder = new Holder(packet(initial)), result = copy(holder);
  assert.sameValue(Object.is(result, holder.source), false); assert.compareArray(ownKeys(result), ["label", first, second]); assert.compareArray(tokens(result), [first, second]);
  assert.compareArray(ownKeys(holder.source), ["label", first, second]); assert.compareArray(tokens(holder.source), [first, second]);
  assert.compareArray([read(result, "label"), read(result, first), read(result, second), read(result, hidden)], [8, initial, 13, undefined]); assert.sameValue(read(holder.source, hidden), 99);
  write(result, first, 21); assert.sameValue(read(holder.source, first), initial); write(holder.source, second, 34); assert.sameValue(read(result, second), 13);
  assert.sameValue(read(result, first), 21); assert.sameValue(read(holder.source, second), 34);
}
