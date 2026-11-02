/*---
description: "Explicit object control: A numeric enum object crosses a readonly table parameter with interleaved non-index reverse keys."
features: [ts-enum-routes, ts-enum-route-object-data, ts-functions, ts-arrays, ts-iteration, ts-unknown, ts-typeof-operator, ts-objects, ts-object-type, ts-readonly, ts-strings, ts-numbers, ts-type-aliases, ts-unions, ts-record, ts-tuples, ts-null-undefined, ts-computed-keys]
---*/
// Enum object parameter: Node retains integer-key sorting, negative/fractional reverse-key insertion positions and the last alias name; every lookup and complete ordered listing is checked. Control: Use frozen forward and explicit reverse objects, then create one frozen enum-shaped object in declaration order and pass that stored object through the unchanged readonly table consumer.
function same(a: unknown, b: unknown): void { assert.sameValue(Object.is(a, b), true); assert.sameValue(typeof a, typeof b); }
function exact(a: readonly unknown[], b: readonly unknown[]): void { assert.compareArray(a, b); for (let i = 0; i < a.length; i++) same(a[i], b[i]); }
function listing(value: object, keys: readonly string[], values: readonly unknown[]): void {
  exact(Object.keys(value), keys); exact(Object.values(value), values); const entries = Object.entries(value); same(entries.length, keys.length);
  for (let i = 0; i < entries.length; i++) exact(entries[i], [keys[i], values[i]]);
  const visited: string[] = []; for (const key in value) visited.push(key); exact(visited, keys);
}
type Table = Readonly<Record<string, number | string>>;
const ObjectModeForward = Object.freeze({ "Ten": 10, "Negative": -1, "Half": 0.5, "Zero": 0, "Alias": 10 });
const ObjectModeReverse: Readonly<Record<number, string>> = Object.freeze({"10": "Alias", "-1": "Negative", "0.5": "Half", "0": "Zero"});
const ObjectMode = Object.freeze({ "Ten": ObjectModeForward["Ten"], [ObjectModeForward["Ten"]]: ObjectModeReverse[ObjectModeForward["Ten"]], "Negative": ObjectModeForward["Negative"], [ObjectModeForward["Negative"]]: ObjectModeReverse[ObjectModeForward["Negative"]], "Half": ObjectModeForward["Half"], [ObjectModeForward["Half"]]: ObjectModeReverse[ObjectModeForward["Half"]], "Zero": ObjectModeForward["Zero"], [ObjectModeForward["Zero"]]: ObjectModeReverse[ObjectModeForward["Zero"]], "Alias": ObjectModeForward["Alias"] });
const log: unknown[] = [];
function inspect(table: Table, value: number, expected: string | undefined): void {
  same(table, ObjectMode); const name = table[value]; log.push("lookup", value, name); same(name, expected);
  listing(table, ["0", "10", "Ten", "Negative", "-1", "Half", "0.5", "Zero", "Alias"], ["Zero", "Alias", 10, -1, "Negative", 0.5, "Half", 0, 10]);
}
const rows: [number, string | undefined][] = [[ObjectMode.Ten, "Alias"], [ObjectMode.Negative, "Negative"], [ObjectMode.Half, "Half"], [ObjectMode.Zero, "Zero"], [ObjectMode.Alias, "Alias"], [ObjectMode.Ten + 1, undefined], [-0, "Zero"]];
for (const [value, expected] of rows) { log.length = 0; inspect(ObjectMode, value, expected); exact(log, ["lookup", value, expected]); }
