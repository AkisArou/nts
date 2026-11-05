/*---
description: "An omitted offset and length expose the complete fixed buffer including empty buffers through a public buffer field. (control)"
features: [ts-dataview-routes, ts-dataview-route-views, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-type-aliases, ts-readonly, ts-tuples, ts-class, ts-class-fields, ts-destructuring]
---*/

interface LocalView { buffer: number[]; byteOffset: number; byteLength: number; }
function localArrayBuffer(length: number): number[] { const bytes: number[] = []; for (let i = 0; i < length; i++) bytes[i] = 0; return bytes; }
function localDataView(buffer: number[], offset: number = 0, length: number = buffer.length - offset): LocalView {
  if (offset < 0 || length < 0 || offset + length > buffer.length) throw new RangeError();
  return { buffer, byteOffset: offset, byteLength: length };
}
function localGetUint8(view: LocalView, offset: number): number { if (offset < 0 || offset >= view.byteLength) throw new RangeError(); return view.buffer[view.byteOffset + offset]; }
// An omitted offset and length expose the complete fixed buffer including empty buffers; route: a public buffer field. Node prints views-window-default-public-field:ok.
type BufferStorage = number[];
type View = LocalView;
function readBytes(view: View): number[] {
  const result: number[] = []; for (let i = 0; i < view.byteLength; i++) result[i] = localGetUint8(view, i); return result;
}
class WindowBox {
  buffer: BufferStorage;
  constructor(length: number) { this.buffer = localArrayBuffer(length); }
}
const rows: readonly [number, readonly number[]][] = [[0, []], [1, [0]], [4, [0, 0, 0, 0]], [7, [0, 0, 0, 0, 0, 0, 0]]];
for (const [length, expected] of rows) {
  const box: WindowBox = new WindowBox(length), view: View = localDataView(box.buffer);
  assert.sameValue(view.byteOffset, 0); assert.sameValue(view.byteLength, length);
  assert.sameValue(view.buffer, box.buffer); assert.sameValue(view.buffer.length, length);
  assert.compareArray(readBytes(view), expected);
}
console.log("views-window-default-public-field:ok");
