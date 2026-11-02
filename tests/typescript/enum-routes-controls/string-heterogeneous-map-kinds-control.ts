/*---
description: "Control for string-heterogeneous-map-kinds; A heterogeneous enum keeps numeric and textual Map keys distinct while a numeric alias overwrites only its numeric entry."
features: [ts-enum-routes, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-strings, ts-numbers, ts-unknown, ts-typeof-operator, ts-readonly, ts-enum-route-string-heterogeneous, ts-map-set, ts-spread, ts-type-aliases, ts-unions, ts-null-undefined, ts-literal-types]
---*/
// Every TableKey crosses the same Map writer; node retains separate 0 and "0" entries and the alias replaces only the first numeric value. The control uses frozen forward values and literal types, plus explicit reverse entries where observed.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: readonly unknown[], expected: readonly unknown[]): void { assert.compareArray(actual, expected); for (let i = 0; i < actual.length; i++) same(actual[i], expected[i]); }
const TableKey = Object.freeze({ Zero: 0, TextZero: "0", Two: 2, TextTwo: "2", Empty: "", Again: 0 }); type TableKey = 0 | "0" | 2 | "2" | "";
type EnumPayload = number | string | null | undefined | { id: number };
const marker = { id: 7 }, other = { id: 7 }, inputs: EnumPayload[] = [-0, NaN, "", undefined, null, marker, other];
const members: TableKey[] = [TableKey.Zero, TableKey.TextZero, TableKey.Two, TableKey.TextTwo, TableKey.Empty, TableKey.Again], keys: (number | string)[] = [0, "0", 2, "2", "", 0];
function write(table: Map<TableKey, EnumPayload>, key: TableKey, value: EnumPayload, log: unknown[]): EnumPayload | undefined { same(table.set(key, value), table); const result = table.get(key); log.push("write", key, typeof key, result); return result; }
for (const input of inputs) {
  const table = new Map<TableKey, EnumPayload>(), writes: EnumPayload[] = [other, marker, null, undefined, other, input], log: unknown[] = [], expectedLog: unknown[] = [];
  for (let at = 0; at < members.length; at++) { same(members[at], keys[at]); same(write(table, members[at], writes[at], log), writes[at]); expectedLog.push("write", keys[at], typeof keys[at], writes[at]); }
  same(table.size, 5); exact([...table.keys()], [0, "0", 2, "2", ""]); exact([...table.values()], [input, marker, null, undefined, other]);
  exact([...table.entries()].flat(), [0, input, "0", marker, 2, null, "2", undefined, "", other]);
  same(table.get(TableKey.Zero), input); same(table.get(TableKey.TextZero), marker); same(table.has(TableKey.TextTwo), true); same(table.get(TableKey.TextTwo), undefined); exact(log, expectedLog);
}
