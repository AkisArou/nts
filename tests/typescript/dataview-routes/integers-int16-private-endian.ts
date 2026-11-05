/*---
description: "Int16 explicit false and true byte orders preserve wrapped signed values and produce independently specified bytes."
features: [ts-dataview-routes, ts-dataview-route-integers, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-type-aliases, ts-class, ts-class-fields, ts-private-fields, ts-this, ts-readonly, ts-tuples, ts-destructuring]
---*/

// Int16 explicit false and true byte orders preserve wrapped signed values and produce independently specified bytes. Route: private View and byte-order fields. Node prints integers-int16-private-endian:ok.
type View = DataView;
class WordSlot {
  #view: View = new DataView(new ArrayBuffer(2)); #little: boolean;
  constructor(little: boolean) { this.#little = little; }
  write(value: number): void { this.#view.setInt16(0, value, this.#little); }
  read(): number { return this.#view.getInt16(0, this.#little); }
  bytes(): number[] { const result: number[] = []; for (let i = 0; i < 2; i++) result[i] = this.#view.getUint8(i); return result; }
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
