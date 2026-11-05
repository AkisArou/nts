/*---
description: Int16 lengths allocate zero elements and expose two-byte metadata.
features: [ts-typed-array-routes, ts-typed-array-route-construction, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-type-aliases, ts-class, ts-class-fields, ts-readonly, ts-tuples]
---*/
// Int16 lengths allocate zero elements and expose two-byte metadata. Route: public array field.
// Node prints construction-layout-length-public-int16:ok after exact observations.
type Samples = Int16Array;
class SampleStore { data: Samples; constructor(size: number) { this.data = new Int16Array(size); } }
const rows: readonly [number, readonly number[]][] = [[0, []], [1, [0]], [3, [0, 0, 0]], [1.5, [0]], [-0.5, []], [NaN, []]];
for (const [size, expected] of rows) {
  const store = new SampleStore(size), observed: number[] = [];
  assert.sameValue(store.data.length, expected.length);
  assert.sameValue(store.data.byteLength, expected.length * 2);
  assert.sameValue(store.data.BYTES_PER_ELEMENT, 2);
  assert.sameValue(Int16Array.BYTES_PER_ELEMENT, 2);
  for (let i = 0; i < store.data.length; i++) observed[i] = store.data[i];
  assert.compareArray(observed, expected);
}
console.log("construction-layout-length-public-int16:ok");
