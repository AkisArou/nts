/*---
description: "Int8 sign-extends and Uint8 zero-extends the same independently seeded bytes without changing their contents. (control)"
features: [ts-dataview-routes, ts-dataview-route-integers, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-type-aliases, ts-class, ts-interfaces, ts-readonly, ts-tuples, ts-destructuring]
---*/

function localArrayBuffer(size: number): number[] { const bytes: number[] = []; for (let i = 0; i < size; i++) bytes[i] = 0; return bytes; }
function localDataView(bytes: number[]): number[] { return bytes; }
function localGet(bytes: number[], offset: number, width: number, signed: boolean, little = false): number {
  offset -= offset % 1; let value = 0; for (let i = 0; i < width; i++) value = value * 256 + bytes[offset + (little ? width - 1 - i : i)];
  return signed && value >= 256 ** width / 2 ? value - 256 ** width : value;
}
function localSet(bytes: number[], offset: number, value: number, width: number, little = false): void {
  offset -= offset % 1; const modulus = 256 ** width; if (value !== value || value === Infinity || value === -Infinity) value = 0;
  value -= value % 1; value = (value % modulus + modulus) % modulus;
  for (let i = 0; i < width; i++) { bytes[offset + (little ? i : width - 1 - i)] = value % 256; value = (value - value % 256) / 256; }
}
function localGetInt8(bytes: number[], offset: number): number { return localGet(bytes, offset, 1, true); }
function localGetUint8(bytes: number[], offset: number): number { return localGet(bytes, offset, 1, false); }
function localSetUint8(bytes: number[], offset: number, value: number): void { localSet(bytes, offset, value, 1); }
// Int8 sign-extends and Uint8 zero-extends the same independently seeded bytes without changing their contents. Route: an interface with signed and unsigned reader implementations. Node prints integers-int8-interface-seeded-signedness:ok.
type View = number[];
interface ByteReader { read(view: View, offset: number): number; }
class SignedByte implements ByteReader { read(view: View, offset: number): number { return localGetInt8(view, offset); } }
class UnsignedByte implements ByteReader { read(view: View, offset: number): number { return localGetUint8(view, offset); } }
const seed: readonly number[] = [0, 1, 127, 128, 254, 255], view: View = localDataView(localArrayBuffer(6));
for (let i = 0; i < seed.length; i++) localSetUint8(view, i, seed[i]);
const routes: readonly [ByteReader, readonly number[]][] = [
  [new SignedByte(), [0, 1, 127, -128, -2, -1]], [new UnsignedByte(), [0, 1, 127, 128, 254, 255]]
];
for (const [route, expected] of routes) {
  const actual: number[] = []; for (let i = 0; i < seed.length; i++) actual[i] = route.read(view, i);
  assert.compareArray(actual, expected);
}
const bytes: number[] = []; for (let i = 0; i < 6; i++) bytes[i] = localGetUint8(view, i);
assert.compareArray(bytes, [0, 1, 127, 128, 254, 255]);
console.log("integers-int8-interface-seeded-signedness:ok");
