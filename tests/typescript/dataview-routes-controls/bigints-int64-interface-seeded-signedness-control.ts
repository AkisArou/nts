/*---
description: "The top bit distinguishes default BigInt64 and BigUint64 reads of independently seeded bytes while every byte stays unchanged. (control)"
features: [ts-dataview-routes, ts-dataview-route-bigints, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-bigint, ts-type-aliases, ts-class, ts-interfaces, ts-readonly, ts-tuples, ts-destructuring]
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
function localGetBigInt64(bytes: number[], offset: number, little = false): bigint { return localBigGet(bytes, offset, true, little); }
function localGetBigUint64(bytes: number[], offset: number, little = false): bigint { return localBigGet(bytes, offset, false, little); }
function localSetUint8(bytes: number[], offset: number, value: number): void { bytes[offset] = value; }
function localGetUint8(bytes: number[], offset: number): number { return bytes[offset]; }
// The top bit distinguishes default BigInt64 and BigUint64 reads of independently seeded bytes while every byte stays unchanged. Route: an interface with signed and unsigned reader implementations. Node prints bigints-int64-interface-seeded-signedness:ok.
type View = number[];
interface WideReader { read(view: View): bigint; }
class SignedWide implements WideReader { read(view: View): bigint { return localGetBigInt64(view, 0); } }
class UnsignedWide implements WideReader { read(view: View): bigint { return localGetBigUint64(view, 0); } }
const routes: readonly WideReader[] = [new SignedWide(), new UnsignedWide()];
const rows: readonly [readonly number[], readonly bigint[]][] = [
  [[0, 0, 0, 0, 0, 0, 0, 0], [0x0n, 0x0n]],
  [[0, 0, 0, 0, 0, 0, 0, 1], [0x1n, 0x1n]],
  [[127, 255, 255, 255, 255, 255, 255, 255], [0x7fffffffffffffffn, 0x7fffffffffffffffn]],
  [[128, 0, 0, 0, 0, 0, 0, 0], [-0x8000000000000000n, 0x8000000000000000n]],
  [[128, 0, 0, 0, 0, 0, 0, 1], [-0x7fffffffffffffffn, 0x8000000000000001n]],
  [[255, 255, 255, 255, 255, 255, 255, 255], [-0x1n, 0xffffffffffffffffn]]
];
for (const [seed, expected] of rows) {
  const view: View = localDataView(localArrayBuffer(8)); for (let i = 0; i < 8; i++) localSetUint8(view, i, seed[i]);
  const actual: bigint[] = []; for (let i = 0; i < routes.length; i++) actual[i] = routes[i].read(view);
  assert.compareArray(actual, expected);
  const bytes: number[] = []; for (let i = 0; i < 8; i++) bytes[i] = localGetUint8(view, i); assert.compareArray(bytes, seed);
}
console.log("bigints-int64-interface-seeded-signedness:ok");
