/*---
description: Float64 lengths allocate positive zeros and expose eight-byte metadata.
features: [ts-typed-array-routes, ts-typed-array-route-construction, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-type-aliases, ts-class, ts-class-fields, ts-private-fields, ts-readonly, ts-tuples]
---*/
// Float64 lengths allocate positive zeros and expose eight-byte metadata. Route: private array field.
// Node prints construction-layout-length-private-float64:ok after exact observations.
type Samples = Float64Array;
class SampleStore {
  #data: Samples;
  constructor(size: number) { this.#data = new Float64Array(size); }
  read(): Samples { return this.#data; }
}
const rows: readonly [number, readonly number[]][] = [[0, []], [1, [0]], [2, [0, 0]], [4, [0, 0, 0, 0]]];
for (const [size, expected] of rows) {
  const data = new SampleStore(size).read(), observed: number[] = [];
  assert.sameValue(data.length, expected.length);
  assert.sameValue(data.byteLength, expected.length * 8);
  assert.sameValue(data.BYTES_PER_ELEMENT, 8);
  assert.sameValue(Float64Array.BYTES_PER_ELEMENT, 8);
  for (let i = 0; i < data.length; i++) observed[i] = data[i];
  assert.compareArray(observed, expected);
}
console.log("construction-layout-length-private-float64:ok");
