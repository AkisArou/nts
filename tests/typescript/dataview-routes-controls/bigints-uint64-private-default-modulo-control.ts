/*---
description: "BigUint64 uses big endian by default, preserves the top bit and reduces negative or oversized values modulo two to the sixty-fourth. (control)"
features: [ts-dataview-routes, ts-dataview-route-bigints, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-bigint, ts-type-aliases, ts-class, ts-class-fields, ts-private-fields, ts-this, ts-readonly, ts-tuples, ts-destructuring]
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
function localGetBigUint64(bytes: number[], offset: number, little = false): bigint { return localBigGet(bytes, offset, false, little); }
function localGetUint8(bytes: number[], offset: number): number { return bytes[offset]; }
// BigUint64 uses big endian by default, preserves the top bit and reduces negative or oversized values modulo two to the sixty-fourth. Route: a private View field. Node prints bigints-uint64-private-default-modulo:ok.
type View = number[];
class WideSlot {
  #view: View = localDataView(localArrayBuffer(8));
  constructor() { for (let i = 0; i < 8; i++) localSetUint8(this.#view, i, 165); }
  write(value: bigint): void { localSetBigUint64(this.#view, 0, value); }
  read(): bigint { return localGetBigUint64(this.#view, 0); }
  bytes(): number[] { const bytes: number[] = []; for (let i = 0; i < 8; i++) bytes[i] = localGetUint8(this.#view, i); return bytes; }
}
const rows: readonly [bigint, bigint, readonly number[]][] = [
  [-0x10000000000000001n, 0xffffffffffffffffn, [255, 255, 255, 255, 255, 255, 255, 255]],
  [-0x8000000000000001n, 0x7fffffffffffffffn, [127, 255, 255, 255, 255, 255, 255, 255]],
  [-0x1n, 0xffffffffffffffffn, [255, 255, 255, 255, 255, 255, 255, 255]],
  [0x0n, 0x0n, [0, 0, 0, 0, 0, 0, 0, 0]],
  [0x7fffffffffffffffn, 0x7fffffffffffffffn, [127, 255, 255, 255, 255, 255, 255, 255]],
  [0x8000000000000000n, 0x8000000000000000n, [128, 0, 0, 0, 0, 0, 0, 0]],
  [0x8000000000000001n, 0x8000000000000001n, [128, 0, 0, 0, 0, 0, 0, 1]],
  [0xffffffffffffffffn, 0xffffffffffffffffn, [255, 255, 255, 255, 255, 255, 255, 255]],
  [0x10000000000000000n, 0x0n, [0, 0, 0, 0, 0, 0, 0, 0]],
  [0x10000000000000001n, 0x1n, [0, 0, 0, 0, 0, 0, 0, 1]]
];
for (const [value, expected, expectedBytes] of rows) {
  const slot = new WideSlot(); slot.write(value); assert.sameValue(slot.read(), expected); assert.compareArray(slot.bytes(), expectedBytes);
}
console.log("bigints-uint64-private-default-modulo:ok");
