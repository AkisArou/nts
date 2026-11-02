/*---
description: Generic spread copies enumerable symbol identities and omits hidden symbols without linking later writes.
features: [ts-symbol-route-copying, ts-symbols, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-record, ts-unknown, ts-computed-keys, ts-spread, ts-generics]
---*/
// A generic typed record carries two same-description symbol keys and a hidden symbol; node copies only enumerable own keys into independent storage.
type Value = number | string | undefined;
type Table = Record<PropertyKey, Value>;
const first: unique symbol = Symbol("same"), second: unique symbol = Symbol("same"), hidden: unique symbol = Symbol("hidden");
function blank(): Table { return {}; }
function put(table: object, key: PropertyKey, value: Value, show: boolean = true): void { Object.defineProperty(table, key, { value, writable: true, enumerable: show, configurable: true }); }
function ownKeys(table: object): PropertyKey[] { return Reflect.ownKeys(table); }
function tokens(table: object): symbol[] { return Object.getOwnPropertySymbols(table); }
function read(table: object, key: PropertyKey): unknown { return Reflect.get(table, key); }
function write(table: object, key: PropertyKey, value: Value): void { assert.sameValue(Reflect.set(table, key, value), true); }
function copy<T extends Table>(source: T): Table { return { ...source }; }
for (const initial of [-0, NaN, undefined, 7]) for (const mode of ["empty", "visible", "hidden"]) {
  const source: Table = blank();
  if (mode !== "empty") { put(source, second, initial); put(source, "tail", 8); put(source, first, 13); put(source, "10", 10); put(source, "2", 2); put(source, hidden, 99, mode === "visible"); }
  const copyValue = copy(source), expected = mode === "empty" ? [] : mode === "visible" ? [second, first, hidden] : [second, first];
  assert.sameValue(copyValue === source, false); assert.compareArray(tokens(copyValue), expected);
  assert.compareArray(ownKeys(copyValue), mode === "empty" ? [] : ["2", "10", "tail", ...expected]);
  assert.compareArray(tokens(source), mode === "empty" ? [] : [second, first, hidden]);
  assert.compareArray(ownKeys(source), mode === "empty" ? [] : ["2", "10", "tail", second, first, hidden]);
  assert.sameValue(read(copyValue, second), mode === "empty" ? undefined : initial); assert.sameValue(read(copyValue, first), mode === "empty" ? undefined : 13);
  assert.sameValue(read(copyValue, hidden), mode === "visible" ? 99 : undefined);
  if (mode !== "empty") { assert.compareArray([read(copyValue, "2"), read(copyValue, "10"), read(copyValue, "tail")], [2, 10, 8]); write(copyValue, second, 21); assert.sameValue(read(source, second), initial); write(source, first, 34); assert.sameValue(read(copyValue, first), 13); assert.sameValue(read(copyValue, second), 21); assert.sameValue(read(source, first), 34); }
}
