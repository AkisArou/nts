/*---
description: "Values iterators read the current element and preserve a signed zero. (control)"
features: [ts-typed-array-routes, ts-typed-array-route-iteration, ts-arrays, ts-functions, ts-iteration, ts-type-aliases, ts-readonly, ts-numbers, ts-class, ts-class-fields]
---*/

function localFloat64Array(values: readonly number[]): number[] { const result: number[] = []; for (let i = 0; i < values.length; i++) result[i] = values[i]; return result; }
function* localValues(data: number[]): IterableIterator<number> { for (let i = 0; i < data.length; i++) yield data[i]; }
// Values iterators read the current element and preserve a signed zero. Route: a declared floating array field.
// Node prints iteration-values-live-field:ok.
type Values = number[];
class LiveSamples { data: Values = localFloat64Array([1, -0, 3]); }
for (const replacement of [9, -Infinity]) {
  const holder = new LiveSamples(), iterator = localValues(holder.data), seen: number[] = [];
  for (const value of iterator) { seen.push(value); if (seen.length === 1) holder.data[2] = replacement; }
  assert.compareArray(seen, [1, -0, replacement]);
  assert.sameValue(iterator.next().done, true);
}
console.log("iteration-values-live-field:ok");
