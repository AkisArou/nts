/*---
description: "Overlapping BigUint64 writes replace exactly eight bytes in each requested byte order and preserve all remaining bytes. (control)"
features: [ts-dataview-routes, ts-dataview-route-bigints, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-bigint, ts-type-aliases, ts-readonly, ts-tuples, ts-destructuring]
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
function localSetBigUint64(bytes: number[], offset: number, value: bigint, little = false): void { localBigSet(bytes, offset, value, little); }
function localGetUint8(bytes: number[], offset: number): number { return bytes[offset]; }
function localGetBigUint64(bytes: number[], offset: number, little = false): bigint { return localBigGet(bytes, offset, false, little); }
// Overlapping BigUint64 writes replace exactly eight bytes in each requested byte order and preserve all remaining bytes. Route: readonly offset, bigint and byte-order tuples. Node prints bigints-uint64-tuple-overlapping-writes:ok.
type View = number[];
const view: View = localDataView(localArrayBuffer(16));
const rows: readonly [number, bigint, boolean, readonly number[]][] = [
  [0, 0x0123456789abcdefn, false, [1, 35, 69, 103, 137, 171, 205, 239, 0, 0, 0, 0, 0, 0, 0, 0]],
  [4, 0xfedcba9876543210n, true, [1, 35, 69, 103, 16, 50, 84, 118, 152, 186, 220, 254, 0, 0, 0, 0]],
  [8, 1n, false, [1, 35, 69, 103, 16, 50, 84, 118, 0, 0, 0, 0, 0, 0, 0, 1]]
];
for (const [offset, value, little, expectedBytes] of rows) {
  localSetBigUint64(view, offset, value, little);
  const bytes: number[] = []; for (let i = 0; i < 16; i++) bytes[i] = localGetUint8(view, i);
  assert.compareArray(bytes, expectedBytes); assert.sameValue(localGetBigUint64(view, offset, little), value);
}
console.log("bigints-uint64-tuple-overlapping-writes:ok");
