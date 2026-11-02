/*---
description: "Control for string-heterogeneous-record-coercion; Numeric and textual heterogeneous enum keys select the same Record properties without changing key positions."
features: [ts-enum-routes, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-strings, ts-numbers, ts-unknown, ts-typeof-operator, ts-readonly, ts-enum-route-string-heterogeneous, ts-record, ts-computed-keys, ts-type-aliases, ts-unions, ts-null-undefined, ts-literal-types]
---*/
// Every TableKey reaches one Record writer; node coerces numeric and textual keys to the same property while keeping their logged input kinds distinct. The control uses frozen forward values and literal types, plus explicit reverse entries where observed.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: readonly unknown[], expected: readonly unknown[]): void { assert.compareArray(actual, expected); for (let i = 0; i < actual.length; i++) same(actual[i], expected[i]); }
const TableKey = Object.freeze({ Zero: 0, TextZero: "0", Two: 2, TextTwo: "2", Empty: "", Again: 0 }); type TableKey = 0 | "0" | 2 | "2" | "";
type EnumPayload = number | string | null | undefined | { id: number };
const marker = { id: 7 }, other = { id: 7 }, inputs: EnumPayload[] = [-0, NaN, "", undefined, null, marker, other];
const members: TableKey[] = [TableKey.Zero, TableKey.TextZero, TableKey.Two, TableKey.TextTwo, TableKey.Empty, TableKey.Again], keys: (number | string)[] = [0, "0", 2, "2", "", 0];
function write(table: Record<TableKey, EnumPayload>, key: TableKey, value: EnumPayload, log: unknown[]): EnumPayload { table[key] = value; log.push("write", key, typeof key, table[key]); return table[key]; }
for (const input of inputs) {
  const table: Record<TableKey, EnumPayload> = { [TableKey.Zero]: undefined, [TableKey.Two]: undefined, [TableKey.Empty]: undefined };
  const writes: EnumPayload[] = [input, marker, null, undefined, other, input], states: EnumPayload[][] = [[input, undefined, undefined], [marker, undefined, undefined], [marker, null, undefined], [marker, undefined, undefined], [marker, undefined, other], [input, undefined, other]];
  const log: unknown[] = [], expectedLog: unknown[] = [];
  for (let at = 0; at < members.length; at++) {
    same(members[at], keys[at]); same(write(table, members[at], writes[at], log), writes[at]); expectedLog.push("write", keys[at], typeof keys[at], writes[at]);
    exact(Object.keys(table), ["0", "2", ""]); exact(Object.values(table), states[at]); exact(Object.entries(table).flat(), ["0", states[at][0], "2", states[at][1], "", states[at][2]]);
  }
  same(table[TableKey.Zero], input); same(table[TableKey.TextZero], input); same(table[TableKey.Again], input); exact(log, expectedLog);
}
