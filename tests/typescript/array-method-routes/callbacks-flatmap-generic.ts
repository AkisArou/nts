/*---
description: "flatMap passes every original slot once and concatenates callback arrays in order through a constrained generic at two item types."
features: [ts-array-method-routes, ts-array-method-route-callbacks, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-strings, ts-generics, ts-generic-constraints, ts-objects, ts-arrow-functions]
---*/
// flatMap passes every original slot once and concatenates callback arrays in order; route: a constrained generic at two item types.
// Node prints: callbacks-flatmap-generic:ok
function repeat<T extends { id: number }>(items: T[]): T[] {
  const log: string[] = [];
  const callback = (value: T, index: number, owner: T[]): T[] => {
    log[log.length] = index + ":" + value.id + ":" + (owner === items);
    return index === 1 ? [] : [value, value];
  };
  const result = items.flatMap(callback);
  assert.compareArray(log, ["0:4:true", "1:9:true", "2:2:true"]);
  assert.compareArray(result, [items[0], items[0], items[2], items[2]]);
  assert.sameValue(result === items, false);
  assert.sameValue(items.length, 3);
  return result;
}
const textItems = [{ id: 4, text: "a" }, { id: 9, text: "b" }, { id: 2, text: "c" }];
const flags = [{ id: 4, flag: true }, { id: 9, flag: false }, { id: 2, flag: true }];
assert.sameValue(repeat<{ id: number; text: string }>(textItems)[2], textItems[2]);
assert.sameValue(repeat<{ id: number; flag: boolean }>(flags)[0], flags[0]);
console.log("callbacks-flatmap-generic:ok");
