/*---
description: "CopyWithin respects negative ends out-of-range starts and reversed ranges while retaining receiver identity through guarded Map lookups of typed array records."
features: [ts-array-method-routes, ts-array-method-route-writes, ts-arrays, ts-functions, ts-iteration, ts-map-set, ts-readonly, ts-objects, ts-type-aliases, ts-unions, ts-numbers, ts-strings, ts-null-undefined]
---*/

// CopyWithin respects negative ends out-of-range starts and reversed ranges while retaining receiver identity; route: guarded Map lookups of typed array records.
// Node prints writes-copywithin-map-boundaries:ok.
type Item = number | string | { id: number } | null | undefined;
type Route = { input: Item[]; target: number; start: number; end: number | undefined; expected: readonly Item[] };
const marker: { id: number } = { id: 7 };
const routes: Map<string, Route> = new Map<string, Route>([
  ["empty", { input: [], target: 0, start: 0, end: undefined, expected: [] }],
  ["one", { input: [marker], target: -1, start: 0, end: 1, expected: [marker] }],
  ["end", { input: [1, marker, null, undefined, "tail"], target: 0, start: 2, end: -1, expected: [null, undefined, null, undefined, "tail"] }],
  ["outside", { input: [1, marker, "tail"], target: 0, start: 10, end: undefined, expected: [1, marker, "tail"] }],
  ["backwards", { input: [1, marker, "tail"], target: 0, start: 2, end: 1, expected: [1, marker, "tail"] }]
]);
for (const key of ["empty", "one", "end", "outside", "backwards"]) {
  const route = routes.get(key);
  if (route === undefined) throw new Error("missing route");
  const result = route.input.copyWithin(route.target, route.start, route.end);
  assert.sameValue(result === route.input, true);
  assert.compareArray(route.input, route.expected);
}
console.log("writes-copywithin-map-boundaries:ok");
