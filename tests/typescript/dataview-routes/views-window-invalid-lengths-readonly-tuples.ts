/*---
description: "Explicit constructor windows reject negative or excessive lengths without changing the backing bytes through readonly offset and length tuples."
features: [ts-dataview-routes, ts-dataview-route-views, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-type-aliases, ts-readonly, ts-tuples, ts-destructuring, ts-arrow-functions, ts-errors]
---*/

// Explicit constructor windows reject negative or excessive lengths without changing the backing bytes; route: readonly offset and length tuples. Node prints views-window-invalid-lengths-readonly-tuples:ok.
type BufferStorage = ArrayBuffer;
type View = DataView<ArrayBuffer>;
function readBytes(view: View): number[] {
  const result: number[] = []; for (let i = 0; i < view.byteLength; i++) result[i] = view.getUint8(i); return result;
}
function makeBuffer(input: readonly number[]): BufferStorage {
  const buffer: BufferStorage = new ArrayBuffer(input.length), view: View = new DataView(buffer);
  for (let i = 0; i < input.length; i++) view.setUint8(i, input[i]);
  return buffer;
}
const backing: BufferStorage = makeBuffer([7, 14, 21, 28]), whole: View = new DataView(backing);
const invalid: readonly [number, number][] = [[2, 3], [0, 5], [4, 1], [2, -1]];
for (const [offset, length] of invalid) {
  assert.throws(RangeError, () => new DataView(backing, offset, length));
  assert.compareArray(readBytes(whole), [7, 14, 21, 28]);
}
const valid: readonly [number, number][] = [[0, 4], [1, 3], [2, 2], [4, 0]];
for (const [offset, length] of valid) {
  const view: View = new DataView(backing, offset, length);
  assert.sameValue(view.byteOffset, offset); assert.sameValue(view.byteLength, length); assert.sameValue(view.buffer, backing);
}
assert.compareArray(readBytes(whole), [7, 14, 21, 28]);
console.log("views-window-invalid-lengths-readonly-tuples:ok");
