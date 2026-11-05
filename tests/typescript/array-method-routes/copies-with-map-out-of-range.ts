/*---
description: "With throws RangeError for both out-of-range ends and infinities on empty and nonempty arrays through guarded Map lookups of array and index records."
features: [ts-array-method-routes, ts-array-method-route-copies, ts-arrays, ts-functions, ts-iteration, ts-map-set, ts-readonly, ts-objects, ts-numbers, ts-strings, ts-arrow-functions, ts-errors]
---*/

// With throws RangeError for both out-of-range ends and infinities on empty and nonempty arrays; route: guarded Map lookups of array and index records.
// Node prints copies-with-map-out-of-range:ok.
type Route = { input: readonly string[]; invalid: readonly number[] };
const routes: Map<string, Route> = new Map<string, Route>([
  ["empty", { input: [], invalid: [0, -1, Infinity, -Infinity] }],
  ["full", { input: ["a", "b", "c"], invalid: [3, -4, Infinity, -Infinity] }]
]);
let checks: number = 0;
for (const key of ["empty", "full"]) {
  const route = routes.get(key);
  if (route === undefined) throw new Error("missing route");
  const before: string[] = [];
  for (const value of route.input) before[before.length] = value;
  for (const index of route.invalid) {
    assert.throws(RangeError, () => route.input.with(index, "x"));
    assert.compareArray(route.input, before);
    checks++;
  }
}
assert.sameValue(checks, 8);
console.log("copies-with-map-out-of-range:ok");
