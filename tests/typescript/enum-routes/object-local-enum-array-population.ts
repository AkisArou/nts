/*---
description: "Returned local enum objects remain distinct in a typed array across duplicate and changing runtime inputs."
features: [ts-enum-routes, ts-enum-route-object-data, ts-functions, ts-arrays, ts-iteration, ts-unknown, ts-typeof-operator, ts-objects, ts-object-type, ts-readonly, ts-strings, ts-numbers, ts-type-aliases, ts-unions, ts-record, ts-interfaces, ts-enum, ts-enum-computed, ts-enum-reverse-mapping]
---*/
// A local enum factory returns its object and numeric fields into a typed array; Node initializes in order, preserves alias reverse names and keeps equal-valued instances distinct after later calls.
function same(a: unknown, b: unknown): void { assert.sameValue(Object.is(a, b), true); assert.sameValue(typeof a, typeof b); }
function exact(a: readonly unknown[], b: readonly unknown[]): void { assert.compareArray(a, b); for (let i = 0; i < a.length; i++) same(a[i], b[i]); }
function listing(value: object, keys: readonly string[], values: readonly unknown[]): void {
  exact(Object.keys(value), keys); exact(Object.values(value), values); const entries = Object.entries(value); same(entries.length, keys.length);
  for (let i = 0; i < entries.length; i++) exact(entries[i], [keys[i], values[i]]);
  const visited: string[] = []; for (const key in value) visited.push(key); exact(visited, keys);
}
type Table = Readonly<Record<string, number | string>>;
interface Built { table: Table; first: number; second: number; }
interface Row { seed: number; keys: string[]; values: unknown[]; }
const log: unknown[] = [], retained: Built[] = [];
function init(name: string, value: number): number { log.push(name, value); return value; }
function make(seed: number): Built {
  enum Local { A = init("A", seed), B = init("B", seed + 1), Alias = A }
  return { table: Local, first: Local.A, second: Local.B };
}
const rows: Row[] = [{ seed: 0, keys: ["0", "1", "A", "B", "Alias"], values: ["Alias", "B", 0, 1, 0] }, { seed: 1, keys: ["1", "2", "A", "B", "Alias"], values: ["Alias", "B", 1, 2, 1] }, { seed: 1, keys: ["1", "2", "A", "B", "Alias"], values: ["Alias", "B", 1, 2, 1] }, { seed: -2, keys: ["A", "-2", "B", "-1", "Alias"], values: [-2, "Alias", -1, "B", -2] }, { seed: 0.5, keys: ["A", "0.5", "B", "1.5", "Alias"], values: [0.5, "Alias", 1.5, "B", 0.5] }, { seed: 4294967294, keys: ["4294967294", "A", "B", "4294967295", "Alias"], values: ["Alias", 4294967294, 4294967295, "B", 4294967294] }];
for (const row of rows) {
  log.length = 0; const result: Built = make(row.seed); same(result.first, row.seed); same(result.second, row.seed + 1);
  listing(result.table, row.keys, row.values); same(result.table[row.seed], "Alias"); same(result.table[row.seed + 1], "B");
  for (const earlier of retained) same(Object.is(result.table, earlier.table), false); retained.push(result);
  exact(log, ["A", row.seed, "B", row.seed + 1]);
}
for (let i = 0; i < rows.length; i++) { listing(retained[i].table, rows[i].keys, rows[i].values); same(retained[i].first, rows[i].seed); same(retained[i].second, rows[i].seed + 1); }
