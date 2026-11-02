/*---
description: "Explicit object control: Local enum merges retain each two-phase object and its early shape across a typed population."
features: [ts-enum-routes, ts-enum-route-flags-merging, ts-functions, ts-arrays, ts-iteration, ts-unknown, ts-typeof-operator, ts-objects, ts-object-type, ts-readonly, ts-strings, ts-numbers, ts-type-aliases, ts-unions, ts-record, ts-interfaces, ts-closures]
---*/
// A local two-declaration enum returns its retained object and pre-merge snapshots; Node performs each initializer once, applies alias overwrites and keeps every populated object independent. Control: Allocate one forward table, reverse table and plain object per factory invocation, explicitly perform the same two construction phases, then freeze and retain them. Keep actual snapshots and initializer calls.
function same(a: unknown, b: unknown): void { assert.sameValue(Object.is(a, b), true); assert.sameValue(typeof a, typeof b); }
function exact(a: readonly unknown[], b: readonly unknown[]): void { assert.compareArray(a, b); for (let i = 0; i < a.length; i++) same(a[i], b[i]); }
function listing(value: object, keys: readonly string[], values: readonly unknown[]): void {
  exact(Object.keys(value), keys); exact(Object.values(value), values); const entries = Object.entries(value); same(entries.length, keys.length);
  for (let i = 0; i < entries.length; i++) exact(entries[i], [keys[i], values[i]]);
  const visited: string[] = []; for (const key in value) visited.push(key); exact(visited, keys);
}
type Table = Readonly<Record<string, number | string>>;
interface Built { table: Table; beforeKeys: string[]; beforeValues: unknown[]; }
interface Row { seed: number; added: number; beforeKeys: string[]; beforeValues: unknown[]; keys: string[]; values: unknown[]; }
const log: unknown[] = [], retained: Built[] = [];
function init(name: string, value: number): number { log.push(name, value); return value; }
function make(seed: number): Built {
  const forward: Record<string, number> = {}, reverse: Record<number, string> = {}, Local: Record<string, number | string> = {};
  function add(name: string, value: number): void { forward[name] = value; reverse[value] = name; Local[name] = value; Local[value] = name; }
  add("Start", init("first", seed));
  const early: Table = Local, beforeKeys = Object.keys(early), beforeValues = Object.values(early);
  add("Added", init("second", forward.Start | 2)); add("Alias", init("alias", forward.Start)); Object.freeze(forward); Object.freeze(reverse); Object.freeze(Local);
  same(early, Local); return { table: early, beforeKeys, beforeValues };
}
const rows: Row[] = [{ seed: 0, added: 2, beforeKeys: ["0", "Start"], beforeValues: ["Start", 0], keys: ["0", "2", "Start", "Added", "Alias"], values: ["Alias", "Added", 0, 2, 0] }, { seed: 1, added: 3, beforeKeys: ["1", "Start"], beforeValues: ["Start", 1], keys: ["1", "3", "Start", "Added", "Alias"], values: ["Alias", "Added", 1, 3, 1] }, { seed: 2, added: 2, beforeKeys: ["2", "Start"], beforeValues: ["Start", 2], keys: ["2", "Start", "Added", "Alias"], values: ["Alias", 2, 2, 2] }, { seed: 4, added: 6, beforeKeys: ["4", "Start"], beforeValues: ["Start", 4], keys: ["4", "6", "Start", "Added", "Alias"], values: ["Alias", "Added", 4, 6, 4] }, { seed: -1, added: -1, beforeKeys: ["Start", "-1"], beforeValues: [-1, "Start"], keys: ["Start", "-1", "Added", "Alias"], values: [-1, "Alias", -1, -1] }, { seed: 2147483648, added: -2147483646, beforeKeys: ["2147483648", "Start"], beforeValues: ["Start", 2147483648], keys: ["2147483648", "Start", "Added", "-2147483646", "Alias"], values: ["Alias", 2147483648, -2147483646, "Added", 2147483648] }];
for (const row of rows) {
  log.length = 0; const result = make(row.seed); exact(result.beforeKeys, row.beforeKeys); exact(result.beforeValues, row.beforeValues); listing(result.table, row.keys, row.values);
  same(result.table.Start, row.seed); same(result.table.Added, row.added); same(result.table.Alias, row.seed); same(result.table[row.seed], "Alias");
  for (const previous of retained) same(Object.is(previous.table, result.table), false); retained.push(result); exact(log, ["first", row.seed, "second", row.added, "alias", row.seed]);
}
for (let i = 0; i < retained.length; i++) { listing(retained[i].table, rows[i].keys, rows[i].values); exact(retained[i].beforeKeys, rows[i].beforeKeys); exact(retained[i].beforeValues, rows[i].beforeValues); }
