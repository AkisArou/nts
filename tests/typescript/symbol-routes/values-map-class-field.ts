/*---
description: A Map in a declared class field keeps symbol identities through replacement and delete followed by reinsert.
features: [ts-symbol-route-values, ts-symbols, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-strings, ts-null-undefined, ts-map-set, ts-class, ts-class-fields, ts-record]
---*/
// A class field carries a symbol-keyed Map; node distinguishes equal descriptions, preserves replacement order and moves a deleted key to the end on reinsert.
type Token = symbol;
function fresh(description: string | undefined): Token { return Symbol(description); }
type Value = number | undefined;
type Store = Map<Token, Value>;
class Holder { store: Store = new Map<Token, Value>(); }
function put(holder: Holder, key: Token, value: Value): Store { return holder.store.set(key, value); }
function read(holder: Holder, key: Token): Value { return holder.store.get(key); }
function has(holder: Holder, key: Token): boolean { return holder.store.has(key); }
function erase(holder: Holder, key: Token): boolean { return holder.store.delete(key); }
function keysOf(holder: Holder): Token[] { return Array.from(holder.store.keys()); }
function valuesOf(holder: Holder): Value[] { return Array.from(holder.store.values()); }
function sizeOf(holder: Holder): number { return holder.store.size; }
for (const description of [undefined, "", "same", "\ud83d\ude00"]) for (const initial of [-0, NaN, undefined, 7]) {
  const first = fresh(description), second = fresh(description), absent = fresh(description), holder = new Holder();
  assert.compareArray(keysOf(holder), []); assert.sameValue(sizeOf(holder), 0); assert.sameValue(erase(holder, absent), false);
  assert.sameValue(put(holder, first, initial), holder.store); assert.sameValue(put(holder, second, 13), holder.store); assert.sameValue(first === second, false);
  assert.sameValue(sizeOf(holder), 2); assert.compareArray(keysOf(holder), [first, second]); assert.compareArray(valuesOf(holder), [initial, 13]);
  assert.sameValue(read(holder, first), initial); assert.sameValue(read(holder, second), 13); assert.sameValue(read(holder, absent), undefined); assert.sameValue(has(holder, absent), false); assert.sameValue(has(holder, first), true);
  put(holder, first, 21); assert.compareArray(keysOf(holder), [first, second]); assert.compareArray(valuesOf(holder), [21, 13]);
  assert.sameValue(erase(holder, first), true); assert.sameValue(has(holder, first), false); assert.sameValue(read(holder, first), undefined); assert.compareArray(keysOf(holder), [second]);
  put(holder, first, initial); assert.compareArray(keysOf(holder), [second, first]); assert.compareArray(valuesOf(holder), [13, initial]); assert.sameValue(sizeOf(holder), 2);
}
