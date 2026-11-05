/*---
description: "A failed BigInt64 write changes no bytes in either byte order, while a valid write changes exactly the final fitting word. (control)"
features: [ts-dataview-routes, ts-dataview-route-bigints, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-bigint, ts-type-aliases, ts-class, ts-interfaces, ts-readonly, ts-tuples, ts-destructuring, ts-errors, ts-arrow-functions]
---*/

function localArrayBuffer(size: number): number[] { const bytes: number[] = []; for (let i = 0; i < size; i++) bytes[i] = 0; return bytes; }
function localDataView(bytes: number[]): number[] { return bytes; }
function localIndex(bytes: number[], offset: number): number {
  if (offset === Infinity || offset === -Infinity) throw new RangeError(); offset = offset !== offset ? 0 : offset - offset % 1;
  if (offset < 0 || offset + 8 > bytes.length) throw new RangeError(); return offset;
}
function localBigSet(bytes: number[], offset: number, value: bigint, little = false): void {
  offset = localIndex(bytes, offset); const modulus = 0x10000000000000000n; value = (value % modulus + modulus) % modulus;
  for (let i = 0; i < 8; i++) { bytes[offset + (little ? i : 7 - i)] = Number(value % 256n); value /= 256n; }
}
function localSetBigInt64(bytes: number[], offset: number, value: bigint, little = false): void { localBigSet(bytes, offset, value, little); }
function localSetUint8(bytes: number[], offset: number, value: number): void { bytes[offset] = value; }
function localGetUint8(bytes: number[], offset: number): number { return bytes[offset]; }
// A failed BigInt64 write changes no bytes in either byte order, while a valid write changes exactly the final fitting word. Route: an interface with big-endian and little-endian writer implementations. Node prints bigints-int64-interface-failed-write-atomic:ok.
type View = number[];
interface WideWriter { write(view: View, offset: number, value: bigint): void; }
class BigWide implements WideWriter { write(view: View, offset: number, value: bigint): void { localSetBigInt64(view, offset, value, false); } }
class LittleWide implements WideWriter { write(view: View, offset: number, value: bigint): void { localSetBigInt64(view, offset, value, true); } }
const routes: readonly [WideWriter, readonly number[]][] = [
  [new BigWide(), [1, 2, 3, 4, 1, 35, 69, 103, 137, 171, 205, 239]],
  [new LittleWide(), [1, 2, 3, 4, 239, 205, 171, 137, 103, 69, 35, 1]]
];
const seed: readonly number[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
for (const [route, expected] of routes) {
  const view: View = localDataView(localArrayBuffer(12)); for (let i = 0; i < 12; i++) localSetUint8(view, i, seed[i]);
  for (const offset of [-1, 5, 12]) {
    assert.throws(RangeError, () => route.write(view, offset, 0x0123456789abcdefn));
    const bytes: number[] = []; for (let i = 0; i < 12; i++) bytes[i] = localGetUint8(view, i); assert.compareArray(bytes, seed);
  }
  route.write(view, 4, 0x0123456789abcdefn);
  const finalBytes: number[] = []; for (let j = 0; j < 12; j++) finalBytes[j] = localGetUint8(view, j); assert.compareArray(finalBytes, expected);
}
console.log("bigints-int64-interface-failed-write-atomic:ok");
