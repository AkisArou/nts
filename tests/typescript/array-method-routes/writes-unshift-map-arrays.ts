/*---
description: "Unshift prepends all arguments in order and returns the new length without changing the argument array through guarded Map lookups of typed array records."
features: [ts-array-method-routes, ts-array-method-route-writes, ts-arrays, ts-functions, ts-iteration, ts-map-set, ts-readonly, ts-objects, ts-type-aliases, ts-unions, ts-numbers, ts-strings, ts-null-undefined, ts-spread]
---*/

// Unshift prepends all arguments in order and returns the new length without changing the argument array; route: guarded Map lookups of typed array records.
// Node prints writes-unshift-map-arrays:ok.
type Item = number | string | { id: number } | null | undefined;
type Route = { input: Item[]; added: Item[]; expected: readonly Item[] };
const marker: { id: number } = { id: 7 };
const routes: Map<string, Route> = new Map<string, Route>([
  ["empty", { input: [], added: [-0, NaN, null, undefined], expected: [-0, NaN, null, undefined] }],
  ["single", { input: [null], added: [marker], expected: [marker, null] }],
  ["mixed", { input: ["tail", marker], added: [marker, undefined], expected: [marker, undefined, "tail", marker] }],
  ["none", { input: [1, 3], added: [], expected: [1, 3] }],
  ["empty-none", { input: [], added: [], expected: [] }]
]);
for (const key of ["empty", "single", "mixed", "none", "empty-none"]) {
  const route = routes.get(key);
  if (route === undefined) throw new Error("missing route");
  const added: Item[] = [];
  for (const value of route.added) added[added.length] = value;
  const result = route.input.unshift(...route.added);
  assert.sameValue(result, route.expected.length);
  assert.compareArray(route.input, route.expected);
  assert.compareArray(route.added, added);
}
console.log("writes-unshift-map-arrays:ok");
