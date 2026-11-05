/*---
description: "BigInt64 offsets beyond the last fitting word throw RangeError and leave all bytes intact while the last fitting read succeeds. (control)"
features: [ts-dataview-routes, ts-dataview-route-bigints, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-bigint, ts-type-aliases, ts-map-set, ts-strings, ts-narrowing, ts-readonly, ts-errors, ts-arrow-functions]
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
function localGetBigInt64(bytes: number[], offset: number, little = false): bigint { return localBigGet(bytes, offset, true, little); }
function localSetBigInt64(bytes: number[], offset: number, value: bigint, little = false): void { localBigSet(bytes, offset, value, little); }
function localGetUint8(bytes: number[], offset: number): number { return bytes[offset]; }
// BigInt64 offsets beyond the last fitting word throw RangeError and leave all bytes intact while the last fitting read succeeds. Route: a View obtained through guarded Map.get. Node prints bigints-int64-map-nonfitting-offsets:ok.
type View = number[];
const initial: View = localDataView(localArrayBuffer(12)), seed: readonly number[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
for (let i = 0; i < 12; i++) localSetUint8(initial, i, seed[i]);
const views: Map<string, View> = new Map([["wide", initial]]), offsets: readonly number[] = [5, 5.9, 8, 12, Infinity];
for (const offset of offsets) {
  const view = views.get("wide"); if (view === undefined) throw new Error("missing view");
  assert.throws(RangeError, () => localGetBigInt64(view, offset, false));
  assert.throws(RangeError, () => localSetBigInt64(view, offset, -0x1234n, false));
  const bytes: number[] = []; for (let i = 0; i < 12; i++) bytes[i] = localGetUint8(view, i);
  assert.compareArray(bytes, seed); assert.sameValue(localGetBigInt64(view, 4, false), 0x05060708090a0b0cn);
}
console.log("bigints-int64-map-nonfitting-offsets:ok");
