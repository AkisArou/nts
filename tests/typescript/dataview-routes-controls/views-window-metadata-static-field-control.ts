/*---
description: "Static view metadata keeps the original whole buffer identity and exact selected byte window through a reassigned static view field. (control)"
features: [ts-dataview-routes, ts-dataview-route-views, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-type-aliases, ts-readonly, ts-tuples, ts-class, ts-class-fields, ts-static, ts-destructuring]
---*/

interface LocalView { buffer: number[]; byteOffset: number; byteLength: number; }
function localArrayBuffer(length: number): number[] { const bytes: number[] = []; for (let i = 0; i < length; i++) bytes[i] = 0; return bytes; }
function localDataView(buffer: number[], offset: number = 0, length: number = buffer.length - offset): LocalView {
  if (offset < 0 || length < 0 || offset + length > buffer.length) throw new RangeError();
  return { buffer, byteOffset: offset, byteLength: length };
}
function localGetUint8(view: LocalView, offset: number): number { if (offset < 0 || offset >= view.byteLength) throw new RangeError(); return view.buffer[view.byteOffset + offset]; }
function localSetUint8(view: LocalView, offset: number, value: number): void { if (offset < 0 || offset >= view.byteLength) throw new RangeError(); view.buffer[view.byteOffset + offset] = value; }
// Static view metadata keeps the original whole buffer identity and exact selected byte window; route: a reassigned static view field. Node prints views-window-metadata-static-field:ok.
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
const backing: BufferStorage = makeBuffer([1, 2, 3, 4, 5, 6, 7]);
class WindowBank { static view: View = localDataView(backing, 0, 7); }
assert.compareArray(readBytes(WindowBank.view), [1, 2, 3, 4, 5, 6, 7]);
const rows: readonly [number, number, readonly number[]][] = [[1, 4, [2, 3, 4, 5]], [3, 2, [4, 5]], [7, 0, []]];
for (const [offset, length, expected] of rows) {
  WindowBank.view = localDataView(backing, offset, length);
  assert.sameValue(WindowBank.view.byteOffset, offset); assert.sameValue(WindowBank.view.byteLength, length);
  assert.sameValue(WindowBank.view.buffer, backing); assert.sameValue(WindowBank.view.buffer.length, 7);
  assert.compareArray(readBytes(WindowBank.view), expected);
  assert.compareArray(readBytes(localDataView(WindowBank.view.buffer)), [1, 2, 3, 4, 5, 6, 7]);
}
console.log("views-window-metadata-static-field:ok");
