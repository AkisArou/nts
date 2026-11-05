/*---
description: "Uint16 fractional offsets truncate before big-endian access and leave bytes outside each fitting word untouched."
features: [ts-dataview-routes, ts-dataview-route-integers, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-type-aliases, ts-class, ts-class-fields, ts-this, ts-readonly, ts-tuples, ts-destructuring]
---*/

// Uint16 fractional offsets truncate before big-endian access and leave bytes outside each fitting word untouched. Route: public View and offset fields. Node prints integers-uint16-public-fractional-offsets:ok.
type View = DataView;
class WordSlot {
  view: View = new DataView(new ArrayBuffer(6)); offset: number;
  constructor(offset: number) { this.offset = offset; }
}
const rows: readonly [number, number, readonly number[]][] = [
  [-0.9, 4660, [18, 52, 0, 0, 0, 0]], [1.9, 33023, [0, 128, 255, 0, 0, 0]],
  [2.9, 65535, [0, 0, 255, 255, 0, 0]], [4.9, 258, [0, 0, 0, 0, 1, 2]]
];
for (const [offset, value, expectedBytes] of rows) {
  const slot = new WordSlot(offset); slot.view.setUint16(slot.offset, value, false);
  const bytes: number[] = []; for (let i = 0; i < 6; i++) bytes[i] = slot.view.getUint8(i);
  assert.compareArray(bytes, expectedBytes); assert.sameValue(slot.view.getUint16(slot.offset, false), value);
}
console.log("integers-uint16-public-fractional-offsets:ok");
