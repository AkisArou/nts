/*---
description: "reduce without an initial value throws on empty input and returns a sole item without calling back through a captured let that is reassigned before each fold."
features: [ts-array-method-routes, ts-array-method-route-callbacks, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-strings, ts-closures, ts-arrow-functions, ts-errors, ts-objects]
---*/
// reduce without an initial value throws on empty input and returns a sole item without calling back; route: a captured let that is reassigned before each fold.
// Node prints: callbacks-reduce-empty-single-closure:ok
type FoldItem = { id: number };
let items: FoldItem[] = [];
const visits: number[] = [];
const callback = (sum: FoldItem, value: FoldItem, index: number): FoldItem => {
  visits[visits.length] = index; return value;
};
const fold = (): FoldItem => items.reduce(callback);
assert.throws(TypeError, fold);
const first: FoldItem = { id: 8 }, second: FoldItem = { id: 3 };
for (const item of [first, second]) {
  items = [item];
  assert.sameValue(fold() === item, true);
}
assert.compareArray(visits, []);
console.log("callbacks-reduce-empty-single-closure:ok");
