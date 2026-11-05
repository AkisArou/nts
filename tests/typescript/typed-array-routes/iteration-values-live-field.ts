/*---
description: "Values iterators read the current element and preserve a signed zero."
features: [ts-typed-array-routes, ts-typed-array-route-iteration, ts-arrays, ts-functions, ts-iteration, ts-type-aliases, ts-readonly, ts-numbers, ts-class, ts-class-fields]
---*/

// Values iterators read the current element and preserve a signed zero. Route: a declared floating array field.
// Node prints iteration-values-live-field:ok.
type Values = Float64Array;
class LiveSamples { data: Values = new Float64Array([1, -0, 3]); }
for (const replacement of [9, -Infinity]) {
  const holder = new LiveSamples(), iterator = holder.data.values(), seen: number[] = [];
  for (const value of iterator) { seen.push(value); if (seen.length === 1) holder.data[2] = replacement; }
  assert.compareArray(seen, [1, -0, replacement]);
  assert.sameValue(iterator.next().done, true);
}
console.log("iteration-values-live-field:ok");
