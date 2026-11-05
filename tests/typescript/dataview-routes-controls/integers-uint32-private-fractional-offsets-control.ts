/*---
description: "Uint32 access truncates private fractional offsets before little-endian reads and writes and preserves neighboring bytes. (control)"
features: [ts-dataview-routes, ts-dataview-route-integers, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-type-aliases, ts-class, ts-class-fields, ts-private-fields, ts-this, ts-readonly, ts-tuples, ts-destructuring]
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
function localSetUint32(bytes: number[], offset: number, value: number, little = false): void { localSet(bytes, offset, value, 4, little); }
function localGetUint32(bytes: number[], offset: number, little = false): number { return localGet(bytes, offset, 4, false, little); }
function localGetUint8(bytes: number[], offset: number): number { return localGet(bytes, offset, 1, false); }
// Uint32 access truncates private fractional offsets before little-endian reads and writes and preserves neighboring bytes. Route: private offset and View fields. Node prints integers-uint32-private-fractional-offsets:ok.
type View = number[];
class WordSlot {
  #view: View = localDataView(localArrayBuffer(8)); #offset: number;
  constructor(offset: number) { this.#offset = offset; }
  write(value: number): void { localSetUint32(this.#view, this.#offset, value, true); }
  read(): number { return localGetUint32(this.#view, this.#offset, true); }
  bytes(): number[] { const result: number[] = []; for (let i = 0; i < 8; i++) result[i] = localGetUint8(this.#view, i); return result; }
}
const rows: readonly [number, number, readonly number[]][] = [
  [-0.9, 305419896, [120, 86, 52, 18, 0, 0, 0, 0]],
  [1.9, 2147483649, [0, 1, 0, 0, 128, 0, 0, 0]],
  [4.9, 4294967294, [0, 0, 0, 0, 254, 255, 255, 255]]
];
for (const [offset, value, expectedBytes] of rows) {
  const slot = new WordSlot(offset); slot.write(value);
  assert.sameValue(slot.read(), value); assert.compareArray(slot.bytes(), expectedBytes);
}
console.log("integers-uint32-private-fractional-offsets:ok");
