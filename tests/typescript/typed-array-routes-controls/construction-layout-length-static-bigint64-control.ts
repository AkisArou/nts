/*---
description: BigInt64 lengths allocate bigint zeros and expose eight-byte metadata.
features: [ts-typed-array-routes, ts-typed-array-route-construction, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-type-aliases, ts-class, ts-class-fields, ts-static, ts-bigint, ts-readonly, ts-tuples]
---*/
function localLength(input: number): number { const length = Number.isNaN(input) ? 0 : Math.trunc(input);
  if (!Number.isFinite(length) || length < 0) throw new RangeError(); return length; }
function localBigInt64Array(input: number): bigint[] { const length = localLength(input), values: bigint[] = [];
  for (let i = 0; i < length; i++) values[i] = 0n; return values; }
function localByteLength(values: bigint[]): number { return values.length * 8; }
function localInstanceBytesPerElement(values: bigint[]): number { return 8; }
function localStaticBytesPerElement(): number { return 8; }
// BigInt64 lengths allocate bigint zeros and expose eight-byte metadata. Route: static array field.
// Node prints construction-layout-length-static-bigint64:ok after exact observations.
type Samples = bigint[];
class SampleStore { static data: Samples = localBigInt64Array(0); }
const rows: readonly [number, readonly bigint[]][] = [[0, []], [1, [0n]], [3, [0n, 0n, 0n]]];
for (const [size, expected] of rows) {
  SampleStore.data = localBigInt64Array(size);
  const observed: bigint[] = [];
  assert.sameValue(SampleStore.data.length, expected.length);
  assert.sameValue(localByteLength(SampleStore.data), expected.length * 8);
  assert.sameValue(localInstanceBytesPerElement(SampleStore.data), 8);
  assert.sameValue(localStaticBytesPerElement(), 8);
  for (let i = 0; i < SampleStore.data.length; i++) observed[i] = SampleStore.data[i];
  assert.compareArray(observed, expected);
}
console.log("construction-layout-length-static-bigint64:ok");
