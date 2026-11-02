/*---
description: Explicit string-key record control for A Map in a declared class field keeps symbol identities through replacement and delete followed by reinsert.
features: [ts-symbol-route-values, ts-symbols, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-strings, ts-null-undefined, ts-map-set, ts-class, ts-class-fields, ts-record]
---*/
// A class field carries a symbol-keyed Map; node distinguishes equal descriptions, preserves replacement order and moves a deleted key to the end on reinsert.
type Token = string;
interface TokenData { description: string | undefined; registered: string | undefined; }
const tokenOrder: Token[] = [], tokenData: Record<string, TokenData> = {};
function fresh(description: string | undefined): Token { const id = "token:" + tokenOrder.length; tokenOrder.push(id); tokenData[id] = { description, registered: undefined }; return id; }
function tokenText(value: Token): string { const description = tokenData[value].description; return "Symbol(" + (description === undefined ? "" : description) + ")"; }
type Value = number | undefined;
interface Store { keys: Token[]; values: Record<string, Value>; }
class Holder { store: Store = { keys: [], values: {} }; }
function put(holder: Holder, key: Token, value: Value): Store { if (!holder.store.keys.includes(key)) holder.store.keys.push(key); holder.store.values[key] = value; return holder.store; }
function read(holder: Holder, key: Token): Value { return has(holder, key) ? holder.store.values[key] : undefined; }
function has(holder: Holder, key: Token): boolean { return holder.store.keys.includes(key); }
function erase(holder: Holder, key: Token): boolean { const at = holder.store.keys.indexOf(key); if (at < 0) return false; holder.store.keys.splice(at, 1); delete holder.store.values[key]; return true; }
function keysOf(holder: Holder): Token[] { return holder.store.keys.slice(); }
function valuesOf(holder: Holder): Value[] { const result: Value[] = []; for (const key of holder.store.keys) result.push(holder.store.values[key]); return result; }
function sizeOf(holder: Holder): number { return holder.store.keys.length; }
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
