/*---
description: "An explicit length selects exactly its window including interior and end empty windows through a private buffer field. (control)"
features: [ts-dataview-routes, ts-dataview-route-views, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-type-aliases, ts-readonly, ts-tuples, ts-class, ts-class-fields, ts-private-fields, ts-destructuring]
---*/

interface LocalView { buffer: number[]; byteOffset: number; byteLength: number; }
function localArrayBuffer(length: number): number[] { const bytes: number[] = []; for (let i = 0; i < length; i++) bytes[i] = 0; return bytes; }
function localDataView(buffer: number[], offset: number = 0, length: number = buffer.length - offset): LocalView {
  if (offset < 0 || length < 0 || offset + length > buffer.length) throw new RangeError();
  return { buffer, byteOffset: offset, byteLength: length };
}
function localGetUint8(view: LocalView, offset: number): number { if (offset < 0 || offset >= view.byteLength) throw new RangeError(); return view.buffer[view.byteOffset + offset]; }
function localSetUint8(view: LocalView, offset: number, value: number): void { if (offset < 0 || offset >= view.byteLength) throw new RangeError(); view.buffer[view.byteOffset + offset] = value; }
// An explicit length selects exactly its window including interior and end empty windows; route: a private buffer field. Node prints views-window-explicit-private-field:ok.
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
class WindowBox {
  #storage: BufferStorage;
  constructor(input: readonly number[]) { this.#storage = makeBuffer(input); }
  open(offset: number, length: number): View { return localDataView(this.#storage, offset, length); }
  storage(): BufferStorage { return this.#storage; }
}
const box: WindowBox = new WindowBox([9, 18, 27, 36, 45, 54, 63, 72]);
const rows: readonly [number, number, readonly number[]][] = [[1, 3, [18, 27, 36]], [2, 2, [27, 36]], [5, 0, []], [8, 0, []]];
for (const [offset, length, expected] of rows) {
  const view: View = box.open(offset, length);
  assert.sameValue(view.byteOffset, offset); assert.sameValue(view.byteLength, length);
  assert.sameValue(view.buffer, box.storage()); assert.compareArray(readBytes(view), expected);
}
console.log("views-window-explicit-private-field:ok");
