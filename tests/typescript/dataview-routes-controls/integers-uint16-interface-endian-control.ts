/*---
description: "Uint16 explicit byte orders produce different bytes for asymmetric and wrapped values through both implementations. (control)"
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
function localSetUint16(bytes: number[], offset: number, value: number, little = false): void { localSet(bytes, offset, value, 2, little); }
function localGetUint16(bytes: number[], offset: number, little = false): number { return localGet(bytes, offset, 2, false, little); }
function localGetUint8(bytes: number[], offset: number): number { return localGet(bytes, offset, 1, false); }
// Uint16 explicit byte orders produce different bytes for asymmetric and wrapped values through both implementations. Route: an interface with big-endian and little-endian implementations. Node prints integers-uint16-interface-endian:ok.
type View = number[];
interface WordAccess { write(view: View, value: number): void; read(view: View): number; }
class BigWord implements WordAccess {
  write(view: View, value: number): void { localSetUint16(view, 0, value, false); }
  read(view: View): number { return localGetUint16(view, 0, false); }
}
class LittleWord implements WordAccess {
  write(view: View, value: number): void { localSetUint16(view, 0, value, true); }
  read(view: View): number { return localGetUint16(view, 0, true); }
}
const routes: readonly [WordAccess, boolean][] = [[new BigWord(), false], [new LittleWord(), true]];
const rows: readonly [number, number, readonly number[], readonly number[]][] = [
  [4660, 4660, [18, 52], [52, 18]], [33023, 33023, [128, 255], [255, 128]],
  [65537, 1, [0, 1], [1, 0]], [-2, 65534, [255, 254], [254, 255]]
];
for (const [route, order] of routes) for (const [value, expected, big, little] of rows) {
  const view: View = localDataView(localArrayBuffer(2)); route.write(view, value);
  const bytes: number[] = []; for (let i = 0; i < 2; i++) bytes[i] = localGetUint8(view, i);
  assert.compareArray(bytes, order ? little : big); assert.sameValue(route.read(view), expected);
}
console.log("integers-uint16-interface-endian:ok");
