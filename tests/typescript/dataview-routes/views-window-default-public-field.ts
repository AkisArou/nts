/*---
description: "An omitted offset and length expose the complete fixed buffer including empty buffers through a public buffer field."
features: [ts-dataview-routes, ts-dataview-route-views, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-type-aliases, ts-readonly, ts-tuples, ts-class, ts-class-fields, ts-destructuring]
---*/

// An omitted offset and length expose the complete fixed buffer including empty buffers; route: a public buffer field. Node prints views-window-default-public-field:ok.
type BufferStorage = ArrayBuffer;
type View = DataView<ArrayBuffer>;
function readBytes(view: View): number[] {
  const result: number[] = []; for (let i = 0; i < view.byteLength; i++) result[i] = view.getUint8(i); return result;
}
class WindowBox {
  buffer: BufferStorage;
  constructor(length: number) { this.buffer = new ArrayBuffer(length); }
}
const rows: readonly [number, readonly number[]][] = [[0, []], [1, [0]], [4, [0, 0, 0, 0]], [7, [0, 0, 0, 0, 0, 0, 0]]];
for (const [length, expected] of rows) {
  const box: WindowBox = new WindowBox(length), view: View = new DataView(box.buffer);
  assert.sameValue(view.byteOffset, 0); assert.sameValue(view.byteLength, length);
  assert.sameValue(view.buffer, box.buffer); assert.sameValue(view.buffer.byteLength, length);
  assert.compareArray(readBytes(view), expected);
}
console.log("views-window-default-public-field:ok");
