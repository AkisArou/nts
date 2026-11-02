/*---
description: "Two enum declarations update one retained object and replace an earlier reverse name in place."
features: [ts-enum-routes, ts-enum-route-flags-merging, ts-functions, ts-arrays, ts-iteration, ts-unknown, ts-typeof-operator, ts-objects, ts-object-type, ts-readonly, ts-strings, ts-numbers, ts-type-aliases, ts-unions, ts-record, ts-tuples, ts-null-undefined, ts-enum, ts-enum-computed, ts-enum-reverse-mapping, ts-declaration-merging]
---*/
// A typed reference observes the enum between declarations and after merging; Node preserves object identity and old snapshots while adding ordered keys and replacing the alias reverse name.
function same(a: unknown, b: unknown): void { assert.sameValue(Object.is(a, b), true); assert.sameValue(typeof a, typeof b); }
function exact(a: readonly unknown[], b: readonly unknown[]): void { assert.compareArray(a, b); for (let i = 0; i < a.length; i++) same(a[i], b[i]); }
function listing(value: object, keys: readonly string[], values: readonly unknown[]): void {
  exact(Object.keys(value), keys); exact(Object.values(value), values); const entries = Object.entries(value); same(entries.length, keys.length);
  for (let i = 0; i < entries.length; i++) exact(entries[i], [keys[i], values[i]]);
  const visited: string[] = []; for (const key in value) visited.push(key); exact(visited, keys);
}
type Table = Readonly<Record<string, number | string>>;
const log: unknown[] = [];
function init(name: string, value: number): number { log.push(name, value); return value; }
enum Merge { Base = init("base", 1), Spare = init("spare", 4) }
const early: Table = Merge, beforeKeys = Object.keys(early), beforeValues = Object.values(early);
listing(early, ["1", "4", "Base", "Spare"], ["Base", "Spare", 1, 4]);
enum Merge { Alias = init("alias", Merge.Base), Other = init("other", 2) }
same(early, Merge); listing(early, ["1", "2", "4", "Base", "Spare", "Alias", "Other"], ["Alias", "Other", "Spare", 1, 4, 1, 2]);
exact(beforeKeys, ["1", "4", "Base", "Spare"]); exact(beforeValues, ["Base", "Spare", 1, 4]);
const rows: [number, string | undefined][] = [[Merge.Base, "Alias"], [Merge.Spare, "Spare"], [Merge.Alias, "Alias"], [Merge.Other, "Other"], [Merge.Spare + 1, undefined]];
for (const [value, expected] of rows) { const reverse = early[value]; same(reverse, expected); log.push("read", value, reverse); }
exact(log, ["base", 1, "spare", 4, "alias", 1, "other", 2, "read", 1, "Alias", "read", 4, "Spare", "read", 1, "Alias", "read", 2, "Other", "read", 5, undefined]);
