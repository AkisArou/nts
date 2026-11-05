/*---
description: "Uint8 fractional offsets select the truncated first, middle and last byte and preserve every neighbor. (control)"
features: [ts-dataview-routes, ts-dataview-route-integers, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-type-aliases, ts-map-set, ts-strings, ts-narrowing, ts-errors, ts-readonly, ts-tuples, ts-destructuring]
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
function localSetUint8(bytes: number[], offset: number, value: number): void { localSet(bytes, offset, value, 1); }
function localGetUint8(bytes: number[], offset: number): number { return localGet(bytes, offset, 1, false); }
// Uint8 fractional offsets select the truncated first, middle and last byte and preserve every neighbor. Route: numeric offsets read through guarded Map.get. Node prints integers-uint8-map-fractional-offsets:ok.
type View = number[];
const offsets: Map<string, number> = new Map([["first", -0.9], ["middle", 1.9], ["last", 3.9]]);
const rows: readonly [string, number, readonly number[]][] = [
  ["first", 255, [255, 0, 0, 0]], ["middle", 128, [0, 128, 0, 0]], ["last", 17, [0, 0, 0, 17]]
];
for (const [key, value, expectedBytes] of rows) {
  const offset = offsets.get(key); if (offset === undefined) throw new Error("missing offset");
  const view: View = localDataView(localArrayBuffer(4)); localSetUint8(view, offset, value);
  const bytes: number[] = []; for (let i = 0; i < 4; i++) bytes[i] = localGetUint8(view, i);
  assert.compareArray(bytes, expectedBytes); assert.sameValue(localGetUint8(view, offset), value);
}
console.log("integers-uint8-map-fractional-offsets:ok");
