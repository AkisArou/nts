/*---
description: Fractional and NaN lengths replace a captured array with independent zero storage.
features: [ts-typed-array-routes, ts-typed-array-route-construction, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-type-aliases, ts-closures, ts-function-types, ts-arrow-functions, ts-readonly, ts-tuples]
---*/
function localLength(input: number): number { const length = Number.isNaN(input) ? 0 : Math.trunc(input);
  if (!Number.isFinite(length) || length < 0) throw new RangeError(); return length; }
function localUint8Array(input: number): number[] { const length = localLength(input), values: number[] = [];
  for (let i = 0; i < length; i++) values[i] = 0; return values; }
// Fractional and NaN lengths replace a captured array with independent zero storage. Route: captured replaced array binding.
// Node prints construction-layout-length-captured-fractional:ok after exact observations.
type Samples = number[];
let data: Samples = localUint8Array(3);
data[0] = 9;
const previous = data;
const currentLength: () => number = () => data.length;
const first: () => number = () => data[0];
const rows: readonly [number, readonly number[]][] = [[1.9, [0]], [3.9, [0, 0, 0]], [0.5, []], [NaN, []]];
for (const [size, expected] of rows) {
  data = localUint8Array(size);
  const observed: number[] = [];
  assert.sameValue(currentLength(), expected.length);
  assert.sameValue(first(), expected[0]);
  assert.sameValue(data === previous, false);
  for (let i = 0; i < data.length; i++) observed[i] = data[i];
  assert.compareArray(observed, expected);
  assert.sameValue(previous[0], 9);
  assert.sameValue(previous.length, 3);
}
console.log("construction-layout-length-captured-fractional:ok");
