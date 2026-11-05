/*---
description: "Int16 explicit false and true byte orders preserve wrapped signed values and produce independently specified bytes. (control)"
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
function localSetInt16(bytes: number[], offset: number, value: number, little = false): void { localSet(bytes, offset, value, 2, little); }
function localGetInt16(bytes: number[], offset: number, little = false): number { return localGet(bytes, offset, 2, true, little); }
function localGetUint8(bytes: number[], offset: number): number { return localGet(bytes, offset, 1, false); }
// Int16 explicit false and true byte orders preserve wrapped signed values and produce independently specified bytes. Route: private View and byte-order fields. Node prints integers-int16-private-endian:ok.
type View = number[];
class WordSlot {
  #view: View = localDataView(localArrayBuffer(2)); #little: boolean;
  constructor(little: boolean) { this.#little = little; }
  write(value: number): void { localSetInt16(this.#view, 0, value, this.#little); }
  read(): number { return localGetInt16(this.#view, 0, this.#little); }
  bytes(): number[] { const result: number[] = []; for (let i = 0; i < 2; i++) result[i] = localGetUint8(this.#view, i); return result; }
}
const rows: readonly [number, number, readonly number[], readonly number[]][] = [
  [4660, 4660, [18, 52], [52, 18]], [-4660, -4660, [237, 204], [204, 237]],
  [-32769, 32767, [127, 255], [255, 127]], [32768, -32768, [128, 0], [0, 128]]
];
const orders: readonly boolean[] = [false, true];
for (const [value, expected, big, little] of rows) for (const order of orders) {
  const slot = new WordSlot(order); slot.write(value);
  assert.sameValue(slot.read(), expected); assert.compareArray(slot.bytes(), order ? little : big);
}
console.log("integers-int16-private-endian:ok");
