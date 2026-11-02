/*---
description: "A readonly Map lookup returns the original selected enum object or a truthful missing value."
features: [ts-enum-routes, ts-enum-route-object-data, ts-functions, ts-arrays, ts-iteration, ts-unknown, ts-typeof-operator, ts-objects, ts-object-type, ts-readonly, ts-strings, ts-numbers, ts-type-aliases, ts-unions, ts-record, ts-interfaces, ts-map-set, ts-null-undefined, ts-narrowing, ts-enum, ts-enum-reverse-mapping]
---*/
// Map values are whole enum objects: a typed lookup returns each original table or undefined, and Node preserves complete listings and reverse names after repeated selection.
function same(a: unknown, b: unknown): void { assert.sameValue(Object.is(a, b), true); assert.sameValue(typeof a, typeof b); }
function exact(a: readonly unknown[], b: readonly unknown[]): void { assert.compareArray(a, b); for (let i = 0; i < a.length; i++) same(a[i], b[i]); }
function listing(value: object, keys: readonly string[], values: readonly unknown[]): void {
  exact(Object.keys(value), keys); exact(Object.values(value), values); const entries = Object.entries(value); same(entries.length, keys.length);
  for (let i = 0; i < entries.length; i++) exact(entries[i], [keys[i], values[i]]);
  const visited: string[] = []; for (const key in value) visited.push(key); exact(visited, keys);
}
type Table = Readonly<Record<string, number | string>>;
enum Positive { "A" = 1, "B" = 2 }
enum Negative { "A" = -1, "B" = -2 }
interface Row { key: string; expected: Table | undefined; keys: string[]; values: unknown[]; }
const tables: Map<string, Table> = new Map<string, Table>([["positive", Positive], ["negative", Negative]]), log: unknown[] = [];
function select(source: ReadonlyMap<string, Table>, key: string): Table | undefined { const table = source.get(key); log.push("get", key, table); return table; }
const rows: Row[] = [{ key: "positive", expected: Positive, keys: ["1", "2", "A", "B"], values: ["A", "B", 1, 2] }, { key: "negative", expected: Negative, keys: ["A", "-1", "B", "-2"], values: [-1, "A", -2, "B"] }, { key: "missing", expected: undefined, keys: [], values: [] }, { key: "positive", expected: Positive, keys: ["1", "2", "A", "B"], values: ["A", "B", 1, 2] }];
for (const row of rows) {
  log.length = 0; const result = select(tables, row.key); same(result, row.expected);
  if (result === undefined) { log.push("missing"); same(row.expected, undefined); }
  else { log.push("present"); listing(result, row.keys, row.values); same(result[result.A], "A"); same(result[result.B], "B"); }
  exact(log, ["get", row.key, row.expected, row.expected === undefined ? "missing" : "present"]);
}
same(tables.size, 2); same(tables.get("positive"), Positive); same(tables.get("negative"), Negative);
