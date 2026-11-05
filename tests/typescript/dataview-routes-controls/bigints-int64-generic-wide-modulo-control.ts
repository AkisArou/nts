/*---
description: "BigInt64 discards distant high limbs while preserving every low bit and the resulting signed value. (control)"
features: [ts-dataview-routes, ts-dataview-route-bigints, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-bigint, ts-type-aliases, ts-generics, ts-generic-constraints, ts-unions, ts-objects, ts-typeof-operator, ts-narrowing, ts-readonly, ts-tuples, ts-destructuring]
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
function localSetUint8(bytes: number[], offset: number, value: number): void { bytes[offset] = value; }
function localSetBigInt64(bytes: number[], offset: number, value: bigint, little = false): void { localBigSet(bytes, offset, value, little); }
function localGetUint8(bytes: number[], offset: number): number { return bytes[offset]; }
function localGetBigInt64(bytes: number[], offset: number, little = false): bigint { return localBigGet(bytes, offset, true, little); }
// BigInt64 discards distant high limbs while preserving every low bit and the resulting signed value. Route: a constrained helper at bigint and bigint-record type arguments. Node prints bigints-int64-generic-wide-modulo:ok.
type View = number[];
function check<T extends bigint | { value: bigint }>(input: T, expected: bigint, expectedBytes: readonly number[]): void {
  const value = typeof input === "bigint" ? input : input.value, view: View = localDataView(localArrayBuffer(8));
  for (let i = 0; i < 8; i++) localSetUint8(view, i, 165); localSetBigInt64(view, 0, value, false);
  const bytes: number[] = []; for (let i = 0; i < 8; i++) bytes[i] = localGetUint8(view, i);
  assert.compareArray(bytes, expectedBytes); assert.sameValue(localGetBigInt64(view, 0, false), expected);
}
const rows: readonly [bigint, bigint, readonly number[]][] = [
  [0x400000000000000000123456789abcdefn, 0x123456789abcdefn, [1, 35, 69, 103, 137, 171, 205, 239]],
  [-0x400000000000000000123456789abcdefn, -0x123456789abcdefn, [254, 220, 186, 152, 118, 84, 50, 17]],
  [0x400000000000000008000000000000001n, -0x7fffffffffffffffn, [128, 0, 0, 0, 0, 0, 0, 1]],
  [-0x400000000000000000000000000000000n, 0x0n, [0, 0, 0, 0, 0, 0, 0, 0]],
  [-0x400000000000000000000000000000001n, -0x1n, [255, 255, 255, 255, 255, 255, 255, 255]]
];
for (const [value, expected, bytes] of rows) { check<bigint>(value, expected, bytes); check<{ value: bigint }>({ value }, expected, bytes); }
console.log("bigints-int64-generic-wide-modulo:ok");
