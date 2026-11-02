/*---
description: "A typed result returns one of two heterogeneous enum objects with its complete runtime shape."
features: [ts-enum-routes, ts-enum-route-object-data, ts-functions, ts-arrays, ts-iteration, ts-unknown, ts-typeof-operator, ts-objects, ts-object-type, ts-readonly, ts-strings, ts-numbers, ts-type-aliases, ts-unions, ts-record, ts-interfaces, ts-tuples, ts-null-undefined, ts-enum, ts-enum-string, ts-enum-reverse-mapping]
---*/
// Typed result record: a branch returns the original heterogeneous enum object; Node keeps numeric reverse entries and string-only forward entries in their exact positions.
function same(a: unknown, b: unknown): void { assert.sameValue(Object.is(a, b), true); assert.sameValue(typeof a, typeof b); }
function exact(a: readonly unknown[], b: readonly unknown[]): void { assert.compareArray(a, b); for (let i = 0; i < a.length; i++) same(a[i], b[i]); }
function listing(value: object, keys: readonly string[], values: readonly unknown[]): void {
  exact(Object.keys(value), keys); exact(Object.values(value), values); const entries = Object.entries(value); same(entries.length, keys.length);
  for (let i = 0; i < entries.length; i++) exact(entries[i], [keys[i], values[i]]);
  const visited: string[] = []; for (const key in value) visited.push(key); exact(visited, keys);
}
type Table = Readonly<Record<string, number | string>>;
enum MixedA { "Zero" = 0, "Text" = "", "Alias" = 0, "Step" = 2.5, "Word" = "word" }
enum MixedB { "Zero" = 1, "Text" = "text", "Alias" = 1, "Step" = -2.5, "Word" = "" }
interface Result { table: Table; selected: boolean; }
const log: unknown[] = [];
function choose(second: boolean): Result { const table = second ? MixedB : MixedA; log.push(second ? "second" : "first", table); return { table, selected: second }; }
const rows: [boolean, Table, string[], unknown[]][] = [[false, MixedA, ["0", "Zero", "Text", "Alias", "Step", "2.5", "Word"], ["Alias", 0, "", 0, 2.5, "Step", "word"]], [true, MixedB, ["1", "Zero", "Text", "Alias", "Step", "-2.5", "Word"], ["Alias", 1, "text", 1, -2.5, "Step", ""]], [false, MixedA, ["0", "Zero", "Text", "Alias", "Step", "2.5", "Word"], ["Alias", 0, "", 0, 2.5, "Step", "word"]]];
for (const [choice, expected, keys, values] of rows) {
  log.length = 0; const result: Result = choose(choice); same(result.selected, choice); same(result.table, expected); listing(result.table, keys, values);
  same(result.table[result.table.Zero], "Alias"); same(result.table[result.table.Step], "Step");
  same(result.table[result.table.Text], undefined); same(result.table[result.table.Word], undefined);
  exact(log, [choice ? "second" : "first", expected]);
}
