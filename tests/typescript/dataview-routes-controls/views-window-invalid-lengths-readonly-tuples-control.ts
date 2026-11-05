/*---
description: "Explicit constructor windows reject negative or excessive lengths without changing the backing bytes through readonly offset and length tuples. (control)"
features: [ts-dataview-routes, ts-dataview-route-views, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-type-aliases, ts-readonly, ts-tuples, ts-destructuring, ts-arrow-functions, ts-errors]
---*/

interface LocalView { buffer: number[]; byteOffset: number; byteLength: number; }
function localArrayBuffer(length: number): number[] { const bytes: number[] = []; for (let i = 0; i < length; i++) bytes[i] = 0; return bytes; }
function localDataView(buffer: number[], offset: number = 0, length: number = buffer.length - offset): LocalView {
  if (offset < 0 || length < 0 || offset + length > buffer.length) throw new RangeError();
  return { buffer, byteOffset: offset, byteLength: length };
}
function localGetUint8(view: LocalView, offset: number): number { if (offset < 0 || offset >= view.byteLength) throw new RangeError(); return view.buffer[view.byteOffset + offset]; }
function localSetUint8(view: LocalView, offset: number, value: number): void { if (offset < 0 || offset >= view.byteLength) throw new RangeError(); view.buffer[view.byteOffset + offset] = value; }
// Explicit constructor windows reject negative or excessive lengths without changing the backing bytes; route: readonly offset and length tuples. Node prints views-window-invalid-lengths-readonly-tuples:ok.
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
const backing: BufferStorage = makeBuffer([7, 14, 21, 28]), whole: View = localDataView(backing);
const invalid: readonly [number, number][] = [[2, 3], [0, 5], [4, 1], [2, -1]];
for (const [offset, length] of invalid) {
  assert.throws(RangeError, () => localDataView(backing, offset, length));
  assert.compareArray(readBytes(whole), [7, 14, 21, 28]);
}
const valid: readonly [number, number][] = [[0, 4], [1, 3], [2, 2], [4, 0]];
for (const [offset, length] of valid) {
  const view: View = localDataView(backing, offset, length);
  assert.sameValue(view.byteOffset, offset); assert.sameValue(view.byteLength, length); assert.sameValue(view.buffer, backing);
}
assert.compareArray(readBytes(whole), [7, 14, 21, 28]);
console.log("views-window-invalid-lengths-readonly-tuples:ok");
