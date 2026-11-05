/*---
description: "Uint16 fractional offsets truncate before big-endian access and leave bytes outside each fitting word untouched. (control)"
features: [ts-dataview-routes, ts-dataview-route-integers, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-type-aliases, ts-class, ts-class-fields, ts-this, ts-readonly, ts-tuples, ts-destructuring]
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
function localGetUint8(bytes: number[], offset: number): number { return localGet(bytes, offset, 1, false); }
function localGetUint16(bytes: number[], offset: number, little = false): number { return localGet(bytes, offset, 2, false, little); }
// Uint16 fractional offsets truncate before big-endian access and leave bytes outside each fitting word untouched. Route: public View and offset fields. Node prints integers-uint16-public-fractional-offsets:ok.
type View = number[];
class WordSlot {
  view: View = localDataView(localArrayBuffer(6)); offset: number;
  constructor(offset: number) { this.offset = offset; }
}
const rows: readonly [number, number, readonly number[]][] = [
  [-0.9, 4660, [18, 52, 0, 0, 0, 0]], [1.9, 33023, [0, 128, 255, 0, 0, 0]],
  [2.9, 65535, [0, 0, 255, 255, 0, 0]], [4.9, 258, [0, 0, 0, 0, 1, 2]]
];
for (const [offset, value, expectedBytes] of rows) {
  const slot = new WordSlot(offset); localSetUint16(slot.view, slot.offset, value, false);
  const bytes: number[] = []; for (let i = 0; i < 6; i++) bytes[i] = localGetUint8(slot.view, i);
  assert.compareArray(bytes, expectedBytes); assert.sameValue(localGetUint16(slot.view, slot.offset, false), value);
}
console.log("integers-uint16-public-fractional-offsets:ok");
