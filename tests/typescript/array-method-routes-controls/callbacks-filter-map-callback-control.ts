/*---
description: "filter preserves object identities and selection order while reporting every original slot through a callback read from a typed Map. (control)"
features: [ts-array-method-routes, ts-array-method-route-callbacks, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-strings, ts-map-set, ts-function-types, ts-objects, ts-arrow-functions]
---*/
function localFilter<T>(items: T[], callback: (value: T, index: number, owner: T[]) => boolean): T[] {
  const result: T[] = [];
  for (let index = 0; index < items.length; index++) if (callback(items[index], index, items)) result[result.length] = items[index];
  return result;
}
// filter preserves object identities and selection order while reporting every original slot; route: a callback read from a typed Map.
// Node prints: callbacks-filter-map-callback:ok
type FilterItem = { id: number; keep: boolean };
type FilterVisit = (value: FilterItem, index: number, owner: FilterItem[]) => boolean;
const first: FilterItem = { id: 8, keep: true }, second: FilterItem = { id: 3, keep: false }, third: FilterItem = { id: 5, keep: true };
const items: FilterItem[] = [first, second, third], log: string[] = [];
const callbacks: Map<string, FilterVisit> = new Map([
  ["keep", (value, index, owner) => { log[log.length] = index + ":" + value.id + ":" + (owner === items); return value.keep; }],
  ["drop", (value, index, owner) => { log[log.length] = index + ":" + value.id + ":" + (owner === items); return !value.keep; }],
]);
for (const key of ["keep", "drop"]) {
  const callback = callbacks.get(key); if (callback === undefined) throw new Error("missing callback");
  log.length = 0;
  const result = localFilter(items, callback);
  assert.compareArray(result, key === "keep" ? [first, third] : [second]);
  assert.sameValue(result === items, false);
  assert.compareArray(log, ["0:8:true", "1:3:true", "2:5:true"]);
  assert.compareArray(items, [first, second, third]);
}
console.log("callbacks-filter-map-callback:ok");
