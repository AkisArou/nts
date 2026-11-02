/*---
description: "Control for string-record-alias-order; String enum keys retain numeric-string ordering and alias overwrite positions through a Record parameter."
features: [ts-enum-routes, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-strings, ts-numbers, ts-unknown, ts-typeof-operator, ts-readonly, ts-enum-route-string-heterogeneous, ts-record, ts-computed-keys, ts-type-aliases, ts-unions, ts-null-undefined, ts-literal-types]
---*/
// Every StringKey reaches one Record writer with exact payloads; node orders integer keys first and keeps the aliased label in its original position. The control uses frozen forward values and literal types, plus explicit reverse entries where observed.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: readonly unknown[], expected: readonly unknown[]): void { assert.compareArray(actual, expected); for (let i = 0; i < actual.length; i++) same(actual[i], expected[i]); }
const StringKey = Object.freeze({ Later: "10", Earlier: "2", Empty: "", Label: "label", Alias: "label" }); type StringKey = "10" | "2" | "" | "label";
type EnumPayload = number | string | null | undefined | { id: number };
const marker = { id: 7 }, other = { id: 7 }, inputs: EnumPayload[] = [-0, NaN, "", undefined, null, marker, other];
const members: StringKey[] = [StringKey.Later, StringKey.Earlier, StringKey.Empty, StringKey.Label, StringKey.Alias], keys = ["10", "2", "", "label", "label"];
function write(table: Record<StringKey, EnumPayload>, key: StringKey, value: EnumPayload, log: unknown[]): EnumPayload { log.push("write", key, value); table[key] = value; return table[key]; }
for (const input of inputs) {
  const table: Record<StringKey, EnumPayload> = { [StringKey.Later]: undefined, [StringKey.Earlier]: undefined, [StringKey.Empty]: undefined, [StringKey.Label]: undefined };
  const writes: EnumPayload[] = [input, marker, null, other, input], states: EnumPayload[][] = [[undefined, input, undefined, undefined], [marker, input, undefined, undefined], [marker, input, null, undefined], [marker, input, null, other], [marker, input, null, input]];
  const log: unknown[] = [], expectedLog: unknown[] = [];
  for (let at = 0; at < members.length; at++) {
    same(members[at], keys[at]); same(write(table, members[at], writes[at], log), writes[at]); expectedLog.push("write", keys[at], writes[at]);
    exact(Object.keys(table), ["2", "10", "", "label"]); exact(Object.values(table), states[at]);
    exact(Object.entries(table).flat(), ["2", states[at][0], "10", states[at][1], "", states[at][2], "label", states[at][3]]);
  }
  exact(log, expectedLog); same(table[StringKey.Label], input); same(table[StringKey.Alias], input);
}
