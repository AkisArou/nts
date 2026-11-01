/*---
description: Control for views-dataview-class-floating-bytes; the tested view stays in a local variable of its exact type.
features: [ts-typed-array-contents, ts-typed-array-views, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-class, ts-class-fields, ts-tuples]
---*/
// Replace the class-held DataView with one local DataView; inputs, writes, reads and byte assertions are unchanged.
function check(n: number, a: number, b: number, little: boolean): void {
  const view: DataView = new DataView(new ArrayBuffer(12), 2, 8);
  view.setFloat64(0, n, little);
  assert.sameValue(Object.is(view.getFloat64(0, little), n), true);
  assert.sameValue(view.byteOffset, 2); assert.sameValue(view.byteLength, 8);
  const bytes: Uint8Array = new Uint8Array(view.buffer);
  const expected: number[] = little ? [0, 0, 0, 0, 0, 0, 0, 0, b, a, 0, 0] : [0, 0, a, b, 0, 0, 0, 0, 0, 0, 0, 0];
  assert.sameValue(bytes.length, 12); assert.sameValue(bytes.byteOffset, 0); assert.sameValue(bytes.byteLength, 12);
  for (let i = 0; i < 12; i++) assert.sameValue(Object.is(bytes[i], expected[i]), true);
}
const rows: [number, number, number][] = [[-0, 128, 0], [1.5, 63, 248], [-Infinity, 255, 240]];
for (const [n, a, b] of rows) for (const little of [false, true]) check(n, a, b, little);
