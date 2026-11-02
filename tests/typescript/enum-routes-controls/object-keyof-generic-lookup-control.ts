/*---
description: "Explicit object control: A generic keyof typeof lookup retains enum member values through a typed object field."
features: [ts-enum-routes, ts-enum-route-object-data, ts-functions, ts-arrays, ts-iteration, ts-unknown, ts-typeof-operator, ts-objects, ts-object-type, ts-readonly, ts-strings, ts-numbers, ts-type-aliases, ts-keyof, ts-typeof-type, ts-indexed-access, ts-interfaces, ts-generics, ts-generic-constraints, ts-tuples, ts-record, ts-computed-keys]
---*/
// keyof typeof names enter an indexed-access generic return through an enum-object field; Node returns each numeric value and its alias-selected reverse name, with the full object intact. Control: Replace the enum with frozen forward/reverse/plain objects; keyof the forward object supplies the same declared-name literal union while the stored full object and indexed-access generic computation remain.
function same(a: unknown, b: unknown): void { assert.sameValue(Object.is(a, b), true); assert.sameValue(typeof a, typeof b); }
function exact(a: readonly unknown[], b: readonly unknown[]): void { assert.compareArray(a, b); for (let i = 0; i < a.length; i++) same(a[i], b[i]); }
function listing(value: object, keys: readonly string[], values: readonly unknown[]): void {
  exact(Object.keys(value), keys); exact(Object.values(value), values); const entries = Object.entries(value); same(entries.length, keys.length);
  for (let i = 0; i < entries.length; i++) exact(entries[i], [keys[i], values[i]]);
  const visited: string[] = []; for (const key in value) visited.push(key); exact(visited, keys);
}
const CatalogForward = Object.freeze({ "two words": 4, "Plain": 2, "Alias": 4, "Negative": -1 });
const CatalogReverse: Readonly<Record<number, string>> = Object.freeze({"4": "Alias", "2": "Plain", "-1": "Negative"});
const Catalog = Object.freeze({ "two words": CatalogForward["two words"], [CatalogForward["two words"]]: CatalogReverse[CatalogForward["two words"]], "Plain": CatalogForward["Plain"], [CatalogForward["Plain"]]: CatalogReverse[CatalogForward["Plain"]], "Alias": CatalogForward["Alias"], "Negative": CatalogForward["Negative"], [CatalogForward["Negative"]]: CatalogReverse[CatalogForward["Negative"]] });
type Name = keyof typeof CatalogForward;
interface Holder { table: typeof Catalog; }
const log: unknown[] = [];
function lookup<K extends Name>(source: typeof Catalog, name: K): (typeof Catalog)[K] { const value = source[name]; log.push("read", name, value); return value; }
const holder: Holder = { table: Catalog };
const rows: [Name, number, string][] = [["two words", 4, "Alias"], ["Plain", 2, "Plain"], ["Alias", 4, "Alias"], ["Negative", -1, "Negative"]];
for (const [name, value, reverse] of rows) {
  log.length = 0; const result = lookup(holder.table, name); same(result, value); same(holder.table[result], reverse); same(holder.table, Catalog);
  listing(holder.table, ["2", "4", "two words", "Plain", "Alias", "Negative", "-1"], ["Plain", "Alias", 4, 2, 4, -1, "Negative"]); exact(log, ["read", name, value]);
}
