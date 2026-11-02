/*---
description: A WeakMap parameter accepts local symbol keys and refuses registered symbol keys without changing its entries.
features: [ts-symbol-route-values, ts-symbols, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-strings, ts-null-undefined, ts-map-set, ts-record, ts-errors]
---*/
// A typed WeakMap parameter carries local symbols as weak keys; node retains their identities and throws TypeError for a registered symbol without losing prior values.
type Token = symbol;
function fresh(description: string | undefined): Token { return Symbol(description); }
type Value = number | undefined;
type Store = WeakMap<Token, Value>;
function make(): Store { return new WeakMap<Token, Value>(); }
function registered(key: string): Token { return Symbol.for(key); }
function put(table: Store, key: Token, value: Value): Store { return table.set(key, value); }
function read(table: Store, key: Token): Value { return table.get(key); }
function has(table: Store, key: Token): boolean { return table.has(key); }
function erase(table: Store, key: Token): boolean { return table.delete(key); }
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
