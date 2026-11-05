/*---
description: "map passes each original value, index and receiver into a fresh result through a constrained generic at two item types. (control)"
features: [ts-array-method-routes, ts-array-method-route-callbacks, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-strings, ts-generics, ts-generic-constraints, ts-objects, ts-arrow-functions]
---*/
function localMap<T, U>(items: T[], callback: (value: T, index: number, owner: T[]) => U): U[] {
  const result: U[] = [];
  for (let index = 0; index < items.length; index++) result[index] = callback(items[index], index, items);
  return result;
}
// map passes each original value, index and receiver into a fresh result; route: a constrained generic at two item types.
// Node prints: callbacks-map-generic:ok
function label<T extends { id: number }>(items: T[], suffix: string): string[] {
  const visits: string[] = [];
  const callback = (value: T, index: number, owner: T[]): string => {
    visits[visits.length] = index + ":" + value.id + ":" + (owner === items);
    return value.id + suffix + index;
  };
  const result = localMap(items, callback);
  const original: object = items; assert.sameValue(result === original, false);
  assert.compareArray(visits, ["0:7:true", "1:2:true", "2:11:true"]);
  assert.sameValue(items[0].id, 7); assert.sameValue(items[2].id, 11);
  return result;
}
assert.compareArray(label<{ id: number; text: string }>([{ id: 7, text: "a" }, { id: 2, text: "b" }, { id: 11, text: "c" }], "/"), ["7/0", "2/1", "11/2"]);
assert.compareArray(label<{ id: number; active: boolean }>([{ id: 7, active: true }, { id: 2, active: false }, { id: 11, active: true }], "#"), ["7#0", "2#1", "11#2"]);
console.log("callbacks-map-generic:ok");
