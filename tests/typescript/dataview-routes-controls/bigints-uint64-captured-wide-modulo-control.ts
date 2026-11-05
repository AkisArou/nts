/*---
description: "BigUint64 keeps exact low sixty-four bits of changing very wide positive and negative values in little-endian storage. (control)"
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
function localSetBigUint64(bytes: number[], offset: number, value: bigint, little = false): void { localBigSet(bytes, offset, value, little); }
function localGetBigUint64(bytes: number[], offset: number, little = false): bigint { return localBigGet(bytes, offset, false, little); }
function localSetUint8(bytes: number[], offset: number, value: number): void { bytes[offset] = value; }
function localGetUint8(bytes: number[], offset: number): number { return bytes[offset]; }
// BigUint64 keeps exact low sixty-four bits of changing very wide positive and negative values in little-endian storage. Route: a bigint let captured by typed writer and reader closures. Node prints bigints-uint64-captured-wide-modulo:ok.
type View = number[];
const view: View = localDataView(localArrayBuffer(8)); let value = 0n;
const write: () => void = () => { localSetBigUint64(view, 0, value, true); };
const read: () => bigint = () => localGetBigUint64(view, 0, true);
const rows: readonly [bigint, bigint, readonly number[]][] = [
  [0x400000000000000000123456789abcdefn, 0x123456789abcdefn, [239, 205, 171, 137, 103, 69, 35, 1]],
  [-0x400000000000000000123456789abcdefn, 0xfedcba9876543211n, [17, 50, 84, 118, 152, 186, 220, 254]],
  [0x400000000000000008000000000000001n, 0x8000000000000001n, [1, 0, 0, 0, 0, 0, 0, 128]],
  [-0x400000000000000000000000000000000n, 0x0n, [0, 0, 0, 0, 0, 0, 0, 0]],
  [-0x400000000000000000000000000000001n, 0xffffffffffffffffn, [255, 255, 255, 255, 255, 255, 255, 255]]
];
for (const [next, expected, expectedBytes] of rows) {
  value = next; for (let i = 0; i < 8; i++) localSetUint8(view, i, 165); write();
  const bytes: number[] = []; for (let i = 0; i < 8; i++) bytes[i] = localGetUint8(view, i);
  assert.compareArray(bytes, expectedBytes); assert.sameValue(read(), expected);
}
console.log("bigints-uint64-captured-wide-modulo:ok");
