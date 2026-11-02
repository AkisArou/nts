/*---
description: "A namespace function captured before a later enum declaration reads the final live reverse mapping."
features: [ts-enum-routes, ts-enum-route-flags-merging, ts-functions, ts-arrays, ts-iteration, ts-unknown, ts-typeof-operator, ts-objects, ts-object-type, ts-readonly, ts-strings, ts-numbers, ts-unions, ts-tuples, ts-null-undefined, ts-function-types, ts-typeof-type, ts-enum, ts-enum-computed, ts-enum-reverse-mapping, ts-namespace, ts-declaration-merging]
---*/
// A namespace is inserted between enum declarations; Node preserves the object and function identities while a captured typed function starts returning the later alias-selected reverse name.
function same(a: unknown, b: unknown): void { assert.sameValue(Object.is(a, b), true); assert.sameValue(typeof a, typeof b); }
function exact(a: readonly unknown[], b: readonly unknown[]): void { assert.compareArray(a, b); for (let i = 0; i < a.length; i++) same(a[i], b[i]); }
function listing(value: object, keys: readonly string[], values: readonly unknown[]): void {
  exact(Object.keys(value), keys); exact(Object.values(value), values); const entries = Object.entries(value); same(entries.length, keys.length);
  for (let i = 0; i < entries.length; i++) exact(entries[i], [keys[i], values[i]]);
  const visited: string[] = []; for (const key in value) visited.push(key); exact(visited, keys);
}
const log: unknown[] = [];
function init(name: string, value: number): number { log.push(name, value); return value; }
enum Merge { First = init("first", 1) }
namespace Merge { export function name(value: number): string | undefined { const result = Merge[value]; log.push("name", value, result); return result; } }
const view: typeof Merge = Merge;
const saved: object = Merge, lookup: (value: number) => string | undefined = view.name;
listing(saved, ["1", "First", "name"], ["First", 1, lookup]); same(lookup(1), "First");
enum Merge { Alias = init("alias", 1), Second = init("second", 2) }
same(saved, Merge); same(view.name, lookup); listing(saved, ["1", "2", "First", "name", "Alias", "Second"], ["Alias", "Second", 1, lookup, 1, 2]);
const rows: [number, string | undefined][] = [[1, "Alias"], [1, "Alias"], [2, "Second"], [3, undefined]];
for (const [value, expected] of rows) { same(lookup(value), expected); same(view.name(value), expected); }
exact(log, ["first", 1, "name", 1, "First", "alias", 1, "second", 2, "name", 1, "Alias", "name", 1, "Alias", "name", 1, "Alias", "name", 1, "Alias", "name", 2, "Second", "name", 2, "Second", "name", 3, undefined, "name", 3, undefined]);
