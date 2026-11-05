/*---
description: "An omitted length follows the current offset to the buffer end through a captured offset binding."
features: [ts-dataview-routes, ts-dataview-route-views, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-type-aliases, ts-readonly, ts-tuples, ts-closures, ts-destructuring, ts-arrow-functions]
---*/

// An omitted length follows the current offset to the buffer end; route: a captured offset binding. Node prints views-window-tail-captured-offset:ok.
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
const backing: BufferStorage = makeBuffer([11, 22, 33, 44, 55, 66]);
let offset: number = 0;
const openWindow = (): View => new DataView(backing, offset);
const rows: readonly [number, readonly number[]][] = [[0, [11, 22, 33, 44, 55, 66]], [1, [22, 33, 44, 55, 66]], [3, [44, 55, 66]], [6, []]];
for (const [next, expected] of rows) {
  offset = next;
  const view: View = openWindow();
  assert.sameValue(view.byteOffset, next); assert.sameValue(view.byteLength, expected.length);
  assert.sameValue(view.buffer, backing); assert.compareArray(readBytes(view), expected);
}
console.log("views-window-tail-captured-offset:ok");
