/*---
description: "A generic keyof typeof lookup retains enum member values through a typed object field."
features: [ts-enum-routes, ts-enum-route-object-data, ts-functions, ts-arrays, ts-iteration, ts-unknown, ts-typeof-operator, ts-objects, ts-object-type, ts-readonly, ts-strings, ts-numbers, ts-type-aliases, ts-keyof, ts-typeof-type, ts-indexed-access, ts-interfaces, ts-generics, ts-generic-constraints, ts-tuples, ts-enum, ts-enum-reverse-mapping]
---*/
// keyof typeof names enter an indexed-access generic return through an enum-object field; Node returns each numeric value and its alias-selected reverse name, with the full object intact.
function same(a: unknown, b: unknown): void { assert.sameValue(Object.is(a, b), true); assert.sameValue(typeof a, typeof b); }
function exact(a: readonly unknown[], b: readonly unknown[]): void { assert.compareArray(a, b); for (let i = 0; i < a.length; i++) same(a[i], b[i]); }
function listing(value: object, keys: readonly string[], values: readonly unknown[]): void {
  exact(Object.keys(value), keys); exact(Object.values(value), values); const entries = Object.entries(value); same(entries.length, keys.length);
  for (let i = 0; i < entries.length; i++) exact(entries[i], [keys[i], values[i]]);
  const visited: string[] = []; for (const key in value) visited.push(key); exact(visited, keys);
}
enum Catalog { "two words" = 4, "Plain" = 2, "Alias" = 4, "Negative" = -1 }
type Name = keyof typeof Catalog;
interface Holder { table: typeof Catalog; }
const log: unknown[] = [];
function lookup<K extends Name>(source: typeof Catalog, name: K): (typeof Catalog)[K] { const value = source[name]; log.push("read", name, value); return value; }
const holder: Holder = { table: Catalog };
const rows: [Name, number, string][] = [["two words", 4, "Alias"], ["Plain", 2, "Plain"], ["Alias", 4, "Alias"], ["Negative", -1, "Negative"]];
for (const [name, value, reverse] of rows) {
  log.length = 0; const result = lookup(holder.table, name); same(result, value); same(holder.table[result], reverse); same(holder.table, Catalog);
  listing(holder.table, ["2", "4", "two words", "Plain", "Alias", "Negative", "-1"], ["Plain", "Alias", 4, 2, 4, -1, "Negative"]); exact(log, ["read", name, value]);
}
