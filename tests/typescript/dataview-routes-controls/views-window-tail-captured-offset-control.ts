/*---
description: "An omitted length follows the current offset to the buffer end through a captured offset binding. (control)"
features: [ts-dataview-routes, ts-dataview-route-views, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-type-aliases, ts-readonly, ts-tuples, ts-closures, ts-destructuring, ts-arrow-functions]
---*/

interface LocalView { buffer: number[]; byteOffset: number; byteLength: number; }
function localArrayBuffer(length: number): number[] { const bytes: number[] = []; for (let i = 0; i < length; i++) bytes[i] = 0; return bytes; }
function localDataView(buffer: number[], offset: number = 0, length: number = buffer.length - offset): LocalView {
  if (offset < 0 || length < 0 || offset + length > buffer.length) throw new RangeError();
  return { buffer, byteOffset: offset, byteLength: length };
}
function localGetUint8(view: LocalView, offset: number): number { if (offset < 0 || offset >= view.byteLength) throw new RangeError(); return view.buffer[view.byteOffset + offset]; }
function localSetUint8(view: LocalView, offset: number, value: number): void { if (offset < 0 || offset >= view.byteLength) throw new RangeError(); view.buffer[view.byteOffset + offset] = value; }
// An omitted length follows the current offset to the buffer end; route: a captured offset binding. Node prints views-window-tail-captured-offset:ok.
type BufferStorage = number[];
type View = LocalView;
function readBytes(view: View): number[] {
  const result: number[] = []; for (let i = 0; i < view.byteLength; i++) result[i] = localGetUint8(view, i); return result;
}
function makeBuffer(input: readonly number[]): BufferStorage {
  const buffer: BufferStorage = localArrayBuffer(input.length), view: View = localDataView(buffer);
  for (let i = 0; i < input.length; i++) localSetUint8(view, i, input[i]);
  return buffer;
}
const backing: BufferStorage = makeBuffer([11, 22, 33, 44, 55, 66]);
let offset: number = 0;
const openWindow = (): View => localDataView(backing, offset);
const rows: readonly [number, readonly number[]][] = [[0, [11, 22, 33, 44, 55, 66]], [1, [22, 33, 44, 55, 66]], [3, [44, 55, 66]], [6, []]];
for (const [next, expected] of rows) {
  offset = next;
  const view: View = openWindow();
  assert.sameValue(view.byteOffset, next); assert.sameValue(view.byteLength, expected.length);
  assert.sameValue(view.buffer, backing); assert.compareArray(readBytes(view), expected);
}
console.log("views-window-tail-captured-offset:ok");
