/*---
description: "Control for string-map-alias-reinsert; String enum aliases overwrite one Map entry and reinsertion moves that entry while retaining exact payloads."
features: [ts-enum-routes, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-strings, ts-numbers, ts-unknown, ts-typeof-operator, ts-readonly, ts-enum-route-string-heterogeneous, ts-map-set, ts-spread, ts-type-aliases, ts-unions, ts-null-undefined, ts-literal-types]
---*/
// Every MapKey crosses one typed Map writer; node preserves insertion order, shares the alias slot, and moves the deleted/reinserted key to the end. The control uses frozen forward values and literal types, plus explicit reverse entries where observed.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: readonly unknown[], expected: readonly unknown[]): void { assert.compareArray(actual, expected); for (let i = 0; i < actual.length; i++) same(actual[i], expected[i]); }
const MapKey = Object.freeze({ Empty: "", Ten: "10", Two: "2", Alias: "10" }); type MapKey = "" | "10" | "2";
type EnumPayload = number | string | null | undefined | { id: number };
const marker = { id: 7 }, other = { id: 7 }, inputs: EnumPayload[] = [-0, NaN, "", undefined, null, marker, other];
const members: MapKey[] = [MapKey.Empty, MapKey.Ten, MapKey.Two, MapKey.Alias], keys = ["", "10", "2", "10"];
function write(table: Map<MapKey, EnumPayload>, key: MapKey, value: EnumPayload, log: unknown[]): void { same(table.set(key, value), table); log.push("write", key, table.get(key)); }
for (const input of inputs) {
  const table = new Map<MapKey, EnumPayload>(), writes: EnumPayload[] = [input, marker, undefined, other], log: unknown[] = [], expectedLog: unknown[] = [];
  for (let at = 0; at < members.length; at++) { same(members[at], keys[at]); write(table, members[at], writes[at], log); expectedLog.push("write", keys[at], writes[at]); }
  same(table.size, 3); exact([...table.keys()], ["", "10", "2"]); exact([...table.values()], [input, other, undefined]); exact([...table.entries()].flat(), ["", input, "10", other, "2", undefined]);
  const removed = table.delete(MapKey.Alias); log.push("delete", removed, table.has(MapKey.Ten)); same(removed, true);
  write(table, MapKey.Ten, input, log); expectedLog.push("delete", true, false, "write", "10", input);
  same(table.size, 3); exact([...table.keys()], ["", "2", "10"]); exact([...table.values()], [input, undefined, input]); exact([...table.entries()].flat(), ["", input, "2", undefined, "10", input]);
  same(table.get(MapKey.Alias), input); exact(log, expectedLog);
}
