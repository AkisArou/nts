/*---
description: Explicit string-key record control for A WeakMap parameter accepts local symbol keys and refuses registered symbol keys without changing its entries.
features: [ts-symbol-route-values, ts-symbols, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-strings, ts-null-undefined, ts-map-set, ts-record, ts-errors]
---*/
// A typed WeakMap parameter carries local symbols as weak keys; node retains their identities and throws TypeError for a registered symbol without losing prior values.
type Token = string;
interface TokenData { description: string | undefined; registered: string | undefined; }
const tokenOrder: Token[] = [], tokenData: Record<string, TokenData> = {};
function fresh(description: string | undefined): Token { const id = "token:" + tokenOrder.length; tokenOrder.push(id); tokenData[id] = { description, registered: undefined }; return id; }
function tokenText(value: Token): string { const description = tokenData[value].description; return "Symbol(" + (description === undefined ? "" : description) + ")"; }
type Value = number | undefined;
interface Store { keys: Token[]; values: Record<string, Value>; }
function make(): Store { return { keys: [], values: {} }; }
const registry: Record<string, Token> = {};
function registered(key: string): Token { const slot = "registry:" + key; if (registry[slot] === undefined) { const value = fresh(key); tokenData[value].registered = key; registry[slot] = value; } return registry[slot]; }
function put(table: Store, key: Token, value: Value): Store { if (tokenData[key].registered !== undefined) throw new TypeError("registered key"); if (!table.keys.includes(key)) table.keys.push(key); table.values[key] = value; return table; }
function read(table: Store, key: Token): Value { return has(table, key) ? table.values[key] : undefined; }
function has(table: Store, key: Token): boolean { return table.keys.includes(key); }
function erase(table: Store, key: Token): boolean { const at = table.keys.indexOf(key); if (at < 0) return false; table.keys.splice(at, 1); delete table.values[key]; return true; }
for (const description of ["", "same", "__proto__", "\ud83d\ude00"]) for (const initial of [-0, NaN, undefined, 7]) {
  const first = fresh(description), second = fresh(description), absent = fresh(description), global = registered(description), table: Store = make();
  assert.sameValue(first === second, false); assert.sameValue(first === global, false); assert.sameValue(has(table, first), false);
  assert.sameValue(put(table, first, initial), table); assert.sameValue(put(table, second, 13), table);
  assert.sameValue(read(table, first), initial); assert.sameValue(read(table, second), 13); assert.sameValue(has(table, first), true); assert.sameValue(has(table, second), true);
  assert.sameValue(read(table, absent), undefined); assert.sameValue(has(table, absent), false); assert.sameValue(erase(table, absent), false);
  assert.throws(TypeError, () => put(table, global, 21));
  assert.sameValue(read(table, first), initial); assert.sameValue(read(table, second), 13); assert.sameValue(read(table, global), undefined); assert.sameValue(has(table, global), false); assert.sameValue(erase(table, global), false);
  assert.sameValue(erase(table, first), true); assert.sameValue(has(table, first), false); assert.sameValue(read(table, first), undefined); assert.sameValue(read(table, second), 13);
  put(table, first, initial); assert.sameValue(read(table, first), initial); assert.sameValue(has(table, first), true);
}
