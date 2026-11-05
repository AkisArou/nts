/*---
description: "BigUint64 interprets asymmetric raw bytes under both byte orders without losing the high bits or changing storage. (control)"
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
function localSetUint8(bytes: number[], offset: number, value: number): void { bytes[offset] = value; }
function localGetBigUint64(bytes: number[], offset: number, little = false): bigint { return localBigGet(bytes, offset, false, little); }
function localGetUint8(bytes: number[], offset: number): number { return bytes[offset]; }
// BigUint64 interprets asymmetric raw bytes under both byte orders without losing the high bits or changing storage. Route: a private View populated from a constructor parameter. Node prints bigints-uint64-private-seeded-endian:ok.
type View = number[];
class WideSlot {
  #view: View = localDataView(localArrayBuffer(8));
  constructor(seed: readonly number[]) { for (let i = 0; i < 8; i++) localSetUint8(this.#view, i, seed[i]); }
  read(little: boolean): bigint { return localGetBigUint64(this.#view, 0, little); }
  bytes(): number[] { const bytes: number[] = []; for (let i = 0; i < 8; i++) bytes[i] = localGetUint8(this.#view, i); return bytes; }
}
const rows: readonly [readonly number[], readonly bigint[]][] = [
  [[1, 35, 69, 103, 137, 171, 205, 239], [0x123456789abcdefn, 0xefcdab8967452301n]],
  [[137, 171, 205, 239, 1, 35, 69, 103], [0x89abcdef01234567n, 0x67452301efcdab89n]],
  [[128, 0, 0, 0, 0, 0, 0, 1], [0x8000000000000001n, 0x100000000000080n]],
  [[255, 255, 255, 255, 255, 255, 255, 254], [0xfffffffffffffffen, 0xfeffffffffffffffn]]
];
for (const [seed, expected] of rows) {
  const slot = new WideSlot(seed), actual: bigint[] = [slot.read(false), slot.read(true)];
  assert.compareArray(actual, expected); assert.compareArray(slot.bytes(), seed);
}
console.log("bigints-uint64-private-seeded-endian:ok");
