/*---
description: "Explicit object control: A typed object field stores string enum objects and an empty enum without inventing reverse entries."
features: [ts-enum-routes, ts-enum-route-object-data, ts-functions, ts-arrays, ts-iteration, ts-unknown, ts-typeof-operator, ts-objects, ts-object-type, ts-readonly, ts-strings, ts-numbers, ts-type-aliases, ts-unions, ts-record, ts-interfaces, ts-null-undefined]
---*/
// Mutable table field: Node retains each selected enum object and its declaration-order string members, including aliases and an empty shape; value-named reverse reads stay undefined. Control: Store independently frozen plain forward objects with empty reverse sidecars in the same typed field; preserve the explicit enum-shaped objects and retained references.
function same(a: unknown, b: unknown): void { assert.sameValue(Object.is(a, b), true); assert.sameValue(typeof a, typeof b); }
function exact(a: readonly unknown[], b: readonly unknown[]): void { assert.compareArray(a, b); for (let i = 0; i < a.length; i++) same(a[i], b[i]); }
function listing(value: object, keys: readonly string[], values: readonly unknown[]): void {
  exact(Object.keys(value), keys); exact(Object.values(value), values); const entries = Object.entries(value); same(entries.length, keys.length);
  for (let i = 0; i < entries.length; i++) exact(entries[i], [keys[i], values[i]]);
  const visited: string[] = []; for (const key in value) visited.push(key); exact(visited, keys);
}
type Table = Readonly<Record<string, number | string>>;
const NorthForward = Object.freeze({ "Empty": "", "Word": "north", "Alias": "north", "Code": "2" });
const NorthReverse: Readonly<Record<number, string>> = Object.freeze({});
const North = Object.freeze({ "Empty": NorthForward["Empty"], "Word": NorthForward["Word"], "Alias": NorthForward["Alias"], "Code": NorthForward["Code"] });
const SouthForward = Object.freeze({ "Empty": "", "Word": "south", "Alias": "south", "Code": "02" });
const SouthReverse: Readonly<Record<number, string>> = Object.freeze({});
const South = Object.freeze({ "Empty": SouthForward["Empty"], "Word": SouthForward["Word"], "Alias": SouthForward["Alias"], "Code": SouthForward["Code"] });
const VacantForward = Object.freeze({  });
const VacantReverse: Readonly<Record<number, string>> = Object.freeze({});
const Vacant = Object.freeze({  });
interface Holder { table: Table; }
interface Row { table: Table; keys: string[]; values: string[]; }
const rows: Row[] = [{ table: North, keys: ["Empty", "Word", "Alias", "Code"], values: ["", "north", "north", "2"] }, { table: South, keys: ["Empty", "Word", "Alias", "Code"], values: ["", "south", "south", "02"] }, { table: Vacant, keys: [], values: [] }];
const holder: Holder = { table: Vacant }, retained: Table[] = [], log: unknown[] = [];
function observe(target: Holder, row: Row): void {
  const table = target.table; same(table, row.table); retained.push(table); log.push("table", table);
  listing(table, row.keys, row.values);
  for (const value of row.values) { const reverse = table[value]; same(reverse, undefined); log.push("reverse", value, reverse); }
}
for (const row of rows) {
  log.length = 0; holder.table = row.table; observe(holder, row);
  const expected: unknown[] = ["table", row.table]; for (const value of row.values) expected.push("reverse", value, undefined); exact(log, expected);
}
for (let i = 0; i < rows.length; i++) { same(retained[i], rows[i].table); listing(retained[i], rows[i].keys, rows[i].values); }
