/*---
description: "BigInt64 truncates captured fractional offsets at the first, middle and last fitting positions while writing exact big-endian bytes. (control)"
features: [ts-dataview-routes, ts-dataview-route-bigints, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-bigint, ts-type-aliases, ts-closures, ts-arrow-functions, ts-readonly, ts-tuples, ts-destructuring]
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
function localGetBigInt64(bytes: number[], offset: number, little = false): bigint { return localBigGet(bytes, offset, true, little); }
function localSetUint8(bytes: number[], offset: number, value: number): void { bytes[offset] = value; }
function localGetUint8(bytes: number[], offset: number): number { return bytes[offset]; }
// BigInt64 truncates captured fractional offsets at the first, middle and last fitting positions while writing exact big-endian bytes. Route: reassigned offset and bigint lets captured by reader and writer closures. Node prints bigints-int64-captured-fractional-offsets:ok.
type View = number[];
const view: View = localDataView(localArrayBuffer(12)); let offset = 0, value = 0n;
const write: () => void = () => { localSetBigInt64(view, offset, value, false); };
const read: () => bigint = () => localGetBigInt64(view, offset, false);
const rows: readonly [number, bigint, readonly number[]][] = [
  [-0.9, 0x0123456789abcdefn, [1, 35, 69, 103, 137, 171, 205, 239, 0, 0, 0, 0]],
  [1.9, -0x8000000000000000n, [0, 128, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]],
  [4.9, -2n, [0, 0, 0, 0, 255, 255, 255, 255, 255, 255, 255, 254]]
];
for (const [nextOffset, nextValue, expectedBytes] of rows) {
  offset = nextOffset; value = nextValue; for (let i = 0; i < 12; i++) localSetUint8(view, i, 0);
  write(); const bytes: number[] = []; for (let i = 0; i < 12; i++) bytes[i] = localGetUint8(view, i);
  assert.compareArray(bytes, expectedBytes); assert.sameValue(read(), value);
}
console.log("bigints-int64-captured-fractional-offsets:ok");
