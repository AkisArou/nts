/*---
description: "lastIndexOf uses strict equality while selecting the final matching string or object occurrence."
features: [ts-array-method-routes, ts-array-method-route-reads, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-class, ts-class-fields, ts-static, ts-type-aliases, ts-unions, ts-strings, ts-null-undefined, ts-objects, ts-readonly, ts-tuples, ts-destructuring]
---*/

// lastIndexOf uses strict equality while selecting the final matching string or object occurrence. Route: a static union-array field. Node prints reads-last-index-of-static-equality:ok.
type SearchValue = number | string | null | undefined | { id: number };
const marker = { id: 7 }, clone = { id: 7 };
class LastStore { static items: SearchValue[] = [NaN, -0, "text", marker, null, undefined, marker, "text"]; }
const queries: readonly [SearchValue, number][] = [[NaN, -1], [0, 1], [-0, 1], ["text", 7], [clone, -1], [marker, 6], [null, 4], [undefined, 5]];
for (const [needle, expected] of queries) {
  const found = LastStore.items.lastIndexOf(needle);
  assert.sameValue(found, expected);
}
assert.sameValue(Object.is(LastStore.items[1], -0), true);
console.log("reads-last-index-of-static-equality:ok");
