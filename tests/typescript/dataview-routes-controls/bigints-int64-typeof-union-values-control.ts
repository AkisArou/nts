/*---
description: "BigInt64 stores both narrowed bigint and record payloads with the same exact low bits and signed little-endian result. (control)"
features: [ts-dataview-routes, ts-dataview-route-bigints, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-bigint, ts-type-aliases, ts-unions, ts-objects, ts-typeof-operator, ts-narrowing, ts-readonly, ts-tuples, ts-destructuring]
---*/

function localArrayBuffer(size: number): number[] { const bytes: number[] = []; for (let i = 0; i < size; i++) bytes[i] = 0; return bytes; }
function localDataView(bytes: number[]): number[] { return bytes; }
function localIndex(bytes: number[], offset: number): number {
  if (offset === Infinity || offset === -Infinity) throw new RangeError(); offset = offset !== offset ? 0 : offset - offset % 1;
  if (offset < 0 || offset + 8 > bytes.length) throw new RangeError(); return offset;
}
function localBigGet(bytes: number[], offset: number, signed: boolean, little = false): bigint {
  offset = localIndex(bytes, offset); let value = 0n; for (let i = 0; i < 8; i++) value = value * 256n + BigInt(bytes[offset + (little ? 7 - i : i)]);
  return signed && value >= 0x8000000000000000n ? value - 0x10000000000000000n : value;
}
function localBigSet(bytes: number[], offset: number, value: bigint, little = false): void {
  offset = localIndex(bytes, offset); const modulus = 0x10000000000000000n; value = (value % modulus + modulus) % modulus;
  for (let i = 0; i < 8; i++) { bytes[offset + (little ? i : 7 - i)] = Number(value % 256n); value /= 256n; }
}
function localSetBigInt64(bytes: number[], offset: number, value: bigint, little = false): void { localBigSet(bytes, offset, value, little); }
function localGetUint8(bytes: number[], offset: number): number { return bytes[offset]; }
function localGetBigInt64(bytes: number[], offset: number, little = false): bigint { return localBigGet(bytes, offset, true, little); }
// BigInt64 stores both narrowed bigint and record payloads with the same exact low bits and signed little-endian result. Route: a bigint-or-record union narrowed by typeof. Node prints bigints-int64-typeof-union-values:ok.
type View = number[];
function check(input: bigint | { value: bigint }, expected: bigint, expectedBytes: readonly number[]): void {
  const view: View = localDataView(localArrayBuffer(8));
  if (typeof input === "bigint") localSetBigInt64(view, 0, input, true); else localSetBigInt64(view, 0, input.value, true);
  const bytes: number[] = []; for (let i = 0; i < 8; i++) bytes[i] = localGetUint8(view, i);
  assert.compareArray(bytes, expectedBytes); assert.sameValue(localGetBigInt64(view, 0, true), expected);
}
const rows: readonly [bigint, bigint, readonly number[]][] = [
  [-0x8000000000000001n, 0x7fffffffffffffffn, [255, 255, 255, 255, 255, 255, 255, 127]],
  [0x8000000000000001n, -0x7fffffffffffffffn, [1, 0, 0, 0, 0, 0, 0, 128]],
  [0x123456789abcdefn, 0x123456789abcdefn, [239, 205, 171, 137, 103, 69, 35, 1]],
  [-0x10000000000000001n, -0x1n, [255, 255, 255, 255, 255, 255, 255, 255]]
];
for (const [value, expected, bytes] of rows) { check(value, expected, bytes); check({ value }, expected, bytes); }
console.log("bigints-int64-typeof-union-values:ok");
