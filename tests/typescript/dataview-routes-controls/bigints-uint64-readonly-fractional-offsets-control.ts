/*---
description: "BigUint64 truncates fractional offsets before little-endian access and preserves bytes outside the selected eight-byte word. (control)"
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
// BigUint64 truncates fractional offsets before little-endian access and preserves bytes outside the selected eight-byte word. Route: readonly offset and bigint tuples. Node prints bigints-uint64-readonly-fractional-offsets:ok.
type View = number[];
const rows: readonly [number, bigint, readonly number[]][] = [
  [-0.9, 0x0123456789abcdefn, [239, 205, 171, 137, 103, 69, 35, 1, 0, 0, 0, 0]],
  [1.9, 0x8000000000000001n, [0, 1, 0, 0, 0, 0, 0, 0, 128, 0, 0, 0]],
  [4.9, 0xfffffffffffffffen, [0, 0, 0, 0, 254, 255, 255, 255, 255, 255, 255, 255]]
];
for (const [offset, value, expectedBytes] of rows) {
  const view: View = localDataView(localArrayBuffer(12)); localSetBigUint64(view, offset, value, true);
  const bytes: number[] = []; for (let i = 0; i < 12; i++) bytes[i] = localGetUint8(view, i);
  assert.compareArray(bytes, expectedBytes); assert.sameValue(localGetBigUint64(view, offset, true), value);
}
console.log("bigints-uint64-readonly-fractional-offsets:ok");
