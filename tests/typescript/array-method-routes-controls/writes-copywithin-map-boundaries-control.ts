/*---
description: "CopyWithin respects negative ends out-of-range starts and reversed ranges while retaining receiver identity through guarded Map lookups of typed array records. (control)"
features: [ts-array-method-routes, ts-array-method-route-writes, ts-arrays, ts-functions, ts-iteration, ts-map-set, ts-readonly, ts-objects, ts-type-aliases, ts-unions, ts-numbers, ts-strings, ts-null-undefined]
---*/

function localIndex(value: number, length: number): number {
  let index = value !== value ? 0 : value === Infinity ? length : value === -Infinity ? 0 : value - value % 1;
  if (index < 0) index += length;
  return index < 0 ? 0 : index > length ? length : index;
}
function localCopyWithin<T>(items: T[], target: number, start: number, end: number = items.length): T[] {
  const to = localIndex(target, items.length), from = localIndex(start, items.length), last = localIndex(end, items.length), copied: T[] = [];
  for (let i = from; i < last && to + copied.length < items.length; i++) copied[copied.length] = items[i];
  for (let i = 0; i < copied.length; i++) items[to + i] = copied[i];
  return items;
}
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
  const result = localCopyWithin(route.input, route.target, route.start, route.end);
  assert.sameValue(result === route.input, true);
  assert.compareArray(route.input, route.expected);
}
console.log("writes-copywithin-map-boundaries:ok");
