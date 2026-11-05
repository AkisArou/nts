/*---
description: BigInt64 lengths allocate bigint zeros and expose eight-byte metadata.
features: [ts-typed-array-routes, ts-typed-array-route-construction, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-type-aliases, ts-class, ts-class-fields, ts-static, ts-bigint, ts-readonly, ts-tuples]
---*/
// BigInt64 lengths allocate bigint zeros and expose eight-byte metadata. Route: static array field.
// Node prints construction-layout-length-static-bigint64:ok after exact observations.
type Samples = BigInt64Array;
class SampleStore { static data: Samples = new BigInt64Array(0); }
const rows: readonly [number, readonly bigint[]][] = [[0, []], [1, [0n]], [3, [0n, 0n, 0n]]];
for (const [size, expected] of rows) {
  SampleStore.data = new BigInt64Array(size);
  const observed: bigint[] = [];
  assert.sameValue(SampleStore.data.length, expected.length);
  assert.sameValue(SampleStore.data.byteLength, expected.length * 8);
  assert.sameValue(SampleStore.data.BYTES_PER_ELEMENT, 8);
  assert.sameValue(BigInt64Array.BYTES_PER_ELEMENT, 8);
  for (let i = 0; i < SampleStore.data.length; i++) observed[i] = SampleStore.data[i];
  assert.compareArray(observed, expected);
}
console.log("construction-layout-length-static-bigint64:ok");
