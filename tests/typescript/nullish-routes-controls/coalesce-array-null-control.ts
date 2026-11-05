/*---
description: "An in-bounds array read replaces null but retains zero and NaN. Route: nullable array element (control)"
features: [ts-nullish-routes, ts-nullish-route-coalesce, ts-null-undefined, ts-arrays, ts-numbers]
---*/

// An in-bounds array read replaces null but retains zero and NaN. Route: nullable array element. Node prints coalesce-array-null:ok.
const items: (number | null)[] = [0, -0, NaN, null, 6];
function read(index: number): number {
  const saved = items[index]; const result = saved === null || saved === undefined ? 11 : saved;
  return result;
}
const expected = [0, -0, NaN, 11, 6];
for (let i = 0; i < items.length; i++) assert.sameValue(read(i), expected[i]);
console.log("coalesce-array-null:ok");
