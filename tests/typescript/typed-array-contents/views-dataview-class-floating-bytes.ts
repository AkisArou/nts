/*---
description: A class-held DataView stores Float64 signed zero, a fraction and infinity in both byte orders.
features: [ts-typed-array-contents, ts-typed-array-views, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-class, ts-class-fields, ts-tuples]
---*/
// Write and read a class field holding DataView; node retains the Float64 value and exact bytes in either order.
class ContentsDataSlot {
  view: DataView;
  constructor() { this.view = new DataView(new ArrayBuffer(12), 2, 8); }
}
function check(n: number, a: number, b: number, little: boolean): void {
  const slot: ContentsDataSlot = new ContentsDataSlot();
  slot.view.setFloat64(0, n, little);
  assert.sameValue(Object.is(slot.view.getFloat64(0, little), n), true);
  assert.sameValue(slot.view.byteOffset, 2); assert.sameValue(slot.view.byteLength, 8);
  const bytes: Uint8Array = new Uint8Array(slot.view.buffer);
  const expected: number[] = little ? [0, 0, 0, 0, 0, 0, 0, 0, b, a, 0, 0] : [0, 0, a, b, 0, 0, 0, 0, 0, 0, 0, 0];
  assert.sameValue(bytes.length, 12); assert.sameValue(bytes.byteOffset, 0); assert.sameValue(bytes.byteLength, 12);
  for (let i = 0; i < 12; i++) assert.sameValue(Object.is(bytes[i], expected[i]), true);
}
const rows: [number, number, number][] = [[-0, 128, 0], [1.5, 63, 248], [-Infinity, 255, 240]];
for (const [n, a, b] of rows) for (const little of [false, true]) check(n, a, b, little);
