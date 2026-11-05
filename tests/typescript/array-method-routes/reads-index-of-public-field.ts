/*---
description: "indexOf uses strict equality for NaN, signed zero, strings, nullish values and repeated object references."
features: [ts-array-method-routes, ts-array-method-route-reads, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-class, ts-class-fields, ts-type-aliases, ts-unions, ts-strings, ts-null-undefined, ts-objects, ts-tuples, ts-readonly, ts-destructuring]
---*/

// indexOf uses strict equality for NaN, signed zero, strings, nullish values and repeated object references. Route: a declared union-array public field. Node prints reads-index-of-public-field:ok.
type SearchValue = number | string | null | undefined | { id: number };
const marker = { id: 7 }, clone = { id: 7 };
class IndexBox { items: SearchValue[] = [NaN, -0, "text", marker, null, undefined, marker, "text"]; }
const box = new IndexBox();
const queries: readonly [SearchValue, number][] = [[NaN, -1], [0, 1], [-0, 1], ["text", 2], [clone, -1], [marker, 3], [null, 4], [undefined, 5]];
for (const [needle, expected] of queries) {
  const found = box.items.indexOf(needle);
  assert.sameValue(found, expected);
}
assert.sameValue(Object.is(box.items[1], -0), true);
console.log("reads-index-of-public-field:ok");
