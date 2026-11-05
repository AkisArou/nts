/*---
description: Float64 lengths allocate positive zeros and expose eight-byte metadata.
features: [ts-typed-array-routes, ts-typed-array-route-construction, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-type-aliases, ts-class, ts-class-fields, ts-private-fields, ts-readonly, ts-tuples]
---*/
function localLength(input: number): number { const length = Number.isNaN(input) ? 0 : Math.trunc(input);
  if (!Number.isFinite(length) || length < 0) throw new RangeError(); return length; }
function localFloat64Array(input: number): number[] { const length = localLength(input), values: number[] = [];
  for (let i = 0; i < length; i++) values[i] = 0; return values; }
function localByteLength(values: number[]): number { return values.length * 8; }
function localInstanceBytesPerElement(values: number[]): number { return 8; }
function localStaticBytesPerElement(): number { return 8; }
// Float64 lengths allocate positive zeros and expose eight-byte metadata. Route: private array field.
// Node prints construction-layout-length-private-float64:ok after exact observations.
type Samples = number[];
class SampleStore {
  #data: Samples;
  constructor(size: number) { this.#data = localFloat64Array(size); }
  read(): Samples { return this.#data; }
}
const rows: readonly [number, readonly number[]][] = [[0, []], [1, [0]], [2, [0, 0]], [4, [0, 0, 0, 0]]];
for (const [size, expected] of rows) {
  const data = new SampleStore(size).read(), observed: number[] = [];
  assert.sameValue(data.length, expected.length);
  assert.sameValue(localByteLength(data), expected.length * 8);
  assert.sameValue(localInstanceBytesPerElement(data), 8);
  assert.sameValue(localStaticBytesPerElement(), 8);
  for (let i = 0; i < data.length; i++) observed[i] = data[i];
  assert.compareArray(observed, expected);
}
console.log("construction-layout-length-private-float64:ok");
