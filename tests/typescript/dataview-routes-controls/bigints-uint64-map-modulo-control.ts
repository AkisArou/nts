/*---
description: "BigUint64 reduces positive and negative multiples of sixty-four bits in little-endian storage and preserves all low bits. (control)"
features: [ts-dataview-routes, ts-dataview-route-bigints, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-bigint, ts-type-aliases, ts-map-set, ts-strings, ts-narrowing, ts-errors, ts-readonly, ts-tuples, ts-destructuring]
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
function localSetBigUint64(bytes: number[], offset: number, value: bigint, little = false): void { localBigSet(bytes, offset, value, little); }
function localGetUint8(bytes: number[], offset: number): number { return bytes[offset]; }
function localGetBigUint64(bytes: number[], offset: number, little = false): bigint { return localBigGet(bytes, offset, false, little); }
// BigUint64 reduces positive and negative multiples of sixty-four bits in little-endian storage and preserves all low bits. Route: a View obtained through guarded Map.get. Node prints bigints-uint64-map-modulo:ok.
type View = number[];
const views: Map<string, View> = new Map([["wide", localDataView(localArrayBuffer(8))]]);
const rows: readonly [bigint, bigint, readonly number[]][] = [
  [-0x10000000000000001n, 0xffffffffffffffffn, [255, 255, 255, 255, 255, 255, 255, 255]],
  [-0x10000000000000000n, 0x0n, [0, 0, 0, 0, 0, 0, 0, 0]],
  [-0xffffffffffffffffn, 0x1n, [1, 0, 0, 0, 0, 0, 0, 0]],
  [0xffffffffffffffffn, 0xffffffffffffffffn, [255, 255, 255, 255, 255, 255, 255, 255]],
  [0x10000000000000000n, 0x0n, [0, 0, 0, 0, 0, 0, 0, 0]],
  [0x10000000000000001n, 0x1n, [1, 0, 0, 0, 0, 0, 0, 0]],
  [0x20000000000001234n, 0x1234n, [52, 18, 0, 0, 0, 0, 0, 0]],
  [-0x20000000000000002n, 0xfffffffffffffffen, [254, 255, 255, 255, 255, 255, 255, 255]]
];
for (const [value, expected, expectedBytes] of rows) {
  const view = views.get("wide"); if (view === undefined) throw new Error("missing view");
  for (let i = 0; i < 8; i++) localSetUint8(view, i, 165); localSetBigUint64(view, 0, value, true);
  const bytes: number[] = []; for (let i = 0; i < 8; i++) bytes[i] = localGetUint8(view, i);
  assert.compareArray(bytes, expectedBytes); assert.sameValue(localGetBigUint64(view, 0, true), expected);
}
console.log("bigints-uint64-map-modulo:ok");
