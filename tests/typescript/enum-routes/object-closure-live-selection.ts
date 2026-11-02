/*---
description: "Typed readers distinguish a live enum-object binding from the originally captured object."
features: [ts-enum-routes, ts-enum-route-object-data, ts-functions, ts-arrays, ts-iteration, ts-unknown, ts-typeof-operator, ts-objects, ts-object-type, ts-readonly, ts-strings, ts-numbers, ts-type-aliases, ts-unions, ts-record, ts-interfaces, ts-tuples, ts-closures, ts-enum, ts-enum-reverse-mapping]
---*/
// A reader interface closes over current and initial enum-object references; Node follows replacements for read, retains the original for original, and preserves both complete object shapes.
function same(a: unknown, b: unknown): void { assert.sameValue(Object.is(a, b), true); assert.sameValue(typeof a, typeof b); }
function exact(a: readonly unknown[], b: readonly unknown[]): void { assert.compareArray(a, b); for (let i = 0; i < a.length; i++) same(a[i], b[i]); }
function listing(value: object, keys: readonly string[], values: readonly unknown[]): void {
  exact(Object.keys(value), keys); exact(Object.values(value), values); const entries = Object.entries(value); same(entries.length, keys.length);
  for (let i = 0; i < entries.length; i++) exact(entries[i], [keys[i], values[i]]);
  const visited: string[] = []; for (const key in value) visited.push(key); exact(visited, keys);
}
type Table = Readonly<Record<string, number | string>>;
enum Initial { "One" = 1, "Alias" = 1 }
enum Later { "Minus" = -1, "Half" = 0.5 }
interface Readers { set(next: Table): void; read(): Table; original(): Table; }
const log: unknown[] = [];
function readers(initial: Table): Readers {
  let current: Table = initial;
  return { set(next: Table): void { log.push("set", next); current = next; }, read(): Table { log.push("read", current); return current; }, original(): Table { log.push("original", initial); return initial; } };
}
const access: Readers = readers(Initial);
const rows: [Table, string[], unknown[]][] = [[Initial, ["1", "One", "Alias"], ["Alias", 1, 1]], [Later, ["Minus", "-1", "Half", "0.5"], [-1, "Minus", 0.5, "Half"]], [Initial, ["1", "One", "Alias"], ["Alias", 1, 1]], [Later, ["Minus", "-1", "Half", "0.5"], [-1, "Minus", 0.5, "Half"]]];
for (const [next, keys, values] of rows) {
  log.length = 0; access.set(next); const current = access.read(), original = access.original(); same(current, next); same(original, Initial);
  listing(current, keys, values); listing(original, ["1", "One", "Alias"], ["Alias", 1, 1]);
  same(original[1], "Alias"); exact(log, ["set", next, "read", next, "original", Initial]);
}
