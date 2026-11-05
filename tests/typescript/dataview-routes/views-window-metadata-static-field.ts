/*---
description: "Static view metadata keeps the original whole buffer identity and exact selected byte window through a reassigned static view field."
features: [ts-dataview-routes, ts-dataview-route-views, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-type-aliases, ts-readonly, ts-tuples, ts-class, ts-class-fields, ts-static, ts-destructuring]
---*/

// Static view metadata keeps the original whole buffer identity and exact selected byte window; route: a reassigned static view field. Node prints views-window-metadata-static-field:ok.
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
const backing: BufferStorage = makeBuffer([1, 2, 3, 4, 5, 6, 7]);
class WindowBank { static view: View = new DataView(backing, 0, 7); }
assert.compareArray(readBytes(WindowBank.view), [1, 2, 3, 4, 5, 6, 7]);
const rows: readonly [number, number, readonly number[]][] = [[1, 4, [2, 3, 4, 5]], [3, 2, [4, 5]], [7, 0, []]];
for (const [offset, length, expected] of rows) {
  WindowBank.view = new DataView(backing, offset, length);
  assert.sameValue(WindowBank.view.byteOffset, offset); assert.sameValue(WindowBank.view.byteLength, length);
  assert.sameValue(WindowBank.view.buffer, backing); assert.sameValue(WindowBank.view.buffer.byteLength, 7);
  assert.compareArray(readBytes(WindowBank.view), expected);
  assert.compareArray(readBytes(new DataView(WindowBank.view.buffer)), [1, 2, 3, 4, 5, 6, 7]);
}
console.log("views-window-metadata-static-field:ok");
