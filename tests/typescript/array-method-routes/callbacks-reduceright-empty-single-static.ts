/*---
description: "reduceRight throws for empty input and returns a sole object without a callback through a declared static array field."
features: [ts-array-method-routes, ts-array-method-route-callbacks, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-strings, ts-class, ts-class-fields, ts-errors, ts-objects, ts-arrow-functions]
---*/
// reduceRight throws for empty input and returns a sole object without a callback; route: a declared static array field.
// Node prints: callbacks-reduceright-empty-single-static:ok
type RightItem = { id: number };
class RightShelf { static items: RightItem[] = []; }
const visits: number[] = [];
const callback = (sum: RightItem, value: RightItem, index: number): RightItem => {
  visits[visits.length] = index; return value;
};
const fold = (): RightItem => RightShelf.items.reduceRight(callback);
assert.throws(TypeError, fold);
const first: RightItem = { id: 4 }, second: RightItem = { id: 12 };
for (const item of [first, second]) {
  RightShelf.items = [item];
  assert.sameValue(fold() === item, true);
}
assert.compareArray(visits, []);
console.log("callbacks-reduceright-empty-single-static:ok");
