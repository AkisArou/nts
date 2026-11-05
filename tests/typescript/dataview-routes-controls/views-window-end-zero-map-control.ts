/*---
description: "A view at offset four of a four byte buffer is empty with omitted or zero length and cannot access a byte through a guarded Map get. (control)"
features: [ts-dataview-routes, ts-dataview-route-views, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-type-aliases, ts-readonly, ts-tuples, ts-map-set, ts-strings, ts-null-undefined, ts-arrow-functions, ts-errors]
---*/

interface LocalView { buffer: number[]; byteOffset: number; byteLength: number; }
function localArrayBuffer(length: number): number[] { const bytes: number[] = []; for (let i = 0; i < length; i++) bytes[i] = 0; return bytes; }
function localDataView(buffer: number[], offset: number = 0, length: number = buffer.length - offset): LocalView {
  if (offset < 0 || length < 0 || offset + length > buffer.length) throw new RangeError();
  return { buffer, byteOffset: offset, byteLength: length };
}
function localGetUint8(view: LocalView, offset: number): number { if (offset < 0 || offset >= view.byteLength) throw new RangeError(); return view.buffer[view.byteOffset + offset]; }
function localSetUint8(view: LocalView, offset: number, value: number): void { if (offset < 0 || offset >= view.byteLength) throw new RangeError(); view.buffer[view.byteOffset + offset] = value; }
// A view at offset four of a four byte buffer is empty with omitted or zero length and cannot access a byte; route: a guarded Map get. Node prints views-window-end-zero-map:ok.
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
const backing: BufferStorage = makeBuffer([10, 20, 30, 40]);
const buffers: Map<string, BufferStorage> = new Map([["packet", backing]]);
const selected = buffers.get("packet");
if (selected === undefined) throw new Error("missing buffer");
const windows: readonly View[] = [localDataView(selected, 4), localDataView(selected, 4, 0)];
for (const view of windows) {
  assert.sameValue(view.byteOffset, 4); assert.sameValue(view.byteLength, 0); assert.sameValue(view.buffer, backing);
  assert.compareArray(readBytes(view), []);
  assert.throws(RangeError, () => localGetUint8(view, 0)); assert.throws(RangeError, () => localSetUint8(view, 0, 255));
}
assert.compareArray(readBytes(localDataView(backing)), [10, 20, 30, 40]);
console.log("views-window-end-zero-map:ok");
