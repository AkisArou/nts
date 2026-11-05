/*---
description: "Uint32 access truncates private fractional offsets before little-endian reads and writes and preserves neighboring bytes."
features: [ts-dataview-routes, ts-dataview-route-integers, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-type-aliases, ts-class, ts-class-fields, ts-private-fields, ts-this, ts-readonly, ts-tuples, ts-destructuring]
---*/

// Uint32 access truncates private fractional offsets before little-endian reads and writes and preserves neighboring bytes. Route: private offset and View fields. Node prints integers-uint32-private-fractional-offsets:ok.
type View = DataView;
class WordSlot {
  #view: View = new DataView(new ArrayBuffer(8)); #offset: number;
  constructor(offset: number) { this.#offset = offset; }
  write(value: number): void { this.#view.setUint32(this.#offset, value, true); }
  read(): number { return this.#view.getUint32(this.#offset, true); }
  bytes(): number[] { const result: number[] = []; for (let i = 0; i < 8; i++) result[i] = this.#view.getUint8(i); return result; }
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
