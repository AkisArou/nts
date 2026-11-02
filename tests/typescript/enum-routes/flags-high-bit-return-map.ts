/*---
description: "Signed high-bit enum returns feed exact mask results retained in a typed Map."
features: [ts-enum-routes, ts-enum-route-flags-merging, ts-functions, ts-arrays, ts-iteration, ts-unknown, ts-typeof-operator, ts-objects, ts-object-type, ts-readonly, ts-strings, ts-numbers, ts-unions, ts-tuples, ts-map-set, ts-null-undefined, ts-enum, ts-enum-reverse-mapping]
---*/
// An enum return carries zero, low, sign-bit, all-bit and alias values into masks; Node preserves signed results, exact reverse names and insertion-ordered Map readback.
function same(a: unknown, b: unknown): void { assert.sameValue(Object.is(a, b), true); assert.sameValue(typeof a, typeof b); }
function exact(a: readonly unknown[], b: readonly unknown[]): void { assert.compareArray(a, b); for (let i = 0; i < a.length; i++) same(a[i], b[i]); }
function listing(value: object, keys: readonly string[], values: readonly unknown[]): void {
  exact(Object.keys(value), keys); exact(Object.values(value), values); const entries = Object.entries(value); same(entries.length, keys.length);
  for (let i = 0; i < entries.length; i++) exact(entries[i], [keys[i], values[i]]);
  const visited: string[] = []; for (const key in value) visited.push(key); exact(visited, keys);
}
enum Wide { None = 0, Low = 1, Top = -2147483648, All = -1, TopAlias = -2147483648 }
const log: unknown[] = [], results = new Map<string, number>();
function select(flag: Wide): Wide { log.push("select", flag); return flag; }
listing(Wide, ["0", "1", "None", "Low", "Top", "-2147483648", "All", "-1", "TopAlias"], ["None", "Low", 0, 1, -2147483648, "TopAlias", -1, "All", -2147483648]);
const rows: [string, number, Wide, Wide, number, number, number, string | undefined][] = [["none", 0, Wide.None, Wide.None, 0, 0, 0, "None"], ["low", 0, Wide.Low, Wide.Top, 1, 0, 1, "Low"], ["top", 1, Wide.Top, Wide.Low, -2147483647, 1, -2147483648, "TopAlias"], ["all", 0, Wide.All, Wide.Top, -1, -2147483648, 2147483647, undefined], ["alias", 7, Wide.TopAlias, Wide.Low, -2147483641, 1, -2147483642, undefined], ["outside", 2147483648, Wide.Low, Wide.All, -2147483647, -2147483647, 0, "None"]];
for (const [key, input, flag, remove, combined, tested, cleared, reverse] of rows) {
  log.length = 0; const selected: Wide = select(flag); same(selected, flag); const joined = input | selected, test = joined & remove;
  if (test === 0) log.push("absent", test); else log.push("present", test); const result = joined & ~remove; results.set(key, result);
  same(joined, combined); same(test, tested); same(result, cleared); same(results.get(key), cleared); same(Wide[result], reverse);
  exact(log, ["select", flag, tested === 0 ? "absent" : "present", tested]);
}
same(results.size, rows.length); exact(Array.from(results.keys()), ["none", "low", "top", "all", "alias", "outside"]);
for (const row of rows) same(results.get(row[0]), row[6]);
