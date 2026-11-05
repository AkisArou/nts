/*---
description: "setUint8 truncates and wraps finite values and stores nonfinite values as zero, with exact unsigned reads and bytes."
features: [ts-dataview-routes, ts-dataview-route-integers, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-type-aliases, ts-class, ts-class-fields, ts-private-fields, ts-this, ts-readonly, ts-tuples, ts-destructuring]
---*/

// setUint8 truncates and wraps finite values and stores nonfinite values as zero, with exact unsigned reads and bytes. Route: a private View field. Node prints integers-uint8-private-conversion:ok.
type View = DataView;
class ByteSlot {
  #view: View = new DataView(new ArrayBuffer(1));
  constructor() { this.#view.setUint8(0, 165); }
  write(value: number): void { this.#view.setUint8(0, value); }
  read(): number { return this.#view.getUint8(0); }
  bytes(): number[] { const result: number[] = []; for (let i = 0; i < 1; i++) result[i] = this.#view.getUint8(i); return result; }
}
const rows: readonly [number, number][] = [
  [-257, 255], [-1, 255], [0, 0], [255, 255], [256, 0], [257, 1],
  [-1.9, 255], [1.9, 1], [-0.9, 0], [NaN, 0], [Infinity, 0], [-Infinity, 0]
];
for (const [value, expected] of rows) {
  const slot = new ByteSlot(); slot.write(value);
  assert.sameValue(slot.read(), expected); assert.compareArray(slot.bytes(), [expected]);
}
console.log("integers-uint8-private-conversion:ok");
